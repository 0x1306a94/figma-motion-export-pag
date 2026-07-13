import { encodePagFile } from './pag/encode-file'
import type { PagComposition, PagImage, PagLayer, PagSolidLayer } from './pag/types'
import { readLayerEffects } from './effect'
import { applyImageFit, readImageNode, readImagePaintLayer } from './image'
import { composeAncestorMotionTransform, readMotionTransform } from './motion'
import { readShapeNode } from './shape'
import {
  createExportTransformContext,
  hasSolidMarker,
  readNodeTransform,
  readSolidNode,
  toPagColor,
} from './solid'
import { ExportError } from './types'
import type { ExportOptions } from './types'
import { readMaskMatte } from './mask'
import type { FigmaMaskNode } from './mask'
import { readTextNode } from './text'
import { readBlendMode } from './blend-mode'

export interface ExportResult {
  bytes: Uint8Array
  fileName: string
  warnings: import('./types').ExportIssue[]
}

export async function exportSelection(
  selection: readonly SceneNode[],
  options: ExportOptions,
  encodeWebP: (source: Uint8Array, mimeType: string, quality: number) => Promise<Uint8Array>,
): Promise<ExportResult> {
  if (selection.length !== 1) {
    throw new ExportError([{ message: '请选择一个节点后再导出。' }])
  }
  const root = selection[0]
  const durationSeconds = root.timelines[0]?.duration ?? 1 / options.frameRate
  const duration = Math.max(1, Math.round(durationSeconds * options.frameRate))
  const transformContext = createExportTransformContext(root)
  const layers: PagLayer[] = []
  const warnings: ExportResult['warnings'] = []
  const imagesByHash = new Map<string, Promise<PagImage>>()
  const compositions: PagComposition[] = []
  let nextId = 2
  let nextImageId = 1
  let nextCompositionId = 2

  interface ActiveMask {
    node: FigmaMaskNode
    ancestors: SceneNode[]
  }

  const readMultiFillLayer = async (node: SceneNode): Promise<PagLayer | null> => {
    if (node.type !== 'RECTANGLE' || node.fills === figma.mixed) return null
    const visibleFills = node.fills.filter((paint) => paint.visible !== false)
    if (visibleFills.length <= 1) return null
    if (!visibleFills.every((paint) => paint.type === 'SOLID' || paint.type === 'IMAGE')) return null
    const fills = visibleFills as Array<SolidPaint | ImagePaint>

    const childLayers: PagLayer[] = []
    for (const paint of fills) {
      if (paint.type === 'IMAGE') {
        const imageResult = await readImagePaintLayer(
          node,
          paint,
          nextId++,
          duration,
          { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 } },
          {
            options,
            imagesByHash,
            nextImageId: () => nextImageId++,
            encodeWebP,
          },
          1,
        )
        imageResult.layer.transform = applyImageFit(imageResult.layer.transform, imageResult.fit)
        childLayers.push(imageResult.layer)
        continue
      }
      childLayers.push({
        type: 'solid',
        id: nextId++,
        name: node.name,
        startTime: 0,
        duration,
        width: Math.max(1, Math.round(node.width)),
        height: Math.max(1, Math.round(node.height)),
        color: toPagColor(paint.color),
        blendMode: readBlendMode(paint.blendMode, node),
        transform: { opacity: Math.round((paint.opacity ?? 1) * 255) },
      })
    }
    childLayers.reverse()

    const compositionId = nextCompositionId++
    compositions.push({
      id: compositionId,
      width: Math.max(1, Math.round(node.width)),
      height: Math.max(1, Math.round(node.height)),
      duration,
      frameRate: options.frameRate,
      backgroundColor: { red: 255, green: 255, blue: 255 },
      layers: childLayers,
    })
    return {
      type: 'precompose',
      id: nextId++,
      name: node.name,
      startTime: 0,
      duration,
      compositionId,
      compositionStartTime: 0,
      transform: {
        ...readNodeTransform(node, transformContext),
        opacity: Math.round(node.opacity * 255),
      },
    }
  }

  const appendLayer = async (
    node: SceneNode,
    ancestors: SceneNode[],
    layer: PagLayer,
    mask: ActiveMask | undefined,
  ): Promise<void> => {
    layer.transform = composeAncestorMotionTransform(
      node,
      root,
      ancestors,
      options.frameRate,
      duration,
      layer.transform,
      warnings,
      transformContext,
    )
    layers.push(layer)
    if (mask === undefined) return
    const matte = await readMaskMatte(mask.node, nextId++, {
      root,
      duration,
      options,
      transformContext,
      warnings,
      imagesByHash,
      nextImageId: () => nextImageId++,
    })
    matte.layer.transform = composeAncestorMotionTransform(
      mask.node,
      root,
      mask.ancestors,
      options.frameRate,
      duration,
      matte.layer.transform,
      warnings,
      transformContext,
    )
    layer.trackMatteType = matte.type
    layers.push(matte.layer)
  }

  const visit = async (node: SceneNode, ancestors: SceneNode[], mask?: ActiveMask): Promise<void> => {
    if (!node.visible) return
    if (node.type === 'TEXT') {
      validateLayerNode(node)
      const text = readTextNode(node, nextId, duration, transformContext, warnings)
      text.effects = readLayerEffects(node, options.frameRate, warnings)
      text.transform = readMotionTransform(
        node,
        root,
        options.frameRate,
        text.transform,
        warnings,
        transformContext,
        readPaintOpacity(node),
      )
      if (
        !text.sourceText.boxText
        && text.transform.position !== undefined
        && typeof text.transform.position === 'object'
        && 'keyframes' in text.transform.position
      ) {
        warnings.push({
          nodeId: node.id,
          nodeName: node.name,
          message: '点文本含位移动画时暂不覆盖基线锚点，仍用原始位置采样。',
        })
      }
      nextId += 1
      await appendLayer(node, ancestors, text, mask)
      return
    }
    validateLayerNode(node)
    const effects = readLayerEffects(node, options.frameRate, warnings)
    const multiFill = await readMultiFillLayer(node)
    if (multiFill !== null) {
      multiFill.effects = effects
      multiFill.transform = readMotionTransform(
        node,
        root,
        options.frameRate,
        multiFill.transform,
        warnings,
        transformContext,
      )
      await appendLayer(node, ancestors, multiFill, mask)
      return
    }
    const solid = readSolidNode(node, nextId, duration, transformContext)
    if (solid !== null) {
      solid.effects = effects
      solid.transform = readMotionTransform(
        node,
        root,
        options.frameRate,
        solid.transform,
        warnings,
        transformContext,
        readPaintOpacity(node),
      )
      nextId += 1
      await appendLayer(node, ancestors, solid, mask)
      return
    }
    const nodeTransform = readNodeTransform(node, transformContext)
    const imageResult = await readImageNode(node, nextId, duration, nodeTransform, {
      options,
      imagesByHash,
      nextImageId: () => nextImageId++,
      encodeWebP,
    })
    if (imageResult !== null) {
      const image = imageResult.layer
      image.effects = effects
      const motionTransform = readMotionTransform(
        node,
        root,
        options.frameRate,
        image.transform,
        warnings,
        transformContext,
        readPaintOpacity(node),
      )
      image.transform = applyImageFit(motionTransform, imageResult.fit)
      nextId += 1
      await appendLayer(node, ancestors, image, mask)
      return
    }
    const shape = readShapeNode(node, nextId, duration, nodeTransform)
    if (shape !== null) {
      shape.effects = effects
      shape.transform = readMotionTransform(
        node,
        root,
        options.frameRate,
        shape.transform,
        warnings,
        transformContext,
      )
      nextId += 1
      await appendLayer(node, ancestors, shape, mask)
      return
    }
    if ('children' in node) {
      if (effects.length > 0) {
        throw new ExportError([
          {
            nodeId: node.id,
            nodeName: node.name,
            message: '当前版本不支持容器图层的 Layer Blur。',
          },
        ])
      }
      let activeMask = mask
      const childAncestors = [...ancestors, node]
      for (const child of node.children) {
        if ('isMask' in child && child.isMask) {
          activeMask = child.visible
            ? { node: child as FigmaMaskNode, ancestors: childAncestors }
            : undefined
          continue
        }
        await visit(child, childAncestors, activeMask)
      }
      return
    }
    if (hasSolidMarker(node.name)) return
    throw new ExportError([
      {
        nodeId: node.id,
        nodeName: node.name,
        message: `当前阶段暂不支持 ${node.type} 图层“${node.name}”。`,
      },
    ])
  }

  if ('children' in root) {
    validateLayerNode(root)
    const rootEffects = readLayerEffects(root, options.frameRate, warnings)
    if (rootEffects.length > 0) {
      throw new ExportError([
        { nodeId: root.id, nodeName: root.name, message: '当前版本不支持容器图层的 Layer Blur。' },
      ])
    }
    let activeMask: ActiveMask | undefined
    for (const child of root.children) {
      if ('isMask' in child && child.isMask) {
        activeMask = child.visible
          ? { node: child as FigmaMaskNode, ancestors: [] }
          : undefined
        continue
      }
      await visit(child, [], activeMask)
    }
  } else {
    await visit(root, [])
  }
  layers.reverse()
  const background =
    root.type === 'FRAME'
      ? readRootBackgroundLayer(
          root,
          nextId,
          duration,
          transformContext.width,
          transformContext.height,
        )
      : null
  if (background !== null) layers.push(background)
  if (layers.length === 0) throw new ExportError([{ message: '所选节点中没有可导出的图层。' }])

  const bytes = encodePagFile({
    id: 1,
    width: transformContext.width,
    height: transformContext.height,
    duration,
    frameRate: options.frameRate,
    backgroundColor: background?.color ?? { red: 255, green: 255, blue: 255 },
    images: await Promise.all(imagesByHash.values()),
    compositions,
    layers,
  })
  return { bytes, fileName: `${safeFileName(root.name)}.pag`, warnings }
}

function validateLayerNode(node: SceneNode): void {
  if ('blendMode' in node && node.blendMode !== 'NORMAL' && node.blendMode !== 'PASS_THROUGH') {
    throw new ExportError([
      { nodeId: node.id, nodeName: node.name, message: `当前版本不支持 ${node.blendMode} 混合模式。` },
    ])
  }
}

function readPaintOpacity(node: SceneNode): number {
  if (!('fills' in node) || node.fills === figma.mixed) return 1
  const fill = (node.fills as readonly Paint[]).find((paint) => paint.visible !== false)
  return fill?.opacity ?? 1
}

export function readRootBackgroundLayer(
  root: FrameNode,
  id: number,
  duration: number,
  width: number,
  height: number,
): PagSolidLayer | null {
  if (root.fills === figma.mixed) {
    throw new ExportError([{ nodeId: root.id, nodeName: root.name, message: '根 Frame 不能使用混合填充。' }])
  }
  const fills = root.fills.filter((paint) => paint.visible !== false)
  if (fills.length === 0) return null
  if (fills.length !== 1 || fills[0].type !== 'SOLID') {
    throw new ExportError([
      {
        nodeId: root.id,
        nodeName: root.name,
        message: '当前版本仅支持根 Frame 使用一个可见纯色填充，渐变填充暂未实现。',
      },
    ])
  }
  const fill = fills[0]
  return {
    type: 'solid',
    id,
    name: `${root.name} Background`,
    startTime: 0,
    duration,
    width,
    height,
    color: toPagColor(fill.color),
    blendMode: readBlendMode(fill.blendMode, root),
    transform: { opacity: Math.round(root.opacity * (fill.opacity ?? 1) * 255) },
  }
}

function safeFileName(name: string): string {
  const value = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  return value || 'motion'
}
