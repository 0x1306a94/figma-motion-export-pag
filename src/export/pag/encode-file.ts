import { EncodeStream } from './encode-stream'
import type {
  PagColor,
  PagComposition,
  PagLayer,
  PagAnimatedProperty,
  PagPathCommand,
  PagPoint,
  PagProperty,
  PagShapeLayer,
  PagTransform,
} from './types'

const enum TagCode {
  End = 0,
  VectorCompositionBlock = 2,
  CompositionAttributes = 3,
  LayerBlock = 5,
  SolidColor = 7,
  Transform2D = 13,
  MaskBlock = 14,
  MaskBlockV2 = 84,
  ImageReference = 11,
  Rectangle = 16,
  Ellipse = 17,
  ShapePath = 19,
  Fill = 20,
  Stroke = 21,
  ImageBytes = 47,
  ImageBytesV3 = 49,
  LayerAttributesV2 = 52,
  FastBlurEffect = 60,
}

const enum LayerType {
  Solid = 2,
  Shape = 4,
  Image = 5,
}

export function encodePagFile(composition: PagComposition): Uint8Array {
  const body = new EncodeStream()
  for (const image of composition.images ?? []) {
    writeTag(body, image.explicitSize ? TagCode.ImageBytesV3 : TagCode.ImageBytes, (stream) => {
      stream.writeEncodedUint(image.id)
      stream.writeEncodedUint(image.bytes.length)
      stream.writeBytes(image.bytes)
      if (image.explicitSize) {
        stream.writeFloat32(1)
        stream.writeEncodedInt(image.width)
        stream.writeEncodedInt(image.height)
        stream.writeEncodedInt(0)
        stream.writeEncodedInt(0)
      }
    })
  }
  writeTag(body, TagCode.VectorCompositionBlock, (stream) => {
    stream.writeEncodedUint(composition.id)
    writeCompositionAttributes(stream, composition)
    for (const layer of composition.layers) writeLayer(stream, layer)
    writeEndTag(stream)
  })
  writeEndTag(body)

  const file = new EncodeStream()
  file.writeBytes(Uint8Array.from([0x50, 0x41, 0x47]))
  file.writeUint8(1)
  file.writeUint32(body.length)
  file.writeUint8('U'.charCodeAt(0))
  file.writeBytes(body.toUint8Array())
  return file.toUint8Array()
}

function writeCompositionAttributes(stream: EncodeStream, composition: PagComposition): void {
  writeTag(stream, TagCode.CompositionAttributes, (content) => {
    content.writeEncodedInt(composition.width)
    content.writeEncodedInt(composition.height)
    content.writeEncodedUint(composition.duration)
    content.writeFloat32(composition.frameRate)
    writeColor(content, composition.backgroundColor)
  })
}

function writeLayer(stream: EncodeStream, layer: PagLayer): void {
  writeTag(stream, TagCode.LayerBlock, (content) => {
    content.writeUint8(
      layer.type === 'solid' ? LayerType.Solid : layer.type === 'shape' ? LayerType.Shape : LayerType.Image,
    )
    content.writeEncodedUint(layer.id)
    writeLayerAttributes(content, layer)
    for (const mask of layer.masks ?? []) writeMask(content, mask)
    for (const effect of layer.effects ?? []) writeFastBlurEffect(content, effect)
    writeTransform(content, layer.transform)
    if (layer.type === 'solid') writeSolidColor(content, layer)
    else if (layer.type === 'shape') writeShape(content, layer)
    else writeTag(content, TagCode.ImageReference, (reference) => reference.writeEncodedUint(layer.imageId))
    writeEndTag(content)
  })
}

function writeFastBlurEffect(
  stream: EncodeStream,
  effect: import('./types').PagFastBlurEffect,
): void {
  writeTag(stream, TagCode.FastBlurEffect, (content) => {
    const flags = new EncodeStream()
    const values = new EncodeStream()
    writeNumberProperty(flags, values, effect.blurriness, 0)
    writeStaticByteProperty(flags, values, effect.blurDimensions, 0)
    writeStaticBooleanProperty(flags, values, effect.repeatEdgePixels, false)
    writeByteProperty(flags, values, effect.effectOpacity, 255)
    flags.writeBit(false)
    appendAttributeBlock(content, flags, values)
  })
}

function writeMask(stream: EncodeStream, mask: import('./types').PagMask): void {
  writeTag(stream, mask.feather === undefined ? TagCode.MaskBlock : TagCode.MaskBlockV2, (content) => {
    const flags = new EncodeStream()
    const values = new EncodeStream()
    values.writeEncodedUint(mask.id)
    flags.writeBit(mask.inverted ?? false)
    const maskMode = readMaskMode(mask.mode ?? 'add')
    writeValue(flags, maskMode !== 1, () => values.writeUint8(maskMode))
    writePathProperty(flags, values, mask.commands)
    if (mask.feather !== undefined) {
      writePointProperty(flags, values, mask.feather, { x: 0, y: 0 }, 'spatial')
    }
    writeByteProperty(flags, values, mask.opacity, 255)
    writeNumberProperty(flags, values, mask.expansion, 0)
    appendAttributeBlock(content, flags, values)
  })
}

function writeLayerAttributes(stream: EncodeStream, layer: PagLayer): void {
  writeTag(stream, TagCode.LayerAttributesV2, (content) => {
    const flags = new EncodeStream()
    const values = new EncodeStream()

    flags.writeBit(layer.active ?? true)
    flags.writeBit(false)
    writeOptionalValue(flags, values, false, () => undefined)
    writeOptionalValue(flags, values, false, () => undefined)
    writeOptionalValue(flags, values, layer.startTime !== 0, () => {
      values.writeEncodedUint(layer.startTime)
    })
    writeOptionalValue(flags, values, false, () => undefined)
    writeOptionalValue(flags, values, layer.trackMatteType !== undefined, () => {
      values.writeUint8(readTrackMatteType(layer.trackMatteType!))
    })
    flags.writeBit(false)

    values.writeEncodedUint(layer.duration)
    writeOptionalValue(flags, values, layer.name !== '', () => values.writeString(layer.name))

    content.writeBytes(flags.toUint8Array())
    content.writeBytes(values.toUint8Array())
  })
}

function writePathProperty(
  flags: EncodeStream,
  values: EncodeStream,
  property: import('./types').PagProperty<PagPathCommand[]>,
): void {
  flags.writeBit(true)
  if (!isAnimated(property)) {
    flags.writeBit(false)
    writePath(values, property)
    return
  }
  flags.writeBit(true)
  writeAnimatedProperty(values, property, (stream, paths) => {
    for (const path of paths) writePath(stream, path)
  })
}

function readTrackMatteType(type: NonNullable<PagLayer['trackMatteType']>): number {
  if (type === 'alpha') return 1
  if (type === 'alpha-inverted') return 2
  if (type === 'luma') return 3
  return 4
}

function readMaskMode(mode: import('./types').PagMaskMode): number {
  if (mode === 'none') return 0
  if (mode === 'add') return 1
  if (mode === 'subtract') return 2
  if (mode === 'intersect') return 3
  if (mode === 'lighten') return 4
  if (mode === 'darken') return 5
  if (mode === 'difference') return 6
  return 7
}

function writeTransform(stream: EncodeStream, transform: PagTransform): void {
  writeTag(stream, TagCode.Transform2D, (content) => {
    const flags = new EncodeStream()
    const values = new EncodeStream()

    writePointProperty(flags, values, transform.anchorPoint, { x: 0, y: 0 }, 'spatial')
    writePointProperty(flags, values, transform.position, { x: 0, y: 0 }, 'spatial')
    writeNumberProperty(flags, values, transform.xPosition, 0)
    writeNumberProperty(flags, values, transform.yPosition, 0)
    writePointProperty(flags, values, transform.scale, { x: 1, y: 1 }, 'multidimensional')
    writeNumberProperty(flags, values, transform.rotation, 0)
    writeByteProperty(flags, values, transform.opacity, 255)

    content.writeBytes(flags.toUint8Array())
    content.writeBytes(values.toUint8Array())
  })
}

function writeSolidColor(stream: EncodeStream, layer: PagLayer): void {
  if (layer.type !== 'solid') return
  writeTag(stream, TagCode.SolidColor, (content) => {
    writeColor(content, layer.color)
    content.writeEncodedInt(layer.width)
    content.writeEncodedInt(layer.height)
  })
}

function writeShape(stream: EncodeStream, layer: PagShapeLayer): void {
  const geometry = layer.geometry
  if (geometry.type === 'rectangle') {
    writeTag(stream, TagCode.Rectangle, (content) => {
      const flags = new EncodeStream()
      const values = new EncodeStream()
      flags.writeBit(false)
      writeStaticPointProperty(flags, values, geometry.size, { x: 100, y: 100 })
      writeStaticPointProperty(flags, values, geometry.position, { x: 0, y: 0 })
      writeStaticNumberProperty(flags, values, geometry.roundness, 0)
      appendAttributeBlock(content, flags, values)
    })
  } else if (geometry.type === 'ellipse') {
    writeTag(stream, TagCode.Ellipse, (content) => {
      const flags = new EncodeStream()
      const values = new EncodeStream()
      flags.writeBit(false)
      writeStaticPointProperty(flags, values, geometry.size, { x: 100, y: 100 })
      writeStaticPointProperty(flags, values, geometry.position, { x: 0, y: 0 })
      appendAttributeBlock(content, flags, values)
    })
  } else {
    writeTag(stream, TagCode.ShapePath, (content) => {
      const flags = new EncodeStream()
      const values = new EncodeStream()
      flags.writeBit(true)
      flags.writeBit(false)
      writePath(values, geometry.commands)
      appendAttributeBlock(content, flags, values)
    })
  }
  if (layer.fill !== undefined) writeFill(stream, layer)
  if (layer.stroke !== undefined) writeStroke(stream, layer)
}

function writeFill(stream: EncodeStream, layer: PagShapeLayer): void {
  const fill = layer.fill
  if (fill === undefined) return
  writeTag(stream, TagCode.Fill, (content) => {
    const flags = new EncodeStream()
    const values = new EncodeStream()
    writeValue(flags, false, () => undefined)
    writeValue(flags, false, () => undefined)
    writeValue(flags, layer.fillRule !== 0, () => values.writeUint8(layer.fillRule))
    writeStaticColorProperty(flags, values, fill.color, { red: 255, green: 0, blue: 0 })
    writeStaticByteProperty(flags, values, fill.opacity, 255)
    appendAttributeBlock(content, flags, values)
  })
}

function writeStroke(stream: EncodeStream, layer: PagShapeLayer): void {
  const stroke = layer.stroke
  if (stroke === undefined) return
  writeTag(stream, TagCode.Stroke, (content) => {
    const flags = new EncodeStream()
    const values = new EncodeStream()
    writeValue(flags, false, () => undefined)
    writeValue(flags, false, () => undefined)
    writeValue(flags, stroke.lineCap !== 0, () => values.writeUint8(stroke.lineCap))
    writeValue(flags, stroke.lineJoin !== 0, () => values.writeUint8(stroke.lineJoin))
    writeStaticNumberProperty(flags, values, stroke.miterLimit, 4)
    writeStaticColorProperty(flags, values, stroke.color, { red: 255, green: 255, blue: 255 })
    writeStaticByteProperty(flags, values, stroke.opacity, 255)
    writeStaticNumberProperty(flags, values, stroke.width, 2)
    flags.writeBit(false)
    appendAttributeBlock(content, flags, values)
  })
}

function writePath(stream: EncodeStream, commands: PagPathCommand[]): void {
  stream.writeEncodedUint(commands.length)
  const points: number[] = []
  for (const command of commands) {
    const record = command.type === 'close' ? 0 : command.type === 'move' ? 1 : command.type === 'line' ? 2 : 7
    stream.writeBits(record, 3)
    points.push(...command.values)
  }
  stream.writeFloatList(points, 0.05)
}

function writeStaticPointProperty(
  flags: EncodeStream,
  values: EncodeStream,
  value: PagPoint | undefined,
  defaultValue: PagPoint,
): void {
  const exists = value !== undefined && (value.x !== defaultValue.x || value.y !== defaultValue.y)
  flags.writeBit(exists)
  if (!exists || value === undefined) return
  flags.writeBit(false)
  values.writeFloat32(value.x)
  values.writeFloat32(value.y)
}

function writePointProperty(
  flags: EncodeStream,
  values: EncodeStream,
  property: PagProperty<PagPoint> | undefined,
  defaultValue: PagPoint,
  kind: 'spatial' | 'multidimensional',
): void {
  if (property === undefined || !isAnimated(property)) {
    writeStaticPointProperty(flags, values, property, defaultValue)
    return
  }
  flags.writeBit(true)
  flags.writeBit(true)
  if (kind === 'spatial') flags.writeBit(false)
  writeAnimatedProperty(values, property, (stream, items) => {
    if (kind === 'spatial') {
      stream.writeFloatList(items.flatMap((point) => [point.x, point.y]), 0.05)
    } else {
      for (const point of items) {
        stream.writeFloat32(point.x)
        stream.writeFloat32(point.y)
      }
    }
  })
}

function writeNumberProperty(
  flags: EncodeStream,
  values: EncodeStream,
  property: PagProperty<number> | undefined,
  defaultValue: number,
): void {
  if (property === undefined || !isAnimated(property)) {
    writeStaticNumberProperty(flags, values, property, defaultValue)
    return
  }
  flags.writeBit(true)
  flags.writeBit(true)
  writeAnimatedProperty(values, property, (stream, items) => {
    for (const item of items) stream.writeFloat32(item)
  })
}

function writeByteProperty(
  flags: EncodeStream,
  values: EncodeStream,
  property: PagProperty<number> | undefined,
  defaultValue: number,
): void {
  if (property === undefined || !isAnimated(property)) {
    writeStaticByteProperty(flags, values, property ?? defaultValue, defaultValue)
    return
  }
  flags.writeBit(true)
  flags.writeBit(true)
  writeAnimatedProperty(values, property, (stream, items) => stream.writeUnsignedList(items))
}

function writeAnimatedProperty<T>(
  stream: EncodeStream,
  property: PagAnimatedProperty<T>,
  writeValues: (stream: EncodeStream, values: T[]) => void,
): void {
  const keyframes = property.keyframes
  stream.writeEncodedUint(keyframes.length)
  for (const keyframe of keyframes) stream.writeBits(keyframe.interpolation, 2)
  stream.writeEncodedUint(keyframes[0].startTime)
  for (const keyframe of keyframes) stream.writeEncodedUint(keyframe.endTime)
  writeValues(stream, [keyframes[0].startValue, ...keyframes.map((keyframe) => keyframe.endValue)])
  const bezierValues: number[] = []
  for (const keyframe of keyframes) {
    if (keyframe.interpolation !== 2) continue
    for (const bezier of keyframe.bezier ?? []) {
      bezierValues.push(bezier.out.x, bezier.out.y, bezier.in.x, bezier.in.y)
    }
  }
  stream.writeFloatList(bezierValues, 0.005)
}

function isAnimated<T>(property: PagProperty<T>): property is PagAnimatedProperty<T> {
  return typeof property === 'object' && property !== null && 'keyframes' in property
}

function writeStaticNumberProperty(
  flags: EncodeStream,
  values: EncodeStream,
  value: number | undefined,
  defaultValue: number,
): void {
  const exists = value !== undefined && value !== defaultValue
  flags.writeBit(exists)
  if (!exists || value === undefined) return
  flags.writeBit(false)
  values.writeFloat32(value)
}

function writeStaticByteProperty(
  flags: EncodeStream,
  values: EncodeStream,
  value: number,
  defaultValue: number,
): void {
  const exists = value !== defaultValue
  flags.writeBit(exists)
  if (!exists) return
  flags.writeBit(false)
  values.writeUint8(value)
}

function writeStaticBooleanProperty(
  flags: EncodeStream,
  values: EncodeStream,
  value: boolean,
  defaultValue: boolean,
): void {
  const exists = value !== defaultValue
  flags.writeBit(exists)
  if (!exists) return
  flags.writeBit(false)
  values.writeUint8(value ? 1 : 0)
}

function writeStaticColorProperty(
  flags: EncodeStream,
  values: EncodeStream,
  value: PagColor,
  defaultValue: PagColor,
): void {
  const exists =
    value.red !== defaultValue.red || value.green !== defaultValue.green || value.blue !== defaultValue.blue
  flags.writeBit(exists)
  if (!exists) return
  flags.writeBit(false)
  writeColor(values, value)
}

function writeValue(flags: EncodeStream, exists: boolean, write: () => void): void {
  flags.writeBit(exists)
  if (exists) write()
}

function appendAttributeBlock(
  content: EncodeStream,
  flags: EncodeStream,
  values: EncodeStream,
): void {
  content.writeBytes(flags.toUint8Array())
  content.writeBytes(values.toUint8Array())
}

function writeOptionalValue(
  flags: EncodeStream,
  _values: EncodeStream,
  exists: boolean,
  writeValue: () => void,
): void {
  flags.writeBit(exists)
  if (exists) writeValue()
}

function writeColor(stream: EncodeStream, color: PagColor): void {
  stream.writeUint8(clampByte(color.red))
  stream.writeUint8(clampByte(color.green))
  stream.writeUint8(clampByte(color.blue))
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function writeTag(stream: EncodeStream, code: TagCode, writeContent: (content: EncodeStream) => void): void {
  const content = new EncodeStream()
  writeContent(content)
  const bytes = content.toUint8Array()
  const shortLength = bytes.length < 63 ? bytes.length : 63
  stream.writeUint16((code << 6) | shortLength)
  if (bytes.length >= 63) stream.writeUint32(bytes.length)
  stream.writeBytes(bytes)
}

function writeEndTag(stream: EncodeStream): void {
  stream.writeUint16(TagCode.End)
}
