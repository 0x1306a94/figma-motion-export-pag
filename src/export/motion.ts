import type {
  PagAnimatedProperty,
  PagKeyframe,
  PagPoint,
  PagProperty,
  PagTransform,
} from './pag/types'
import type { ExportIssue } from './types'
import { ExportError } from './types'
import type { ExportTransformContext } from './solid'

const supportedFields = new Set([
  'OPACITY',
  'TRANSLATION_X',
  'TRANSLATION_Y',
  'TRANSLATION_XY',
  'ROTATION',
  'SCALE_X',
  'SCALE_Y',
  'SCALE_XY',
])

export function readMotionTransform(
  node: SceneNode,
  root: FrameNode,
  frameRate: number,
  transform: PagTransform,
  warnings: ExportIssue[],
  context: ExportTransformContext,
  opacityMultiplier = 1,
): PagTransform {
  const animationFields = Object.keys(node.animations).filter(
    (field) => node.animations[field as KeyframePropertyFieldName] !== undefined,
  )
  const unsupported = animationFields.filter((field) => !supportedFields.has(field))
  if (unsupported.length > 0) fail(node, `当前版本不支持 Motion 属性：${unsupported.join('、')}。`)
  if (animationFields.length === 0) return transform
  if (node.parent !== root) fail(node, '当前版本仅支持顶层 Frame 的直接子图层使用 Motion。')

  const result = { ...transform }
  const positionXY = readPointBinding(node, 'TRANSLATION_XY', frameRate, warnings)
  const positionX = readNumberBinding(node, 'TRANSLATION_X', frameRate, warnings)
  const positionY = readNumberBinding(node, 'TRANSLATION_Y', frameRate, warnings)
  if (positionXY !== undefined && (positionX !== undefined || positionY !== undefined)) {
    fail(node, 'TRANSLATION_XY 不能与 TRANSLATION_X/Y 同时使用。')
  }
  if (positionXY !== undefined) {
    result.position = mapPointProperty(positionXY, (point) => mapPosition(point, context))
    result.xPosition = undefined
    result.yPosition = undefined
  } else if (positionX !== undefined || positionY !== undefined) {
    const staticPosition = {
      x: node.relativeTransform[0][2],
      y: node.relativeTransform[1][2],
    }
    const mappedPosition = mapSeparatedPosition(
      positionX ?? staticPosition.x,
      positionY ?? staticPosition.y,
      context,
    )
    result.position = undefined
    result.xPosition = mappedPosition.x
    result.yPosition = mappedPosition.y
  }

  const rotation = readNumberBinding(node, 'ROTATION', frameRate, warnings)
  if (rotation !== undefined) {
    result.rotation = mapNumberProperty(rotation, context.orientation, context.rotation)
  }
  const opacity = readNumberBinding(
    node,
    'OPACITY',
    frameRate,
    warnings,
    (value) => {
      if (value < 0 || value > 1) fail(node, 'OPACITY 关键帧值必须在 0～1 之间。')
      return value * opacityMultiplier * 255
    },
  )
  if (opacity !== undefined) result.opacity = opacity

  const scaleXY = readPointBinding(node, 'SCALE_XY', frameRate, warnings)
  const scaleX = readNumberBinding(node, 'SCALE_X', frameRate, warnings)
  const scaleY = readNumberBinding(node, 'SCALE_Y', frameRate, warnings)
  if (scaleXY !== undefined && (scaleX !== undefined || scaleY !== undefined)) {
    fail(node, 'SCALE_XY 不能与 SCALE_X/Y 同时使用。')
  }
  if (scaleX !== undefined && scaleY !== undefined) {
    fail(node, '当前版本不支持独立的 SCALE_X 与 SCALE_Y 同时动画，请使用 SCALE_XY。')
  }
  if (scaleXY !== undefined) {
    result.scale = mapPointProperty(scaleXY, (point) => ({
      x: point.x * context.scale,
      y: point.y * context.scale * context.orientation,
    }))
  } else if (scaleX !== undefined) {
    result.scale = numberToPointProperty(
      mapNumberProperty(scaleX, context.scale, 0),
      getStaticPoint(transform.scale, { x: context.scale, y: context.scale * context.orientation }).y,
      true,
    )
  } else if (scaleY !== undefined) {
    result.scale = numberToPointProperty(
      mapNumberProperty(scaleY, context.scale * context.orientation, 0),
      getStaticPoint(transform.scale, { x: context.scale, y: context.scale * context.orientation }).x,
      false,
    )
  }
  return result
}

function mapPosition(point: PagPoint, context: ExportTransformContext): PagPoint {
  const transform = context.rootToExportTransform
  return {
    x: transform[0][0] * point.x + transform[0][1] * point.y + transform[0][2],
    y: transform[1][0] * point.x + transform[1][1] * point.y + transform[1][2],
  }
}

function mapSeparatedPosition(
  x: PagProperty<number>,
  y: PagProperty<number>,
  context: ExportTransformContext,
): { x: PagProperty<number>; y: PagProperty<number> } {
  const transform = context.rootToExportTransform
  return {
    x: mapAxisProperty(x, y, transform[0][0], transform[0][1], transform[0][2]),
    y: mapAxisProperty(x, y, transform[1][0], transform[1][1], transform[1][2]),
  }
}

function mapAxisProperty(
  x: PagProperty<number>,
  y: PagProperty<number>,
  xFactor: number,
  yFactor: number,
  offset: number,
): PagProperty<number> {
  if (Math.abs(xFactor) > 0.0001) return mapNumberProperty(x, xFactor, offset)
  return mapNumberProperty(y, yFactor, offset)
}

function mapNumberProperty(
  property: PagProperty<number>,
  factor: number,
  offset: number,
): PagProperty<number> {
  if (!isAnimated(property)) return property * factor + offset
  return {
    keyframes: property.keyframes.map((keyframe) => ({
      ...keyframe,
      startValue: keyframe.startValue * factor + offset,
      endValue: keyframe.endValue * factor + offset,
    })),
  }
}

function mapPointProperty(
  property: PagProperty<PagPoint>,
  mapValue: (value: PagPoint) => PagPoint,
): PagProperty<PagPoint> {
  if (!isAnimated(property)) return mapValue(property)
  return {
    keyframes: property.keyframes.map((keyframe) => ({
      ...keyframe,
      startValue: mapValue(keyframe.startValue),
      endValue: mapValue(keyframe.endValue),
    })),
  }
}

function readNumberBinding(
  node: SceneNode,
  field: KeyframePropertyFieldName,
  frameRate: number,
  warnings: ExportIssue[],
  mapValue: (value: number) => number = (value) => value,
): PagProperty<number> | undefined {
  const binding = node.animations[field]
  if (binding === undefined) return undefined
  return readBinding(node, binding, frameRate, warnings, (value) => {
    if (value.type !== 'FLOAT') fail(node, `${field} 必须使用 FLOAT 关键帧值。`)
    if (!Number.isFinite(value.value)) fail(node, `${field} 包含无效数值。`)
    return mapValue(value.value)
  }, 1)
}

function readPointBinding(
  node: SceneNode,
  field: KeyframePropertyFieldName,
  frameRate: number,
  warnings: ExportIssue[],
): PagProperty<PagPoint> | undefined {
  const binding = node.animations[field]
  if (binding === undefined) return undefined
  const dimensions = field === 'SCALE_XY' ? 2 : 1
  return readBinding(node, binding, frameRate, warnings, (value) => {
    if (value.type !== 'VECTOR') fail(node, `${field} 必须使用 VECTOR 关键帧值。`)
    if (!Number.isFinite(value.value.x) || !Number.isFinite(value.value.y)) {
      fail(node, `${field} 包含无效数值。`)
    }
    return { x: value.value.x, y: value.value.y }
  }, dimensions)
}

function readBinding<T>(
  node: SceneNode,
  binding: KeyframeBinding,
  frameRate: number,
  warnings: ExportIssue[],
  readValue: (value: KeyframeValue) => T,
  dimensions: number,
): PagProperty<T> {
  if (binding.tracks.length !== 1) fail(node, '每个 Motion 属性仅支持一条 track。')
  const track = binding.tracks[0]
  if (track.keyframeOperation !== 'SET') fail(node, 'Motion track 仅支持 SET 操作。')

  const points = new Map<number, { value: T; easing?: MotionEasing | VariableAlias }>()
  points.set(0, { value: readValue(binding.baseValue) })
  const keyframeFrames = new Set<number>()
  for (const keyframe of track.keyframes) {
    if (!Number.isFinite(keyframe.timelinePosition) || keyframe.timelinePosition < 0) {
      fail(node, 'Motion 关键帧时间必须是非负有限数。')
    }
    const frame = Math.round(keyframe.timelinePosition * frameRate)
    if (keyframeFrames.has(frame)) {
      warnings.push({
        nodeId: node.id,
        nodeName: node.name,
        message: `第 ${frame} 帧存在关键帧碰撞，已保留后写入的值。`,
      })
    }
    keyframeFrames.add(frame)
    points.set(frame, { value: readValue(keyframe.value), easing: keyframe.easing })
  }
  const ordered = [...points.entries()].sort(([left], [right]) => left - right)
  if (ordered.length === 1) return ordered[0][1].value

  const keyframes: PagKeyframe<T>[] = []
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const [startTime, start] = ordered[index]
    const [endTime, end] = ordered[index + 1]
    const easing = readEasing(node, end.easing, dimensions)
    keyframes.push({
      startTime,
      endTime,
      startValue: start.value,
      endValue: end.value,
      interpolation: easing.interpolation,
      bezier: easing.bezier,
    })
  }
  return { keyframes }
}

function readEasing(
  node: SceneNode,
  easing: MotionEasing | VariableAlias | undefined,
  dimensions: number,
): Pick<PagKeyframe<unknown>, 'interpolation' | 'bezier'> {
  if (easing === undefined || easing.type === 'LINEAR') return { interpolation: 1 }
  if (easing.type === 'HOLD') return { interpolation: 3 }
  if (easing.type !== 'CUSTOM_CUBIC_BEZIER') {
    fail(node, `当前版本不支持 ${easing.type} 缓动。`)
  }
  const curve = easing.easingFunctionCubicBezier
  if (curve === undefined) fail(node, 'CUSTOM_CUBIC_BEZIER 缺少控制点。')
  if (![curve.x1, curve.y1, curve.x2, curve.y2].every(Number.isFinite)) {
    fail(node, 'CUSTOM_CUBIC_BEZIER 包含无效控制点。')
  }
  return {
    interpolation: 2,
    bezier: Array.from({ length: dimensions }, () => ({
      out: { x: curve.x1, y: curve.y1 },
      in: { x: curve.x2, y: curve.y2 },
    })),
  }
}

function numberToPointProperty(
  property: PagProperty<number>,
  otherValue: number,
  isX: boolean,
): PagProperty<PagPoint> {
  if (!isAnimated(property)) return isX ? { x: property, y: otherValue } : { x: otherValue, y: property }
  return {
    keyframes: property.keyframes.map((keyframe) => ({
      ...keyframe,
      startValue: isX
        ? { x: keyframe.startValue, y: otherValue }
        : { x: otherValue, y: keyframe.startValue },
      endValue: isX
        ? { x: keyframe.endValue, y: otherValue }
        : { x: otherValue, y: keyframe.endValue },
      bezier: keyframe.bezier === undefined ? undefined : [keyframe.bezier[0], keyframe.bezier[0]],
    })),
  }
}

function getStaticPoint(property: PagProperty<PagPoint> | undefined, fallback: PagPoint): PagPoint {
  return property !== undefined && !isAnimated(property) ? property : fallback
}

function isAnimated<T>(property: PagProperty<T>): property is PagAnimatedProperty<T> {
  return typeof property === 'object' && property !== null && 'keyframes' in property
}

function fail(node: SceneNode, message: string): never {
  throw new ExportError([{ nodeId: node.id, nodeName: node.name, message }])
}
