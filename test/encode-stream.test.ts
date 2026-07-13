import assert from 'node:assert/strict'
import test from 'node:test'
import { EncodeStream } from '../src/export/pag/encode-stream'

test('位流按低位优先写入并按字节对齐', () => {
  const stream = new EncodeStream()
  stream.writeBit(true)
  stream.writeBit(false)
  stream.writeBit(true)
  stream.writeUint8(0xaa)
  assert.deepEqual([...stream.toUint8Array()], [0x05, 0xaa])
})

test('无符号与有符号变长整数符合 PAG 编码', () => {
  const stream = new EncodeStream()
  stream.writeEncodedUint(127)
  stream.writeEncodedUint(128)
  stream.writeEncodedInt(-2)
  stream.writeEncodedInt(2)
  assert.deepEqual([...stream.toUint8Array()], [0x7f, 0x80, 0x01, 0x05, 0x04])
})
