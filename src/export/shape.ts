import type {
  PagPathCommand,
  PagShapeGeometry,
  PagShapeLayer,
  PagShapePaint,
  PagShapeStroke,
} from './pag/types'
import { toPagColor } from './solid'
import { ExportError } from './types'
import { readBlendMode } from './blend-mode'

export function readShapeNode(
  node: SceneNode,
  id: number,
  duration: number,
  transform: PagShapeLayer['transform'],
): PagShapeLayer | null {
  if (node.type !== 'RECTANGLE' && node.type !== 'ELLIPSE' && node.type !== 'VECTOR') return null
  const geometry = readGeometry(node)
  const fill = readFill(node)
  const stroke = readStroke(node)
  if (fill === undefined && stroke === undefined) {
    throwNodeError(node, '图层至少需要一个可见纯色填充或描边。')
  }
  return {
    type: 'shape',
    id,
    name: node.name,
    startTime: 0,
    duration,
    transform: { ...transform, opacity: Math.round(node.opacity * 255) },
    geometry,
    fill,
    fillRule: readFillRule(node),
    stroke,
  }
}

function readGeometry(node: RectangleNode | EllipseNode | VectorNode): PagShapeGeometry {
  if (node.type === 'ELLIPSE') {
    const arc = node.arcData
    if (
      Math.abs(arc.startingAngle) > 0.0001 ||
      Math.abs(arc.endingAngle - Math.PI * 2) > 0.0001 ||
      Math.abs(arc.innerRadius) > 0.0001
    ) {
      throwNodeError(node, '当前版本仅支持完整椭圆，不支持弧形或环形。')
    }
    return {
      type: 'ellipse',
      size: { x: node.width, y: node.height },
      position: { x: node.width / 2, y: node.height / 2 },
    }
  }
  if (node.type === 'RECTANGLE') {
    if (node.cornerSmoothing !== 0) throwNodeError(node, '当前版本不支持 Corner Smoothing。')
    const radii = [
      node.topLeftRadius,
      node.topRightRadius,
      node.bottomRightRadius,
      node.bottomLeftRadius,
    ]
    if (radii.every((radius) => radius === radii[0])) {
      return {
        type: 'rectangle',
        size: { x: node.width, y: node.height },
        position: { x: node.width / 2, y: node.height / 2 },
        roundness: radii[0],
      }
    }
    return { type: 'path', commands: makeRoundedRectanglePath(node.width, node.height, radii) }
  }
  if (node.vectorPaths.length !== 1) {
    throwNodeError(node, '当前版本仅支持包含一条 Vector Path 的矢量图层。')
  }
  return { type: 'path', commands: parseVectorPath(node, node.vectorPaths[0].data) }
}

function makeRoundedRectanglePath(
  width: number,
  height: number,
  radii: readonly number[],
): PagPathCommand[] {
  const [topLeft, topRight, bottomRight, bottomLeft] = radii
  const factor = 0.5522847498
  return [
    { type: 'move', values: [topLeft, 0] },
    { type: 'line', values: [width - topRight, 0] },
    {
      type: 'curve',
      values: [width - topRight + topRight * factor, 0, width, topRight - topRight * factor, width, topRight],
    },
    { type: 'line', values: [width, height - bottomRight] },
    {
      type: 'curve',
      values: [
        width,
        height - bottomRight + bottomRight * factor,
        width - bottomRight + bottomRight * factor,
        height,
        width - bottomRight,
        height,
      ],
    },
    { type: 'line', values: [bottomLeft, height] },
    {
      type: 'curve',
      values: [bottomLeft - bottomLeft * factor, height, 0, height - bottomLeft + bottomLeft * factor, 0, height - bottomLeft],
    },
    { type: 'line', values: [0, topLeft] },
    {
      type: 'curve',
      values: [0, topLeft - topLeft * factor, topLeft - topLeft * factor, 0, topLeft, 0],
    },
    { type: 'close', values: [] },
  ]
}

function readFill(node: RectangleNode | EllipseNode | VectorNode): PagShapePaint | undefined {
  if (node.fills === figma.mixed) throwNodeError(node, '当前版本不支持混合填充。')
  const fills = (node.fills as readonly Paint[]).filter((paint) => paint.visible !== false)
  if (fills.length === 0) return undefined
  if (fills.length !== 1 || fills[0].type !== 'SOLID') {
    throwNodeError(node, '当前版本仅支持一个可见纯色填充。')
  }
  const fill = fills[0]
  return {
    color: toPagColor(fill.color),
    opacity: Math.round((fill.opacity ?? 1) * 255),
    blendMode: readBlendMode(fill.blendMode, node),
  }
}

function readStroke(node: RectangleNode | EllipseNode | VectorNode): PagShapeStroke | undefined {
  const strokes = node.strokes.filter((paint) => paint.visible !== false)
  if (strokes.length === 0 || node.strokeWeight === 0) return undefined
  if (strokes.length !== 1 || strokes[0].type !== 'SOLID') {
    throwNodeError(node, '当前版本仅支持一个可见纯色描边。')
  }
  if (node.strokeAlign !== 'CENTER') throwNodeError(node, '当前版本仅支持居中描边。')
  if (node.dashPattern.length > 0) throwNodeError(node, '当前版本不支持虚线描边。')
  if (node.strokeWeight === figma.mixed) throwNodeError(node, '当前版本不支持不同边宽的描边。')
  const stroke = strokes[0]
  return {
    color: toPagColor(stroke.color),
    opacity: Math.round((stroke.opacity ?? 1) * 255),
    width: node.strokeWeight,
    lineCap: readLineCap(node.strokeCap),
    lineJoin: readLineJoin(node.strokeJoin),
    miterLimit: node.strokeMiterLimit,
    blendMode: readBlendMode(stroke.blendMode, node),
  }
}

function readFillRule(node: RectangleNode | EllipseNode | VectorNode): number {
  if (node.type !== 'VECTOR') return 0
  const windingRules = node.vectorPaths.map((path) => path.windingRule).filter((rule) => rule !== 'NONE')
  if (windingRules.some((rule) => rule !== windingRules[0])) {
    throwNodeError(node, '当前版本不支持混合填充规则。')
  }
  return windingRules[0] === 'EVENODD' ? 1 : 0
}

function parseVectorPath(node: SceneNode, data: string): PagPathCommand[] {
  const tokens = data.match(/[MLCZ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []
  const commands: PagPathCommand[] = []
  let index = 0
  while (index < tokens.length) {
    const type = tokens[index++].toUpperCase()
    const count = type === 'M' || type === 'L' ? 2 : type === 'C' ? 6 : type === 'Z' ? 0 : -1
    if (count < 0 || index + count > tokens.length) throwNodeError(node, 'Vector Path 数据格式不受支持。')
    const values = tokens.slice(index, index + count).map(Number)
    if (values.some((value) => !Number.isFinite(value))) throwNodeError(node, 'Vector Path 包含无效数值。')
    commands.push({
      type: type === 'M' ? 'move' : type === 'L' ? 'line' : type === 'C' ? 'curve' : 'close',
      values,
    })
    index += count
  }
  if (commands.length === 0) throwNodeError(node, 'Vector Path 不能为空。')
  return commands
}

function readLineCap(value: StrokeCap | PluginAPI['mixed']): number {
  if (value === 'NONE') return 0
  if (value === 'ROUND') return 1
  if (value === 'SQUARE') return 2
  throw new ExportError([{ message: `当前版本不支持 ${String(value)} 端点样式。` }])
}

function readLineJoin(value: StrokeJoin | PluginAPI['mixed']): number {
  if (value === 'MITER') return 0
  if (value === 'ROUND') return 1
  if (value === 'BEVEL') return 2
  throw new ExportError([{ message: `当前版本不支持 ${String(value)} 连接样式。` }])
}

function throwNodeError(node: SceneNode, message: string): never {
  throw new ExportError([{ nodeId: node.id, nodeName: node.name, message }])
}
