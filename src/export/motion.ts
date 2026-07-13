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
import { multiplyTransform, readNodeTransform } from './solid'

interface NodeMotionContext {
  parentToExportTransform: Transform
  scaleX: number
  scaleY: number
  orientation: 1 | -1
  rotation: number
}

export interface MotionAnchor {
  x: number
  y: number
}

const motionAnchorNamespace = 'pagx'
const motionAnchorKey = 'anchor'

const supportedFields = new Set([
  'OPACITY',
  'WIDTH',
  'HEIGHT',
  'TRANSLATION_X',
  'TRANSLATION_Y',
  'TRANSLATION_XY',
  'ROTATION',
  'SCALE_X',
  'SCALE_Y',
  'SCALE_XY',
])

interface ValueMath<T> {
  add(left: T, right: T): T
  multiply(left: T, right: T): T
  interpolate(start: T, end: T, progress: number): T
  equals(left: T, right: T): boolean
}

interface PreparedTrack<T> {
  operation: ManualKeyframeTrack['keyframeOperation']
  points: Array<{ frame: number; value: T; easing: MotionEasing | VariableAlias }>
}

const numberMath: ValueMath<number> = {
  add: (left, right) => left + right,
  multiply: (left, right) => left * right,
  interpolate: (start, end, progress) => start + (end - start) * progress,
  equals: (left, right) => Math.abs(left - right) < 0.0001,
}

const pointMath: ValueMath<PagPoint> = {
  add: (left, right) => ({ x: left.x + right.x, y: left.y + right.y }),
  multiply: (left, right) => ({ x: left.x * right.x, y: left.y * right.y }),
  interpolate: (start, end, progress) => ({
    x: start.x + (end.x - start.x) * progress,
    y: start.y + (end.y - start.y) * progress,
  }),
  equals: (left, right) =>
    Math.abs(left.x - right.x) < 0.0001 && Math.abs(left.y - right.y) < 0.0001,
}

export function readMotionTransform(
  node: SceneNode,
  _root: SceneNode,
  frameRate: number,
  transform: PagTransform,
  warnings: ExportIssue[],
  context: ExportTransformContext,
  opacityMultiplier = 1,
): PagTransform {
  const animationFields = Object.keys(node.animations)
    .filter((field) => field !== 'effects')
    .filter((field) => node.animations[field as KeyframePropertyFieldName] !== undefined)
  const unsupported = animationFields.filter((field) => !supportedFields.has(field))
  if (unsupported.length > 0) fail(node, `当前版本不支持 Motion 属性：${unsupported.join('、')}。`)
  if (animationFields.length === 0) return transform
  const nodeContext = createNodeMotionContext(node, context)

  const result = { ...transform }
  const positionXY = readPointBinding(node, 'TRANSLATION_XY', frameRate, warnings)
  const positionX = readNumberBinding(node, 'TRANSLATION_X', frameRate, warnings)
  const positionY = readNumberBinding(node, 'TRANSLATION_Y', frameRate, warnings)
  if (positionXY !== undefined && (positionX !== undefined || positionY !== undefined)) {
    fail(node, 'TRANSLATION_XY 不能与 TRANSLATION_X/Y 同时使用。')
  }
  if (positionXY !== undefined) {
    const staticPosition = {
      x: node.relativeTransform[0][2],
      y: node.relativeTransform[1][2],
    }
    result.position = mapPointProperty(positionXY, (point) =>
      mapPosition({ x: staticPosition.x + point.x, y: staticPosition.y + point.y }, nodeContext),
    )
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
      nodeContext,
    )
    result.position = mappedPosition.position
    result.xPosition = mappedPosition.x
    result.yPosition = mappedPosition.y
  }

  const rotation = readNumberBinding(node, 'ROTATION', frameRate, warnings)
  if (rotation !== undefined) {
    result.rotation = mapNumberProperty(rotation, -nodeContext.orientation, nodeContext.rotation)
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
  const staticScale = getStaticPoint(transform.scale, {
    x: nodeContext.scaleX,
    y: nodeContext.scaleY * nodeContext.orientation,
  })
  const width = readSizeBinding(
    node,
    'WIDTH',
    frameRate,
    warnings,
    node.width,
    staticScale.x,
  )
  const height = readSizeBinding(
    node,
    'HEIGHT',
    frameRate,
    warnings,
    node.height,
    staticScale.y,
  )
  if (scaleXY !== undefined && (scaleX !== undefined || scaleY !== undefined)) {
    fail(node, 'SCALE_XY 不能与 SCALE_X/Y 同时使用。')
  }
  if ((width !== undefined || height !== undefined) && rotation !== undefined) {
    fail(node, '当前版本不支持 WIDTH/HEIGHT 与 ROTATION 同时动画。')
  }
  let sizeScale: PagProperty<PagPoint> | undefined
  if (width !== undefined && height !== undefined) {
    sizeScale = combineNumberProperties(width, height)
  } else if (width !== undefined) {
    sizeScale = numberToPointProperty(width, staticScale.y, true)
  } else if (height !== undefined) {
    sizeScale = numberToPointProperty(height, staticScale.x, false)
  }
  let motionScale: PagProperty<PagPoint> | undefined
  if (scaleXY !== undefined) {
    motionScale = mapPointProperty(scaleXY, (point) => ({
      x: point.x * nodeContext.scaleX,
      y: point.y * nodeContext.scaleY * nodeContext.orientation,
    }))
  } else if (scaleX !== undefined && scaleY !== undefined) {
    motionScale = combineNumberProperties(
      mapNumberProperty(scaleX, nodeContext.scaleX, 0),
      mapNumberProperty(scaleY, nodeContext.scaleY * nodeContext.orientation, 0),
    )
  } else if (scaleX !== undefined) {
    motionScale = numberToPointProperty(
      mapNumberProperty(scaleX, nodeContext.scaleX, 0),
      staticScale.y,
      true,
    )
  } else if (scaleY !== undefined) {
    motionScale = numberToPointProperty(
      mapNumberProperty(scaleY, nodeContext.scaleY * nodeContext.orientation, 0),
      staticScale.x,
      false,
    )
  }
  if (sizeScale !== undefined && motionScale !== undefined) {
    const sizeRatio = mapPointProperty(sizeScale, (point) => ({
      x: point.x / staticScale.x,
      y: point.y / staticScale.y,
    }))
    result.scale = multiplyPointProperties(motionScale, sizeRatio)
  } else {
    result.scale = sizeScale ?? motionScale ?? result.scale
  }
  if (
    rotation !== undefined ||
    (sizeScale === undefined &&
      (scaleXY !== undefined || scaleX !== undefined || scaleY !== undefined))
  ) {
    applyMotionAnchor(node, result, nodeContext)
  }
  return result
}

function createNodeMotionContext(
  node: SceneNode,
  context: ExportTransformContext,
): NodeMotionContext {
  const parent = node.parent
  const transform =
    parent !== null && 'absoluteTransform' in parent
      ? multiplyTransform(context.absoluteToExportTransform, parent.absoluteTransform)
      : context.rootToExportTransform
  const scaleX = Math.hypot(transform[0][0], transform[1][0])
  const scaleY = Math.hypot(transform[0][1], transform[1][1])
  const determinant =
    transform[0][0] * transform[1][1] - transform[0][1] * transform[1][0]
  return {
    parentToExportTransform: transform,
    scaleX,
    scaleY,
    orientation: determinant < 0 ? -1 : 1,
    rotation: (Math.atan2(transform[1][0], transform[0][0]) * 180) / Math.PI,
  }
}

export function composeAncestorMotionTransform(
  node: SceneNode,
  root: SceneNode,
  ancestors: readonly SceneNode[],
  frameRate: number,
  duration: number,
  transform: PagTransform,
  warnings: ExportIssue[],
  context: ExportTransformContext,
): PagTransform {
  if (!ancestors.some((ancestor) => hasMotion(ancestor) || readOpacity(ancestor) !== 1)) {
    return transform
  }
  const nodes = [...ancestors, node]
  const transforms = nodes.map((item, index) => {
    if (index === nodes.length - 1) return transform
    const base = {
      ...readNodeTransform(item, context),
      opacity: readOpacity(item) * 255,
    }
    return readMotionTransform(item, root, frameRate, base, warnings, context)
  })
  const positions: PagPoint[] = []
  const scales: PagPoint[] = []
  const rotations: number[] = []
  const opacities: number[] = []
  for (let frame = 0; frame <= duration; frame += 1) {
    let world = context.rootToExportTransform
    let opacity = 1
    for (let index = 0; index < nodes.length; index += 1) {
      const item = nodes[index]
      const parent = item.parent
      const parentWorld =
        parent === root || parent === null || !('absoluteTransform' in parent)
          ? context.rootToExportTransform
          : multiplyTransform(context.absoluteToExportTransform, parent.absoluteTransform)
      const local = multiplyTransform(invertTransform(parentWorld, item), readTransformAt(transforms[index], frame))
      world = multiplyTransform(world, local)
      opacity *= readNumberAt(transforms[index].opacity ?? 255, frame) / 255
    }
    const value = decomposeTransform(world, node)
    positions.push(value.position)
    scales.push(value.scale)
    rotations.push(unwrapRotation(rotations[rotations.length - 1], value.rotation))
    opacities.push(opacity * 255)
  }
  return {
    position: makeSampledProperty(positions, pointMath),
    scale: makeSampledProperty(scales, pointMath),
    rotation: makeSampledProperty(rotations, numberMath),
    opacity: makeSampledProperty(opacities, numberMath),
  }
}

function hasMotion(node: SceneNode): boolean {
  return Object.keys(node.animations).some(
    (field) => node.animations[field as KeyframePropertyFieldName] !== undefined,
  )
}

function readOpacity(node: SceneNode): number {
  return 'opacity' in node ? node.opacity : 1
}

function readTransformAt(transform: PagTransform, frame: number): Transform {
  const position = transform.position === undefined
    ? {
        x: readNumberAt(transform.xPosition ?? 0, frame),
        y: readNumberAt(transform.yPosition ?? 0, frame),
      }
    : readPointAt(transform.position, frame)
  const anchor = readPointAt(transform.anchorPoint ?? { x: 0, y: 0 }, frame)
  const scale = readPointAt(transform.scale ?? { x: 1, y: 1 }, frame)
  const rotation = (readNumberAt(transform.rotation ?? 0, frame) * Math.PI) / 180
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)
  const a = cosine * scale.x
  const b = -sine * scale.y
  const c = sine * scale.x
  const d = cosine * scale.y
  return [
    [a, b, position.x - a * anchor.x - b * anchor.y],
    [c, d, position.y - c * anchor.x - d * anchor.y],
  ]
}

function invertTransform(transform: Transform, node: SceneNode): Transform {
  const determinant =
    transform[0][0] * transform[1][1] - transform[0][1] * transform[1][0]
  if (Math.abs(determinant) < 0.000001) fail(node, 'Motion 父级包含退化变换。')
  const a = transform[1][1] / determinant
  const b = -transform[0][1] / determinant
  const c = -transform[1][0] / determinant
  const d = transform[0][0] / determinant
  return [
    [a, b, -a * transform[0][2] - b * transform[1][2]],
    [c, d, -c * transform[0][2] - d * transform[1][2]],
  ]
}

function decomposeTransform(
  transform: Transform,
  node: SceneNode,
): { position: PagPoint; scale: PagPoint; rotation: number } {
  const scaleX = Math.hypot(transform[0][0], transform[1][0])
  const scaleYLength = Math.hypot(transform[0][1], transform[1][1])
  const dotProduct = transform[0][0] * transform[0][1] + transform[1][0] * transform[1][1]
  if (scaleX < 0.000001 || scaleYLength < 0.000001 || Math.abs(dotProduct / (scaleX * scaleYLength)) > 0.0001) {
    fail(node, '父子 Motion 合成后产生 PAG Transform2D 无法表达的倾斜或退化变换。')
  }
  const determinant =
    transform[0][0] * transform[1][1] - transform[0][1] * transform[1][0]
  return {
    position: { x: transform[0][2], y: transform[1][2] },
    scale: { x: scaleX, y: determinant < 0 ? -scaleYLength : scaleYLength },
    rotation: (Math.atan2(transform[1][0], transform[0][0]) * 180) / Math.PI,
  }
}

function unwrapRotation(previous: number | undefined, value: number): number {
  if (previous === undefined) return value
  let result = value
  while (result - previous > 180) result -= 360
  while (result - previous < -180) result += 360
  return result
}

function makeSampledProperty<T>(values: T[], math: ValueMath<T>): PagProperty<T> {
  if (values.every((value) => math.equals(value, values[0]))) return values[0]
  return {
    keyframes: values.slice(0, -1).map((value, frame) => ({
      startTime: frame,
      endTime: frame + 1,
      startValue: value,
      endValue: values[frame + 1],
      interpolation: 1,
    })),
  }
}

function applyMotionAnchor(
  node: SceneNode,
  transform: PagTransform,
  context: NodeMotionContext,
): void {
  const anchor = readMotionAnchor(node)
  const nodeTransform = node.relativeTransform
  const anchorInRoot = {
    x: nodeTransform[0][0] * anchor.x + nodeTransform[0][1] * anchor.y,
    y: nodeTransform[1][0] * anchor.x + nodeTransform[1][1] * anchor.y,
  }
  const rootTransform = context.parentToExportTransform
  const anchorInExport = {
    x: rootTransform[0][0] * anchorInRoot.x + rootTransform[0][1] * anchorInRoot.y,
    y: rootTransform[1][0] * anchorInRoot.x + rootTransform[1][1] * anchorInRoot.y,
  }

  transform.anchorPoint = anchor
  if (transform.position !== undefined) {
    transform.position = mapPointProperty(transform.position, (position) => ({
      x: position.x + anchorInExport.x,
      y: position.y + anchorInExport.y,
    }))
    return
  }
  if (transform.xPosition !== undefined) {
    transform.xPosition = mapNumberProperty(transform.xPosition, 1, anchorInExport.x)
  }
  if (transform.yPosition !== undefined) {
    transform.yPosition = mapNumberProperty(transform.yPosition, 1, anchorInExport.y)
  }
}

export function readMotionAnchor(node: SceneNode): MotionAnchor {
  return readCachedMotionAnchor(node) ?? { x: node.width / 2, y: node.height / 2 }
}

export function refreshMotionAnchorCache(node: SceneNode): MotionAnchor | null {
  const anchor = inferScaleMotionAnchor(node)
  if (anchor !== null) setMotionAnchorCache(node, anchor)
  return anchor
}

export function readCachedMotionAnchor(node: SceneNode): MotionAnchor | null {
  if (!('getSharedPluginData' in node)) return null
  const value = node.getSharedPluginData(motionAnchorNamespace, motionAnchorKey)
  const [xText, yText] = value.split(',')
  const x = Number(xText)
  const y = Number(yText)
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

export function setMotionAnchorCache(node: SceneNode, anchor: MotionAnchor): void {
  if (!('setSharedPluginData' in node)) return
  node.setSharedPluginData(
    motionAnchorNamespace,
    motionAnchorKey,
    `${roundMotionValue(anchor.x)},${roundMotionValue(anchor.y)}`,
  )
}

export function clearMotionAnchorCache(node: SceneNode): void {
  if (!('setSharedPluginData' in node)) return
  node.setSharedPluginData(motionAnchorNamespace, motionAnchorKey, '')
}

function inferScaleMotionAnchor(node: SceneNode): MotionAnchor | null {
  const scale = node.animations.SCALE_XY
  const transformFields = [
    'TRANSLATION_X',
    'TRANSLATION_Y',
    'TRANSLATION_XY',
    'ROTATION',
    'SCALE_X',
    'SCALE_Y',
  ] as const
  if (
    scale === undefined ||
    scale.tracks.length === 0 ||
    !scale.tracks.every((track) => track.keyframeOperation === 'SET') ||
    transformFields.some((field) => node.animations[field] !== undefined) ||
    !('absoluteBoundingBox' in node) ||
    !('absoluteRenderBounds' in node) ||
    node.absoluteBoundingBox === null ||
    node.absoluteRenderBounds === null ||
    node.absoluteBoundingBox.width <= 0 ||
    node.absoluteBoundingBox.height <= 0
  ) {
    return null
  }

  const bounds = node.absoluteBoundingBox
  const renderBounds = node.absoluteRenderBounds
  const scaleX = renderBounds.width / bounds.width
  const scaleY = renderBounds.height / bounds.height
  if (
    !Number.isFinite(scaleX) ||
    !Number.isFinite(scaleY) ||
    (Math.abs(scaleX - 1) < 0.001 && Math.abs(scaleY - 1) < 0.001)
  ) {
    return null
  }

  const x = (renderBounds.x - bounds.x) / (1 - scaleX)
  const y = (renderBounds.y - bounds.y) / (1 - scaleY)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return {
    x: snapMotionAnchor(x, node.width),
    y: snapMotionAnchor(y, node.height),
  }
}

function snapMotionAnchor(value: number, size: number): number {
  const tolerance = Math.max(1, size * 0.03)
  for (const candidate of [0, size / 2, size]) {
    if (Math.abs(value - candidate) <= tolerance) return roundMotionValue(candidate)
  }
  return roundMotionValue(value)
}

function roundMotionValue(value: number): number {
  return Math.round(value * 10000) / 10000
}

function mapPosition(point: PagPoint, context: NodeMotionContext): PagPoint {
  const transform = context.parentToExportTransform
  return {
    x: transform[0][0] * point.x + transform[0][1] * point.y + transform[0][2],
    y: transform[1][0] * point.x + transform[1][1] * point.y + transform[1][2],
  }
}

function mapSeparatedPosition(
  x: PagProperty<number>,
  y: PagProperty<number>,
  context: NodeMotionContext,
): { position?: PagProperty<PagPoint>; x?: PagProperty<number>; y?: PagProperty<number> } {
  const transform = context.parentToExportTransform
  const axisAligned =
    (Math.abs(transform[0][1]) < 0.0001 && Math.abs(transform[1][0]) < 0.0001) ||
    (Math.abs(transform[0][0]) < 0.0001 && Math.abs(transform[1][1]) < 0.0001)
  if (!axisAligned) {
    return {
      position: mapPointProperty(combineNumberProperties(x, y), (point) => mapPosition(point, context)),
    }
  }
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

function combineNumberProperties(
  x: PagProperty<number>,
  y: PagProperty<number>,
): PagProperty<PagPoint> {
  if (!isAnimated(x) && !isAnimated(y)) return { x, y }
  const lastFrame = Math.max(getPropertyLastFrame(x), getPropertyLastFrame(y))
  const samples = Array.from({ length: lastFrame + 1 }, (_, frame) => ({
    x: evaluateNumberProperty(x, frame),
    y: evaluateNumberProperty(y, frame),
  }))
  if (samples.every((value) => pointMath.equals(value, samples[0]))) return samples[0]
  return {
    keyframes: samples.slice(0, -1).map((value, frame) => ({
      startTime: frame,
      endTime: frame + 1,
      startValue: value,
      endValue: samples[frame + 1],
      interpolation: 1,
    })),
  }
}

function multiplyPointProperties(
  left: PagProperty<PagPoint>,
  right: PagProperty<PagPoint>,
): PagProperty<PagPoint> {
  if (!isAnimated(left) && !isAnimated(right)) return pointMath.multiply(left, right)
  const lastFrame = Math.max(getPropertyLastFrame(left), getPropertyLastFrame(right))
  const samples = Array.from({ length: lastFrame + 1 }, (_, frame) =>
    pointMath.multiply(readPointAt(left, frame), readPointAt(right, frame)),
  )
  if (samples.every((value) => pointMath.equals(value, samples[0]))) return samples[0]
  return {
    keyframes: samples.slice(0, -1).map((value, frame) => ({
      startTime: frame,
      endTime: frame + 1,
      startValue: value,
      endValue: samples[frame + 1],
      interpolation: 1,
    })),
  }
}

function getPropertyLastFrame<T>(property: PagProperty<T>): number {
  if (!isAnimated(property) || property.keyframes.length === 0) return 0
  return property.keyframes[property.keyframes.length - 1].endTime
}

function evaluateNumberProperty(property: PagProperty<number>, frame: number): number {
  if (!isAnimated(property) || property.keyframes.length === 0) return property as number
  let value = property.keyframes[0].startValue
  for (const keyframe of property.keyframes) {
    if (frame < keyframe.startTime) return value
    if (frame > keyframe.endTime) {
      value = keyframe.endValue
      continue
    }
    if (frame === keyframe.endTime) return keyframe.endValue
    if (keyframe.interpolation === 3) return keyframe.startValue
    const progress = (frame - keyframe.startTime) / (keyframe.endTime - keyframe.startTime)
    if (keyframe.interpolation === 1 || keyframe.bezier === undefined) {
      return numberMath.interpolate(keyframe.startValue, keyframe.endValue, progress)
    }
    const curve = keyframe.bezier[0]
    return numberMath.interpolate(
      keyframe.startValue,
      keyframe.endValue,
      evaluateCubicBezier(progress, curve.out.x, curve.out.y, curve.in.x, curve.in.y),
    )
  }
  return value
}

function readNumberAt(property: PagProperty<number>, frame: number): number {
  return evaluateProperty(property, frame, numberMath)
}

function readPointAt(property: PagProperty<PagPoint>, frame: number): PagPoint {
  return evaluateProperty(property, frame, pointMath)
}

function evaluateProperty<T>(property: PagProperty<T>, frame: number, math: ValueMath<T>): T {
  if (!isAnimated(property) || property.keyframes.length === 0) return property as T
  let value = property.keyframes[0].startValue
  for (const keyframe of property.keyframes) {
    if (frame < keyframe.startTime) return value
    if (frame > keyframe.endTime) {
      value = keyframe.endValue
      continue
    }
    if (frame === keyframe.endTime) return keyframe.endValue
    if (keyframe.interpolation === 3) return keyframe.startValue
    const progress = (frame - keyframe.startTime) / (keyframe.endTime - keyframe.startTime)
    const eased =
      keyframe.interpolation === 2 && keyframe.bezier !== undefined
        ? evaluateCubicBezier(
            progress,
            keyframe.bezier[0].out.x,
            keyframe.bezier[0].out.y,
            keyframe.bezier[0].in.x,
            keyframe.bezier[0].in.y,
          )
        : progress
    return math.interpolate(keyframe.startValue, keyframe.endValue, eased)
  }
  return value
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
  return readNumberKeyframeBinding(node, binding, field, frameRate, warnings, mapValue)
}

export function readNumberKeyframeBinding(
  node: SceneNode,
  binding: KeyframeBinding,
  field: string,
  frameRate: number,
  warnings: ExportIssue[],
  mapValue: (value: number) => number = (value) => value,
): PagProperty<number> {
  const property = readBinding(node, binding, frameRate, warnings, (value) => {
    if (value.type !== 'FLOAT') fail(node, `${field} 必须使用 FLOAT 关键帧值。`)
    if (!Number.isFinite(value.value)) fail(node, `${field} 包含无效数值。`)
    return value.value
  }, numberMath, 1)
  return mapPropertyValues(property, mapValue)
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
  }, pointMath, dimensions)
}

function readSizeBinding(
  node: SceneNode,
  field: 'WIDTH' | 'HEIGHT',
  frameRate: number,
  warnings: ExportIssue[],
  staticSize: number,
  staticScale: number,
): PagProperty<number> | undefined {
  if (node.animations[field] === undefined) return undefined
  if (staticSize <= 0) fail(node, `${field} 动画要求节点静态尺寸大于 0。`)
  return readNumberBinding(node, field, frameRate, warnings, (value) => {
    if (value < 0) fail(node, `${field} 动画尺寸不能小于 0。`)
    return (value / staticSize) * staticScale
  })
}

function readBinding<T>(
  node: SceneNode,
  binding: KeyframeBinding,
  frameRate: number,
  warnings: ExportIssue[],
  readValue: (value: KeyframeValue) => T,
  math: ValueMath<T>,
  dimensions: number,
): PagProperty<T> {
  const baseValue = readValue(binding.baseValue)
  const tracks = binding.tracks.map((track) =>
    prepareTrack(node, track, frameRate, warnings, readValue),
  )
  if (tracks.length === 0) return baseValue
  if (tracks.length > 1) {
    return sampleTracks(node, binding, tracks, baseValue, frameRate, math)
  }

  const points = new Map<number, { value: T; easing?: MotionEasing | VariableAlias }>()
  points.set(0, { value: baseValue, easing: { type: 'HOLD' } })
  for (const point of tracks[0].points) {
    points.set(point.frame, {
      value: applyOperation(baseValue, point.value, tracks[0].operation, math),
      easing: point.easing,
    })
  }
  const ordered = [...points.entries()].sort(([left], [right]) => left - right)
  if (ordered.length === 1) return ordered[0][1].value

  const keyframes: PagKeyframe<T>[] = []
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const [startTime, start] = ordered[index]
    const [endTime, end] = ordered[index + 1]
    const easing = readEasing(node, start.easing, dimensions)
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

function prepareTrack<T>(
  node: SceneNode,
  track: ManualKeyframeTrack,
  frameRate: number,
  warnings: ExportIssue[],
  readValue: (value: KeyframeValue) => T,
): PreparedTrack<T> {
  const timelineOffset = getTimelineOffset(node, track)
  const points = new Map<number, PreparedTrack<T>['points'][number]>()
  for (const keyframe of track.keyframes) {
    if (!Number.isFinite(keyframe.timelinePosition) || keyframe.timelinePosition < 0) {
      fail(node, 'Motion 关键帧时间必须是非负有限数。')
    }
    const frame = Math.round((keyframe.timelinePosition + timelineOffset) * frameRate)
    if (points.has(frame)) {
      warnings.push({
        nodeId: node.id,
        nodeName: node.name,
        message: `第 ${frame} 帧存在关键帧碰撞，已保留后写入的值。`,
      })
    }
    points.set(frame, {
      frame,
      value: readValue(keyframe.value),
      easing: keyframe.easing,
    })
  }
  return {
    operation: track.keyframeOperation,
    points: [...points.values()].sort((left, right) => left.frame - right.frame),
  }
}

function getTimelineOffset(node: SceneNode, track: ManualKeyframeTrack): number {
  const animationPreset = (track as ManualKeyframeTrack & {
    animationPreset?: { timelineOffset?: number }
  }).animationPreset
  const timelineOffset = animationPreset?.timelineOffset ?? 0
  if (!Number.isFinite(timelineOffset) || timelineOffset < 0) {
    fail(node, 'Motion timelineOffset 必须是非负有限数。')
  }
  return timelineOffset
}

function sampleTracks<T>(
  node: SceneNode,
  binding: KeyframeBinding,
  tracks: PreparedTrack<T>[],
  baseValue: T,
  frameRate: number,
  math: ValueMath<T>,
): PagProperty<T> {
  if (!Number.isFinite(binding.timelineDuration) || binding.timelineDuration < 0) {
    fail(node, 'Motion timelineDuration 必须是非负有限数。')
  }
  const lastTrackFrame = Math.max(0, ...tracks.flatMap((track) => track.points.map((point) => point.frame)))
  const lastFrame = Math.max(Math.round(binding.timelineDuration * frameRate), lastTrackFrame)
  const samples: T[] = []
  for (let frame = 0; frame <= lastFrame; frame += 1) {
    let value = baseValue
    for (const track of tracks) {
      const trackValue = evaluateTrack(node, track, frame, math)
      if (trackValue !== undefined) value = applyOperation(value, trackValue, track.operation, math)
    }
    samples.push(value)
  }
  if (samples.every((value) => math.equals(value, samples[0]))) return samples[0]
  return {
    keyframes: samples.slice(0, -1).map((value, frame) => ({
      startTime: frame,
      endTime: frame + 1,
      startValue: value,
      endValue: samples[frame + 1],
      interpolation: 1,
    })),
  }
}

function evaluateTrack<T>(
  node: SceneNode,
  track: PreparedTrack<T>,
  frame: number,
  math: ValueMath<T>,
): T | undefined {
  if (track.points.length === 0 || frame < track.points[0].frame) return undefined
  const lastPoint = track.points[track.points.length - 1]
  if (frame >= lastPoint.frame) return lastPoint.value
  for (let index = 0; index < track.points.length - 1; index += 1) {
    const start = track.points[index]
    const end = track.points[index + 1]
    if (frame > end.frame) continue
    const progress = (frame - start.frame) / (end.frame - start.frame)
    return math.interpolate(start.value, end.value, evaluateEasing(node, start.easing, progress))
  }
  return lastPoint.value
}

function applyOperation<T>(
  baseValue: T,
  trackValue: T,
  operation: ManualKeyframeTrack['keyframeOperation'],
  math: ValueMath<T>,
): T {
  if (operation === 'SET') return trackValue
  if (operation === 'OFFSET') return math.add(baseValue, trackValue)
  return math.multiply(baseValue, trackValue)
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

function evaluateEasing(
  node: SceneNode,
  easing: MotionEasing | VariableAlias | undefined,
  progress: number,
): number {
  if (easing === undefined || easing.type === 'LINEAR') return progress
  if (easing.type === 'HOLD') return 0
  readEasing(node, easing, 1)
  const curve = easing.type === 'CUSTOM_CUBIC_BEZIER' ? easing.easingFunctionCubicBezier : undefined
  if (curve === undefined) fail(node, 'CUSTOM_CUBIC_BEZIER 缺少控制点。')

  return evaluateCubicBezier(progress, curve.x1, curve.y1, curve.x2, curve.y2)
}

function evaluateCubicBezier(
  progress: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  let lower = 0
  let upper = 1
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const parameter = (lower + upper) / 2
    if (cubicBezierCoordinate(parameter, x1, x2) < progress) {
      lower = parameter
    } else {
      upper = parameter
    }
  }
  return cubicBezierCoordinate((lower + upper) / 2, y1, y2)
}

function cubicBezierCoordinate(parameter: number, control1: number, control2: number): number {
  const inverse = 1 - parameter
  return (
    3 * inverse * inverse * parameter * control1 +
    3 * inverse * parameter * parameter * control2 +
    parameter * parameter * parameter
  )
}

function mapPropertyValues<T, U>(
  property: PagProperty<T>,
  mapValue: (value: T) => U,
): PagProperty<U> {
  if (!isAnimated(property)) return mapValue(property)
  return {
    keyframes: property.keyframes.map((keyframe) => ({
      ...keyframe,
      startValue: mapValue(keyframe.startValue),
      endValue: mapValue(keyframe.endValue),
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
