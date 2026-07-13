import type {
  PagPathCommand,
  PagShapeGeometry,
  PagShapeLayer,
  PagShapePaint,
  PagShapeStroke,
  PagGradientShapePaint,
} from './pag/types'
import { PagGradientFillType } from './pag/types'
import { multiplyTransform, toPagColor } from './solid'
import { ExportError } from './types'
import { readBlendMode } from './blend-mode'
import type { ExportIssue } from './types'
import { isSupportedGradientPaint, readVisibleFills, type SupportedGradientPaint } from './fills'

export function readShapeNode(
  node: SceneNode,
  id: number,
  duration: number,
  transform: PagShapeLayer['transform'],
  warnings: ExportIssue[] = [],
  visibleFills?: readonly Paint[] | null,
  residual: Transform = [[1, 0, 0], [0, 1, 0]],
  strokeAsFill = false,
): PagShapeLayer | null {
  if (node.type !== 'RECTANGLE' && node.type !== 'ELLIPSE' && node.type !== 'VECTOR') return null
  const geometry = readGeometry(node, residual)
  const fills = visibleFills ?? readVisibleFills(node, warnings)
  const fill = readFill(node, fills, residual)
  const stroke = strokeAsFill ? undefined : readStroke(node, warnings)
  if (fill === undefined && stroke === undefined) {
    if (strokeAsFill) return null
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

export function readOutsideStrokeLayer(
  node: RectangleNode | EllipseNode | VectorNode,
  id: number,
  duration: number,
  transform: PagShapeLayer['transform'],
  visibleFills: readonly Paint[] | null,
  residual: Transform = [[1, 0, 0], [0, 1, 0]],
): PagShapeLayer | null {
  if (
    node.strokeAlign !== 'OUTSIDE'
    || node.strokeWeight === 0
    || node.strokeWeight === figma.mixed
    || (node.type === 'VECTOR' && !hasOpaqueFill(visibleFills))
    || node.dashPattern.length > 0
    || (node.type === 'RECTANGLE' && node.cornerSmoothing !== 0)
  ) {
    return null
  }
  const strokes = node.strokes.filter((paint) => paint.visible !== false)
  if (strokes.length !== 1 || strokes[0].type !== 'SOLID') return null
  return {
    type: 'shape',
    id,
    name: `${node.name} Stroke`,
    startTime: 0,
    duration,
    transform: { ...transform, opacity: Math.round(node.opacity * 255) },
    geometry: node.type === 'VECTOR'
      ? readGeometry(node, residual)
      : readInsetGeometry(node, -node.strokeWeight / 2, residual),
    fillRule: readFillRule(node),
    stroke: makeStroke(
      node,
      strokes[0],
      node.type === 'VECTOR' ? node.strokeWeight * 2 : node.strokeWeight,
    ),
  }
}

export function readInsideStrokeLayer(
  node: RectangleNode | EllipseNode | VectorNode,
  id: number,
  duration: number,
  transform: PagShapeLayer['transform'],
  residual: Transform = [[1, 0, 0], [0, 1, 0]],
): PagShapeLayer | null {
  if (
    node.strokeAlign !== 'INSIDE'
    || node.strokeWeight === 0
    || node.strokeWeight === figma.mixed
    || node.width <= node.strokeWeight
    || node.height <= node.strokeWeight
    || node.dashPattern.length > 0
    || (node.type === 'RECTANGLE' && node.cornerSmoothing !== 0)
  ) {
    return null
  }
  const strokes = node.strokes.filter((paint) => paint.visible !== false)
  if (strokes.length !== 1 || strokes[0].type !== 'SOLID') return null
  return {
    type: 'shape',
    id,
    name: `${node.name} Stroke`,
    startTime: 0,
    duration,
    transform: { ...transform, opacity: Math.round(node.opacity * 255) },
    geometry: readInsetGeometry(node, node.strokeWeight / 2, residual),
    fillRule: readFillRule(node),
    stroke: makeStroke(node, strokes[0], node.strokeWeight),
  }
}

function readInsetGeometry(
  node: RectangleNode | EllipseNode | VectorNode,
  inset: number,
  residual: Transform,
): PagShapeGeometry {
  const width = node.width - inset * 2
  const height = node.height - inset * 2
  if (node.type === 'VECTOR') {
    const insetTransform: Transform = [
      [width / node.width, 0, inset],
      [0, height / node.height, inset],
    ]
    return readGeometry(node, multiplyTransform(residual, insetTransform))
  }
  if (node.type === 'ELLIPSE') {
    return {
      type: 'ellipse',
      size: { x: width, y: height },
      position: { x: node.width / 2, y: node.height / 2 },
    }
  }
  const radii = [
    node.topLeftRadius,
    node.topRightRadius,
    node.bottomRightRadius,
    node.bottomLeftRadius,
  ].map((radius) => Math.max(0, radius - inset))
  if (radii.every((radius) => radius === radii[0])) {
    return {
      type: 'rectangle',
      size: { x: width, y: height },
      position: { x: node.width / 2, y: node.height / 2 },
      roundness: radii[0],
    }
  }
  return {
    type: 'path',
    commands: transformPath(
      makeRoundedRectanglePath(width, height, radii),
      [[1, 0, inset], [0, 1, inset]],
    ),
  }
}

function hasOpaqueFill(fills: readonly Paint[] | null): boolean {
  if (fills === null || fills.length !== 1 || (fills[0].opacity ?? 1) !== 1) return false
  const fill = fills[0]
  if (fill.type === 'SOLID') return true
  return isSupportedGradientPaint(fill) && fill.gradientStops.every((stop) => stop.color.a === 1)
}

export function readShapePaintLayer(
  node: RectangleNode | EllipseNode | VectorNode,
  paint: SolidPaint | SupportedGradientPaint,
  id: number,
  duration: number,
  transform: PagShapeLayer['transform'],
  residual: Transform = [[1, 0, 0], [0, 1, 0]],
): PagShapeLayer {
  return {
    type: 'shape',
    id,
    name: node.name,
    startTime: 0,
    duration,
    transform,
    geometry: readGeometry(node, residual),
    fill: paint.type === 'SOLID' ? readSolidFill(node, paint) : readGradientFill(node, paint, residual),
    fillRule: readFillRule(node),
  }
}

function readGeometry(
  node: RectangleNode | EllipseNode | VectorNode,
  residual: Transform,
): PagShapeGeometry {
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
  const paths = readVectorGeometry(node)
  return readPathGeometry(node, paths, residual)
}

function readVectorGeometry(node: VectorNode): VectorPaths {
  return node.fillGeometry?.length > 0 ? node.fillGeometry : node.vectorPaths
}

function readPathGeometry(
  node: SceneNode,
  paths: VectorPaths,
  residual: Transform,
): PagShapeGeometry {
  if (paths.length === 0) throwNodeError(node, 'Vector Path 不能为空。')
  return {
    type: 'path',
    commands: paths.flatMap((path) => transformPath(parseVectorPath(node, path.data), residual)),
  }
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

function readFill(
  node: RectangleNode | EllipseNode | VectorNode,
  visibleFills: readonly Paint[] | null,
  residual: Transform,
): PagShapePaint | PagGradientShapePaint | undefined {
  if (node.fills === figma.mixed) throwNodeError(node, '当前版本不支持混合填充。')
  const fills = visibleFills ?? []
  if (fills.length === 0) return undefined
  if (fills.length !== 1) throwNodeError(node, '当前版本仅支持一个可见填充。')
  const fill = fills[0]
  if (fill.type === 'SOLID') return readSolidFill(node, fill)
  if (isSupportedGradientPaint(fill)) return readGradientFill(node, fill, residual)
  throwNodeError(node, `当前版本不支持 ${fill.type} 填充。`)
}

function readSolidFill(node: SceneNode, fill: SolidPaint): PagShapePaint {
  return {
    color: toPagColor(fill.color),
    opacity: Math.round((fill.opacity ?? 1) * 255),
    blendMode: readBlendMode(fill.blendMode, node),
  }
}

function readGradientFill(
  node: SceneNode,
  fill: SupportedGradientPaint,
  residual: Transform,
): PagGradientShapePaint {
  const points = gradientPoints(fill, 'width' in node ? node.width : 1, 'height' in node ? node.height : 1)
  return {
    kind: 'gradient',
    fillType: fill.type === 'GRADIENT_RADIAL'
      ? PagGradientFillType.Radial
      : fill.type === 'GRADIENT_ANGULAR'
        ? PagGradientFillType.Angle
        : PagGradientFillType.Linear,
    startPoint: transformPoint(points.start, residual),
    endPoint: transformPoint(points.end, residual),
    colors: {
      alphaStops: fill.gradientStops.map((stop) => ({
        position: stop.position,
        midpoint: 0.5,
        opacity: Math.round(stop.color.a * 255),
      })),
      colorStops: fill.gradientStops.map((stop) => ({
        position: stop.position,
        midpoint: 0.5,
        color: {
          red: Math.round(stop.color.r * 255),
          green: Math.round(stop.color.g * 255),
          blue: Math.round(stop.color.b * 255),
        },
      })),
    },
    opacity: Math.round((fill.opacity ?? 1) * 255),
    blendMode: readBlendMode(fill.blendMode, node),
  }
}

function transformPath(commands: PagPathCommand[], transform: Transform): PagPathCommand[] {
  return commands.map((command) => ({
    ...command,
    values: command.values.map((value, index, values) => {
      if (index % 2 !== 0) {
        const point = transformPoint({ x: values[index - 1], y: value }, transform)
        return point.y
      }
      const point = transformPoint({ x: value, y: values[index + 1] }, transform)
      return point.x
    }),
  }))
}

function transformPoint(point: { x: number; y: number }, transform: Transform): { x: number; y: number } {
  return {
    x: transform[0][0] * point.x + transform[0][1] * point.y + transform[0][2],
    y: transform[1][0] * point.x + transform[1][1] * point.y + transform[1][2],
  }
}

function gradientPoints(
  paint: SupportedGradientPaint,
  width: number,
  height: number,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const [[a, c, tx], [b, d, ty]] = paint.gradientTransform
  const determinant = a * d - b * c
  if (Math.abs(determinant) < 0.00000001) {
    return { start: { x: 0, y: height / 2 }, end: { x: width, y: height / 2 } }
  }
  const inverse: Transform = [
    [d / determinant, -c / determinant, (c * ty - d * tx) / determinant],
    [-b / determinant, a / determinant, (b * tx - a * ty) / determinant],
  ]
  const map = (x: number, y: number) => ({
    x: (inverse[0][0] * x + inverse[0][1] * y + inverse[0][2]) * width,
    y: (inverse[1][0] * x + inverse[1][1] * y + inverse[1][2]) * height,
  })
  return { start: map(0, 0.5), end: map(1, 0.5) }
}

function readStroke(
  node: RectangleNode | EllipseNode | VectorNode,
  warnings: ExportIssue[],
): PagShapeStroke | undefined {
  const strokes = node.strokes.filter((paint) => paint.visible !== false)
  if (strokes.length === 0 || node.strokeWeight === 0) return undefined
  if (strokes.length !== 1 || strokes[0].type !== 'SOLID') {
    throwNodeError(node, '当前版本仅支持一个可见纯色描边。')
  }
  if (node.strokeAlign !== 'CENTER') {
    warnings.push({
      nodeId: node.id,
      nodeName: node.name,
      message: `PAG 不支持 ${node.strokeAlign} 描边对齐，已按居中描边导出。`,
    })
  }
  if (node.dashPattern.length > 0) throwNodeError(node, '当前版本不支持虚线描边。')
  if (node.strokeWeight === figma.mixed) throwNodeError(node, '当前版本不支持不同边宽的描边。')
  return makeStroke(node, strokes[0], node.strokeWeight)
}

function makeStroke(
  node: RectangleNode | EllipseNode | VectorNode,
  stroke: SolidPaint,
  width: number,
): PagShapeStroke {
  return {
    color: toPagColor(stroke.color),
    opacity: Math.round((stroke.opacity ?? 1) * 255),
    width,
    lineCap: readLineCap(node.strokeCap),
    lineJoin: readLineJoin(node.strokeJoin),
    miterLimit: node.strokeMiterLimit,
    blendMode: readBlendMode(stroke.blendMode, node),
  }
}

function readFillRule(node: RectangleNode | EllipseNode | VectorNode): number {
  if (node.type !== 'VECTOR') return 0
  return readPathFillRule(node, readVectorGeometry(node))
}

function readPathFillRule(node: SceneNode, paths: VectorPaths): number {
  const windingRules = paths
    .map((path) => path.windingRule)
    .filter((rule) => rule !== 'NONE')
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
