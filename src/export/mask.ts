import { readMotionTransform } from './motion'
import type { PagImage, PagImageLayer, PagLayer, PagTrackMatteType } from './pag/types'
import { readShapeNode } from './shape'
import type { ExportTransformContext } from './solid'
import { readNodeTransform } from './solid'
import type { ExportIssue, ExportOptions } from './types'

export interface MaskReadContext {
  root: SceneNode
  duration: number
  options: ExportOptions
  transformContext: ExportTransformContext
  warnings: ExportIssue[]
  imagesByHash: Map<string, Promise<PagImage>>
  nextImageId: () => number
}

export type FigmaMaskNode = SceneNode & { isMask: true; maskType: MaskType }

export async function readMaskMatte(
  node: FigmaMaskNode,
  id: number,
  context: MaskReadContext,
): Promise<{ layer: PagLayer; type: PagTrackMatteType }> {
  const type = readTrackMatteType(node)
  const transform = readNodeTransform(node, context.transformContext)
  let shape: Extract<PagLayer, { type: 'shape' }> | null = null
  if (!hasVisibleEffect(node)) {
    try {
      shape = readShapeNode(node, id, context.duration, transform, context.warnings)
    } catch {
      // 复杂填充、文本或容器使用完整渲染结果作为 Track Matte。
    }
  }
  if (shape !== null) {
    shape.active = false
    shape.name = `${node.name} Matte`
    shape.transform = readMotionTransform(
      node,
      context.root,
      context.options.frameRate,
      shape.transform,
      context.warnings,
      context.transformContext,
    )
    if (node.maskType === 'VECTOR') {
      shape.fill = { color: { red: 255, green: 255, blue: 255 }, opacity: 255 }
      shape.stroke = undefined
      shape.transform.opacity = 255
    }
    return { layer: shape, type }
  }

  const layer = await readRasterMatte(node, id, context)
  layer.active = false
  return { layer, type }
}

function hasVisibleEffect(node: SceneNode): boolean {
  return 'effects' in node && node.effects.some((effect) => effect.visible !== false)
}

function readTrackMatteType(node: FigmaMaskNode): PagTrackMatteType {
  return node.maskType === 'LUMINANCE' ? 'luma' : 'alpha'
}

async function readRasterMatte(
  node: FigmaMaskNode,
  id: number,
  context: MaskReadContext,
): Promise<PagImageLayer> {
  const key = `mask:${node.id}`
  let image = context.imagesByHash.get(key)
  if (image === undefined) {
    image = (async () => {
      const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } })
      const size = readPngSize(bytes)
      return {
        id: context.nextImageId(),
        width: size.width,
        height: size.height,
        bytes,
        explicitSize: true,
      }
    })()
    context.imagesByHash.set(key, image)
  }
  const source = await image
  const bounds = ('absoluteRenderBounds' in node ? node.absoluteRenderBounds : null) ?? node.absoluteBoundingBox
  const rootBounds = context.root.absoluteBoundingBox
  const position =
    bounds === null || rootBounds === null
      ? readNodeTransform(node, context.transformContext).position
      : { x: bounds.x - rootBounds.x, y: bounds.y - rootBounds.y }
  const scale =
    bounds === null
      ? { x: node.width / source.width, y: node.height / source.height }
      : { x: bounds.width / source.width, y: bounds.height / source.height }
  return {
    type: 'image',
    id,
    imageId: source.id,
    name: `${node.name} Matte`,
    startTime: 0,
    duration: context.duration,
    transform: { position, scale },
  }
}

function readPngSize(bytes: Uint8Array): { width: number; height: number } {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    throw new Error('Figma Mask 导出的数据不是有效 PNG。')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}
