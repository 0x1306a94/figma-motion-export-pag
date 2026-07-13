import assert from 'node:assert/strict'
import test from 'node:test'
import { hasSolidMarker } from '../src/export/solid'

test('#solid 仅匹配名称结束或后接空白', () => {
  assert.equal(hasSolidMarker('#solid'), true)
  assert.equal(hasSolidMarker('#solid Background'), true)
  assert.equal(hasSolidMarker('#solid\tBackground'), true)
  assert.equal(hasSolidMarker('#solidBox'), false)
  assert.equal(hasSolidMarker('Background #solid'), false)
})
