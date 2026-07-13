import { ExportError } from './types'
import type { PagColor, PagSolidLayer, PagTransform } from './pag/types'

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

export function hasSolidMarker(name: string): boolean {
  return solidMarkerPattern.test(name)
}

export function readSolidNode(
  node: SceneNode,
  id: number,
  duration: number,
  context: ExportTransformContext,
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
  const visibleFills = (rectangle.fills as readonly Paint[]).filter((paint) => paint.visible !== false)
  if (visibleFills.length !== 1 || visibleFills[0].type !== 'SOLID') {
    fail('带 #solid 标记的矩形必须且只能包含一个可见纯色填充。')
  }
  const hasVisibleStroke =
    rectangle.strokeWeight !== figma.mixed &&
    rectangle.strokeWeight > 0 &&
    (rectangle.strokes as readonly Paint[]).some((paint) => paint.visible !== false)
  if (hasVisibleStroke) fail('带 #solid 标记的矩形不能包含可见描边。')
  if (rectangle.width <= 0 || rectangle.height <= 0) fail('带 #solid 标记的矩形宽高必须大于 0。')

  const fill = visibleFills[0] as SolidPaint
  if ((fill.blendMode ?? 'NORMAL') !== 'NORMAL') fail('带 #solid 标记的填充不能使用混合模式。')
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
    transform: {
      ...readNodeTransform(node, context),
      opacity: Math.round(rectangle.opacity * fillOpacity * 255),
    },
  }
}

export function createExportTransformContext(root: FrameNode): ExportTransformContext {
  const bounds = root.absoluteBoundingBox
  if (bounds === null) {
    throw new ExportError([{ nodeId: root.id, nodeName: root.name, message: '无法读取所选 Frame 的边界。' }])
  }
  const transform = root.absoluteTransform
  const scaleX = Math.hypot(transform[0][0], transform[1][0])
  const scaleY = Math.hypot(transform[0][1], transform[1][1])
  const dotProduct = transform[0][0] * transform[0][1] + transform[1][0] * transform[1][1]
  const rotation = Math.atan2(transform[1][0], transform[0][0])
  const quarterTurn = Math.round(rotation / (Math.PI / 2)) * (Math.PI / 2)
  if (
    scaleX === 0 ||
    scaleY === 0 ||
    Math.abs(dotProduct / (scaleX * scaleY)) > 0.0001 ||
    Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY) > 0.0001 ||
    Math.abs(rotation - quarterTurn) > 0.0001
  ) {
    throw new ExportError([
      {
        nodeId: root.id,
        nodeName: root.name,
        message: '当前版本仅支持等比缩放及 90° 倍数旋转或翻转的顶层 Frame。',
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
    rotation: (quarterTurn * 180) / Math.PI,
  }
}

export function readNodeTransform(node: SceneNode, context: ExportTransformContext): PagTransform {
  const transform = multiplyTransform(context.absoluteToExportTransform, node.absoluteTransform)
  const scaleX = Math.hypot(transform[0][0], transform[1][0])
  const scaleY = Math.hypot(transform[0][1], transform[1][1])
  const dotProduct = transform[0][0] * transform[0][1] + transform[1][0] * transform[1][1]
  if (scaleX === 0 || scaleY === 0 || Math.abs(dotProduct / (scaleX * scaleY)) > 0.0001) {
    throw new ExportError([
      { nodeId: node.id, nodeName: node.name, message: '当前版本不支持倾斜或退化的图层变换。' },
    ])
  }
  const determinant =
    transform[0][0] * transform[1][1] - transform[0][1] * transform[1][0]
  return {
    position: { x: transform[0][2], y: transform[1][2] },
    scale: { x: scaleX, y: determinant < 0 ? -scaleY : scaleY },
    rotation: (Math.atan2(transform[1][0], transform[0][0]) * 180) / Math.PI,
  }
}

function multiplyTransform(left: Transform, right: Transform): Transform {
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
