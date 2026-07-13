import { encodePagFile } from './pag/encode-file'
import type { PagColor, PagImage, PagLayer } from './pag/types'
import { readImageNode } from './image'
import { readMotionTransform } from './motion'
import { readShapeNode } from './shape'
import { hasSolidMarker, readNodeTransform, readSolidNode, toPagColor } from './solid'
import { ExportError } from './types'
import type { ExportOptions } from './types'

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
  if (selection.length !== 1 || selection[0].type !== 'FRAME') {
    throw new ExportError([{ message: '请选择一个顶层 Frame 后再导出。' }])
  }
  const root = selection[0]
  if (root.parent?.type !== 'PAGE') {
    throw new ExportError([{ nodeId: root.id, nodeName: root.name, message: '请选择顶层 Frame。' }])
  }
  if (Object.keys(root.animations).length > 0) {
    throw new ExportError([{ nodeId: root.id, nodeName: root.name, message: '顶层 Frame 不能包含 Motion。' }])
  }
  const durationSeconds = root.timelines[0]?.duration ?? 1 / options.frameRate
  const duration = Math.max(1, Math.round(durationSeconds * options.frameRate))
  const layers: PagLayer[] = []
  const warnings: ExportResult['warnings'] = []
  const imagesByHash = new Map<string, Promise<PagImage>>()
  let nextId = 2
  let nextImageId = 1

  const visit = async (node: SceneNode): Promise<void> => {
    if (!node.visible) return
    validateLayerNode(node)
    const solid = readSolidNode(node, nextId, duration, root)
    if (solid !== null) {
      solid.transform = readMotionTransform(
        node,
        root,
        options.frameRate,
        solid.transform,
        warnings,
        readPaintOpacity(node),
      )
      nextId += 1
      layers.push(solid)
      return
    }
    const nodeTransform = readNodeTransform(node, root)
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
        readPaintOpacity(node),
      )
      nextId += 1
      layers.push(image)
      return
    }
    const shape = readShapeNode(node, nextId, duration, nodeTransform)
    if (shape !== null) {
      shape.transform = readMotionTransform(node, root, options.frameRate, shape.transform, warnings)
      nextId += 1
      layers.push(shape)
      return
    }
    if ('children' in node) {
      if (Object.keys(node.animations).length > 0) {
        throw new ExportError([
          {
            nodeId: node.id,
            nodeName: node.name,
            message: '当前版本不支持容器图层使用 Motion。',
          },
        ])
      }
      for (const child of node.children) await visit(child)
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

  for (const child of root.children) await visit(child)
  if (layers.length === 0) throw new ExportError([{ message: '所选 Frame 中没有可导出的图层。' }])

  const bytes = encodePagFile({
    id: 1,
    width: Math.max(1, Math.round(root.width)),
    height: Math.max(1, Math.round(root.height)),
    duration,
    frameRate: options.frameRate,
    backgroundColor: readBackgroundColor(root),
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
  if ('isMask' in node && node.isMask) {
    throw new ExportError([
      { nodeId: node.id, nodeName: node.name, message: '当前版本不支持 Figma Mask。' },
    ])
  }
}

function readPaintOpacity(node: SceneNode): number {
  if (!('fills' in node) || node.fills === figma.mixed) return 1
  const fill = (node.fills as readonly Paint[]).find((paint) => paint.visible !== false)
  return fill?.opacity ?? 1
}

function readBackgroundColor(root: FrameNode): PagColor {
  if (root.fills !== figma.mixed) {
    const fills = root.fills.filter((paint) => paint.visible !== false)
    if (fills.length === 1 && fills[0].type === 'SOLID' && (fills[0].opacity ?? 1) === 1) {
      return toPagColor(fills[0].color)
    }
  }
  return { red: 255, green: 255, blue: 255 }
}

function safeFileName(name: string): string {
  const value = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  return value || 'motion'
}
