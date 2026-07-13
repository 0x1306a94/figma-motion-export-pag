import type { PagAnimatedProperty, PagImage, PagImageLayer, PagPoint, PagProperty, PagTransform } from './pag/types'
import { ExportError } from './types'
import type { ExportOptions } from './types'
import { readBlendMode } from './blend-mode'

export interface ImageReadContext {
  options: ExportOptions
  imagesByHash: Map<string, Promise<PagImage>>
  nextImageId: () => number
  encodeWebP: (source: Uint8Array, mimeType: string, quality: number) => Promise<Uint8Array>
}

export interface ImageFit {
  scale: number
  offset: PagPoint
}

export interface ImageReadResult {
  layer: PagImageLayer
  fit: ImageFit
}

export async function readImageNode(
  node: SceneNode,
  id: number,
  duration: number,
  transform: PagTransform,
  context: ImageReadContext,
): Promise<ImageReadResult | null> {
  if (node.type !== 'RECTANGLE' || node.fills === figma.mixed) return null
  const fills = (node.fills as readonly Paint[]).filter((paint) => paint.visible !== false)
  if (fills.length !== 1 || fills[0].type !== 'IMAGE') return null
  return readImagePaintLayer(node, fills[0], id, duration, transform, context)
}

export async function readImagePaintLayer(
  node: RectangleNode,
  paint: ImagePaint,
  id: number,
  duration: number,
  transform: PagTransform,
  context: ImageReadContext,
  opacityMultiplier = node.opacity,
): Promise<ImageReadResult> {
  validateImageNode(node, paint)
  const image = await getImage(paint, node, context)
  const fitted = fitImage(node, image, paint.scaleMode)
  return {
    layer: {
      type: 'image',
      id,
      imageId: image.id,
      name: node.name,
      startTime: 0,
      duration,
      blendMode: readBlendMode(paint.blendMode, node),
      transform: {
        ...transform,
        opacity: Math.round(opacityMultiplier * (paint.opacity ?? 1) * 255),
      },
      masks: fitted.mask === undefined ? undefined : [{ id: 1, commands: fitted.mask }],
    },
    fit: { scale: fitted.scale, offset: fitted.offset },
  }
}

export function applyImageFit(transform: PagTransform, fit: ImageFit): PagTransform {
  const scale = mapPointProperty(transform.scale ?? { x: 1, y: 1 }, (value) => ({
    x: value.x * fit.scale,
    y: value.y * fit.scale,
  }))
  const anchorPoint = mapPointProperty(transform.anchorPoint ?? { x: 0, y: 0 }, (value) => ({
    x: (value.x - fit.offset.x) / fit.scale,
    y: (value.y - fit.offset.y) / fit.scale,
  }))
  return { ...transform, anchorPoint, scale }
}

function validateImageNode(
  node: RectangleNode,
  paint: ImagePaint,
): asserts paint is ImagePaint & { imageHash: string; scaleMode: 'FIT' | 'FILL' } {
  if (node.animations.WIDTH !== undefined || node.animations.HEIGHT !== undefined) {
    fail(node, '图片图层暂不支持 WIDTH/HEIGHT Motion，请使用 Scale Motion。')
  }
  if (paint.imageHash === null) fail(node, '图片填充缺少 imageHash。')
  if (paint.scaleMode !== 'FIT' && paint.scaleMode !== 'FILL') {
    fail(node, '当前版本仅支持 FIT 和 FILL 图片填充。')
  }
  if ((paint.rotation ?? 0) !== 0) fail(node, '当前版本不支持图片填充旋转。')
  if (paint.filters !== undefined && Object.values(paint.filters).some((value) => value !== 0)) {
    fail(node, '当前版本不支持图片滤镜。')
  }
  if (
    node.topLeftRadius !== 0 ||
    node.topRightRadius !== 0 ||
    node.bottomLeftRadius !== 0 ||
    node.bottomRightRadius !== 0
  ) {
    fail(node, '当前版本不支持带圆角裁剪的图片填充。')
  }
  const hasStroke =
    node.strokeWeight !== figma.mixed &&
    node.strokeWeight > 0 &&
    node.strokes.some((stroke) => stroke.visible !== false)
  if (hasStroke) fail(node, '图片填充矩形不能包含可见描边。')
}

async function getImage(
  paint: ImagePaint & { imageHash: string; scaleMode: 'FIT' | 'FILL' },
  node: RectangleNode,
  context: ImageReadContext,
): Promise<PagImage> {
  const hash = paint.imageHash
  const existing = context.imagesByHash.get(hash)
  if (existing !== undefined) return existing
  const promise = (async () => {
    const source = figma.getImageByHash(hash)
    if (source === null) fail(node, '无法读取图片填充的原始数据。')
    const [originalBytes, size] = await Promise.all([source.getBytesAsync(), source.getSizeAsync()])
    const mimeType = detectImageMimeType(originalBytes)
    let bytes = originalBytes
    if (context.options.webpEnabled) {
      bytes = await context.encodeWebP(originalBytes, mimeType, context.options.webpQuality)
    }
    if (context.options.webpEnabled && !isWebP(bytes)) fail(node, 'UI 返回的数据不是有效 WebP。')
    return {
      id: context.nextImageId(),
      width: size.width,
      height: size.height,
      bytes,
      explicitSize: !isWebP(bytes),
    }
  })()
  context.imagesByHash.set(hash, promise)
  return promise
}

function fitImage(
  node: RectangleNode,
  image: PagImage,
  scaleMode: 'FIT' | 'FILL',
): ImageFit & { mask?: import('./pag/types').PagPathCommand[] } {
  const widthScale = node.width / image.width
  const heightScale = node.height / image.height
  const imageScale =
    scaleMode === 'FIT' ? Math.min(widthScale, heightScale) : Math.max(widthScale, heightScale)
  const offsetX = (node.width - image.width * imageScale) / 2
  const offsetY = (node.height - image.height * imageScale) / 2
  if (scaleMode !== 'FILL' || Math.abs(widthScale - heightScale) <= 0.0001) {
    return { scale: imageScale, offset: { x: offsetX, y: offsetY } }
  }
  const left = -offsetX / imageScale
  const top = -offsetY / imageScale
  const right = (node.width - offsetX) / imageScale
  const bottom = (node.height - offsetY) / imageScale
  return {
    scale: imageScale,
    offset: { x: offsetX, y: offsetY },
    mask: [
      { type: 'move', values: [left, top] },
      { type: 'line', values: [right, top] },
      { type: 'line', values: [right, bottom] },
      { type: 'line', values: [left, bottom] },
      { type: 'close', values: [] },
    ],
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

function isAnimated<T>(property: PagProperty<T>): property is PagAnimatedProperty<T> {
  return typeof property === 'object' && property !== null && 'keyframes' in property
}

function detectImageMimeType(bytes: Uint8Array): string {
  if (isWebP(bytes)) return 'image/webp'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  throw new ExportError([{ message: '当前版本仅支持 PNG、JPEG 或 WebP 图片源。' }])
}

function isWebP(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
}

function fail(node: SceneNode, message: string): never {
  throw new ExportError([{ nodeId: node.id, nodeName: node.name, message }])
}
