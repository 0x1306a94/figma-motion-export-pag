import assert from 'node:assert/strict'
import test from 'node:test'
import { encodePagFile } from '../src/export/pag/encode-file'
import { solidFixture } from './fixtures'

test('生成未压缩 PAG 文件头和完整 body 长度', () => {
  const bytes = encodePagFile(solidFixture)
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 3)), 'PAG')
  assert.equal(bytes[3], 1)
  assert.equal(bytes[8], 'U'.charCodeAt(0))
  assert.equal(new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true), bytes.length - 9)
  assert.deepEqual([...bytes.subarray(bytes.length - 2)], [0, 0])
})
