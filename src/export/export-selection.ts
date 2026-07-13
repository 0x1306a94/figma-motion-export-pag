import { encodePagFile } from './pag/encode-file'
import type { PagImage, PagLayer, PagSolidLayer } from './pag/types'
import { readImageNode } from './image'
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
  let nextId = 2
  let nextImageId = 1

  interface ActiveMask {
    node: FigmaMaskNode
    ancestors: SceneNode[]
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
    validateLayerNode(node)
    const solid = readSolidNode(node, nextId, duration, transformContext)
    if (solid !== null) {
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
    const image = await readImageNode(node, nextId, duration, nodeTransform, {
      options,
      imagesByHash,
      nextImageId: () => nextImageId++,
      encodeWebP,
    })
    if (image !== null) {
      validateImageMotion(node, image, nodeTransform)
      image.transform = readMotionTransform(
        node,
        root,
        options.frameRate,
        image.transform,
        warnings,
        transformContext,
        readPaintOpacity(node),
      )
      nextId += 1
      await appendLayer(node, ancestors, image, mask)
      return
    }
    const shape = readShapeNode(node, nextId, duration, nodeTransform)
    if (shape !== null) {
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
    layers,
  })
  return { bytes, fileName: `${safeFileName(root.name)}.pag`, warnings }
}

function validateImageMotion(
  node: SceneNode,
  image: Extract<PagLayer, { type: 'image' }>,
  nodeTransform: import('./pag/types').PagTransform,
): void {
  const fields = Object.keys(node.animations)
  const transformFields = fields.filter((field) => field !== 'OPACITY')
  if (transformFields.length === 0) return
  const scaleFields = transformFields.filter((field) => field.startsWith('SCALE_'))
  if (scaleFields.length > 0) {
    throw new ExportError([
      {
        nodeId: node.id,
        nodeName: node.name,
        message: '当前版本不支持图片图层的 Scale Motion。',
      },
    ])
  }
  if (image.masks !== undefined || !sameStaticPoint(image.transform.position, nodeTransform.position)) {
    throw new ExportError([
      {
        nodeId: node.id,
        nodeName: node.name,
        message: '带 FIT 偏移或 FILL 裁剪的图片当前仅支持 Opacity Motion。',
      },
    ])
  }
}

function sameStaticPoint(
  left: import('./pag/types').PagTransform['position'],
  right: import('./pag/types').PagTransform['position'],
): boolean {
  if (left === undefined || right === undefined || 'keyframes' in left || 'keyframes' in right) {
    return left === right
  }
  return Math.abs(left.x - right.x) < 0.0001 && Math.abs(left.y - right.y) < 0.0001
}

function validateLayerNode(node: SceneNode): void {
  if ('effects' in node && node.effects.some((effect) => effect.visible !== false)) {
    throw new ExportError([
      { nodeId: node.id, nodeName: node.name, message: '当前版本不支持可见 Effect。' },
    ])
  }
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
  if ((fill.blendMode ?? 'NORMAL') !== 'NORMAL') {
    throw new ExportError([{ nodeId: root.id, nodeName: root.name, message: '根 Frame 填充不能使用混合模式。' }])
  }
  return {
    type: 'solid',
    id,
    name: `${root.name} Background`,
    startTime: 0,
    duration,
    width,
    height,
    color: toPagColor(fill.color),
    transform: { opacity: Math.round(root.opacity * (fill.opacity ?? 1) * 255) },
  }
}

function safeFileName(name: string): string {
  const value = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  return value || 'motion'
}
