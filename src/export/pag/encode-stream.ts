export class EncodeStream {
  private bytes: number[] = []
  private currentByte = 0
  private bitOffset = 0

  get length(): number {
    return this.bytes.length + (this.bitOffset > 0 ? 1 : 0)
  }

  writeBit(value: boolean): void {
    if (value) this.currentByte |= 1 << this.bitOffset
    this.bitOffset += 1
    if (this.bitOffset === 8) this.flushBits()
  }

  writeBits(value: number, count: number): void {
    for (let index = 0; index < count; index += 1) {
      this.writeBit(((value >>> index) & 1) === 1)
    }
  }

  align(): void {
    if (this.bitOffset > 0) this.flushBits()
  }

  writeUint8(value: number): void {
    this.align()
    this.bytes.push(value & 0xff)
  }

  writeUint16(value: number): void {
    this.align()
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff)
  }

  writeUint32(value: number): void {
    this.align()
    this.bytes.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    )
  }

  writeFloat32(value: number): void {
    const buffer = new ArrayBuffer(4)
    new DataView(buffer).setFloat32(0, value, true)
    this.writeBytes(new Uint8Array(buffer))
  }

  writeEncodedUint(value: number): void {
    this.align()
    let remaining = Math.floor(value)
    do {
      let byte = remaining % 128
      remaining = Math.floor(remaining / 128)
      if (remaining > 0) byte |= 0x80
      this.bytes.push(byte)
    } while (remaining > 0)
  }

  writeEncodedInt(value: number): void {
    const encoded = Math.abs(Math.trunc(value)) * 2 + (value < 0 ? 1 : 0)
    this.writeEncodedUint(encoded)
  }

  writeFloatList(values: readonly number[], precision: number): void {
    if (values.length === 0) {
      this.writeBits(0, 5)
      return
    }
    const integers = values.map((value) => Math.round(value / precision))
    let bitLength = 1
    for (const value of integers) {
      const required = Math.min(32, signedBitLength(value))
      bitLength = Math.max(bitLength, required)
    }
    this.writeBits(bitLength - 1, 5)
    for (const value of integers) this.writeBits(value, bitLength)
  }

  writeUnsignedList(values: readonly number[]): void {
    let bitLength = 1
    for (const value of values) {
      const integer = Math.max(0, Math.round(value))
      const required = integer === 0 ? 1 : Math.floor(Math.log2(integer)) + 1
      bitLength = Math.max(bitLength, required)
    }
    this.writeBits(bitLength - 1, 5)
    for (const value of values) this.writeBits(Math.max(0, Math.round(value)), bitLength)
  }

  writeString(value: string): void {
    this.writeBytes(encodeUtf8(value))
    this.writeUint8(0)
  }

  writeBytes(value: Uint8Array): void {
    this.align()
    for (const byte of value) this.bytes.push(byte)
  }

  toUint8Array(): Uint8Array {
    this.align()
    return Uint8Array.from(this.bytes)
  }

  private flushBits(): void {
    this.bytes.push(this.currentByte)
    this.currentByte = 0
    this.bitOffset = 0
  }
}

function signedBitLength(value: number): number {
  const absolute = Math.abs(Math.trunc(value))
  const magnitude = absolute === 0 ? 1 : Math.floor(Math.log2(absolute)) + 1
  return Math.min(31, magnitude) + 1
}

function encodeUtf8(value: string): Uint8Array {
  const bytes: number[] = []
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index)
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < value.length) {
      const trailing = value.charCodeAt(index + 1)
      if (trailing >= 0xdc00 && trailing <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (trailing - 0xdc00)
        index += 1
      }
    }
    if (codePoint <= 0x7f) {
      bytes.push(codePoint)
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f))
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      )
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      )
    }
  }
  return Uint8Array.from(bytes)
}
