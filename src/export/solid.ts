import { ExportError } from './types'
import type { PagColor, PagSolidLayer, PagTransform } from './pag/types'
import { readBlendMode } from './blend-mode'

const solidMarkerPattern = /^#solid(?:\s|$)/

export interface ExportTransformContext {
  width: number
  height: number
  absoluteToExportTransform: Transform
  rootToExportTransform: Transform
  scale: number
  orientation: 1 | -1
  rotation: number
}

export interface NodeTransformResult {
  transform: PagTransform
  residual: Transform
}

export function hasSolidMarker(name: string): boolean {
  return solidMarkerPattern.test(name)
}

export function readSolidNode(
  node: SceneNode,
  id: number,
  duration: number,
  context: ExportTransformContext,
  visibleFills?: readonly Paint[] | null,
): PagSolidLayer | null {
  if (!hasSolidMarker(node.name)) return null
  const fail = (message: string): never => {
    throw new ExportError([{ nodeId: node.id, nodeName: node.name, message }])
  }

  if (node.type !== 'RECTANGLE') fail('带 #solid 标记的图层必须是矩形。')
  const rectangle = node as RectangleNode
  if (
    rectangle.topLeftRadius !== 0 ||
    rectangle.topRightRadius !== 0 ||
    rectangle.bottomLeftRadius !== 0 ||
    rectangle.bottomRightRadius !== 0
  ) {
    fail('带 #solid 标记的矩形不能包含圆角。')
  }

  if (rectangle.fills === figma.mixed) fail('带 #solid 标记的矩形不能使用混合填充。')
  const fills = visibleFills ?? (rectangle.fills as readonly Paint[]).filter((paint) => paint.visible !== false)
  if (fills.length !== 1 || fills[0].type !== 'SOLID') {
    fail('带 #solid 标记的矩形必须且只能包含一个可见纯色填充。')
  }
  const hasVisibleStroke =
    rectangle.strokeWeight !== figma.mixed &&
    rectangle.strokeWeight > 0 &&
    (rectangle.strokes as readonly Paint[]).some((paint) => paint.visible !== false)
  if (hasVisibleStroke) fail('带 #solid 标记的矩形不能包含可见描边。')
  if (rectangle.width <= 0 || rectangle.height <= 0) fail('带 #solid 标记的矩形宽高必须大于 0。')

  const fill = fills[0] as SolidPaint
  const fillOpacity = fill.opacity ?? 1
  return {
    type: 'solid',
    id,
    name: node.name.replace(/^#solid\s*/, ''),
    startTime: 0,
    duration,
    width: Math.max(1, Math.round(rectangle.width)),
    height: Math.max(1, Math.round(rectangle.height)),
    color: toPagColor(fill.color),
    blendMode: readBlendMode(fill.blendMode, node),
    transform: {
      ...readNodeTransform(node, context),
      opacity: Math.round(rectangle.opacity * fillOpacity * 255),
    },
  }
}

export function createExportTransformContext(root: SceneNode): ExportTransformContext {
  const bounds = root.absoluteBoundingBox
  if (bounds === null) {
    throw new ExportError([{ nodeId: root.id, nodeName: root.name, message: '无法读取所选节点的边界。' }])
  }
  const transform = root.absoluteTransform
  const scaleX = Math.hypot(transform[0][0], transform[1][0])
  const scaleY = Math.hypot(transform[0][1], transform[1][1])
  const dotProduct = transform[0][0] * transform[0][1] + transform[1][0] * transform[1][1]
  const rotation = Math.atan2(transform[1][0], transform[0][0])
  if (
    scaleX === 0 ||
    scaleY === 0 ||
    Math.abs(dotProduct / (scaleX * scaleY)) > 0.0001
  ) {
    throw new ExportError([
      {
        nodeId: root.id,
        nodeName: root.name,
        message: '所选根节点不能包含倾斜或退化变换。',
      },
    ])
  }
  const absoluteToExportTransform: Transform = [
    [1, 0, -bounds.x],
    [0, 1, -bounds.y],
  ]
  const determinant =
    transform[0][0] * transform[1][1] - transform[0][1] * transform[1][0]
  return {
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
    absoluteToExportTransform,
    rootToExportTransform: multiplyTransform(absoluteToExportTransform, transform),
    scale: scaleX,
    orientation: determinant < 0 ? -1 : 1,
    rotation: (rotation * 180) / Math.PI,
  }
}

export function readNodeTransform(node: SceneNode, context: ExportTransformContext): PagTransform {
  const result = readNodeTransformWithResidual(node, context)
  const [[a, c], [b, d]] = result.residual
  if (
    Math.abs(a - 1) > 0.0001
    || Math.abs(b) > 0.0001
    || Math.abs(c) > 0.0001
    || Math.abs(d - 1) > 0.0001
  ) {
    throw new ExportError([
      { nodeId: node.id, nodeName: node.name, message: '当前版本不支持倾斜或退化的图层变换。' },
    ])
  }
  return result.transform
}

export function readNodeTransformWithResidual(
  node: SceneNode,
  context: ExportTransformContext,
): NodeTransformResult {
  const transform = multiplyTransform(context.absoluteToExportTransform, node.absoluteTransform)
  const scaleX = Math.hypot(transform[0][0], transform[1][0])
  const determinant =
    transform[0][0] * transform[1][1] - transform[0][1] * transform[1][0]
  if (scaleX < 0.000001 || Math.abs(determinant) < 0.000001) {
    throw new ExportError([
      { nodeId: node.id, nodeName: node.name, message: '当前版本不支持倾斜或退化的图层变换。' },
    ])
  }
  const scaleY = determinant / scaleX
  const cosine = transform[0][0] / scaleX
  const sine = transform[1][0] / scaleX
  const layerMatrix: Transform = [
    [cosine * scaleX, -sine * scaleY, 0],
    [sine * scaleX, cosine * scaleY, 0],
  ]
  const inverseLayer: Transform = [
    [layerMatrix[1][1] / determinant, -layerMatrix[0][1] / determinant, 0],
    [-layerMatrix[1][0] / determinant, layerMatrix[0][0] / determinant, 0],
  ]
  const residual = multiplyTransform(inverseLayer, [
    [transform[0][0], transform[0][1], 0],
    [transform[1][0], transform[1][1], 0],
  ])
  return {
    transform: {
      position: { x: transform[0][2], y: transform[1][2] },
      scale: { x: scaleX, y: scaleY },
      rotation: (Math.atan2(transform[1][0], transform[0][0]) * 180) / Math.PI,
    },
    residual,
  }
}

export function multiplyTransform(left: Transform, right: Transform): Transform {
  return [
    [
      left[0][0] * right[0][0] + left[0][1] * right[1][0],
      left[0][0] * right[0][1] + left[0][1] * right[1][1],
      left[0][0] * right[0][2] + left[0][1] * right[1][2] + left[0][2],
    ],
    [
      left[1][0] * right[0][0] + left[1][1] * right[1][0],
      left[1][0] * right[0][1] + left[1][1] * right[1][1],
      left[1][0] * right[0][2] + left[1][1] * right[1][2] + left[1][2],
    ],
  ]
}

export function toPagColor(color: RGB): PagColor {
  return {
    red: Math.round(color.r * 255),
    green: Math.round(color.g * 255),
    blue: Math.round(color.b * 255),
  }
}
