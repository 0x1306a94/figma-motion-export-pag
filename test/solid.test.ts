import assert from 'node:assert/strict'
import test from 'node:test'
import { createExportTransformContext, hasSolidMarker, readNodeTransform } from '../src/export/solid'

test('#solid 仅匹配名称结束或后接空白', () => {
  assert.equal(hasSolidMarker('#solid'), true)
  assert.equal(hasSolidMarker('#solid Background'), true)
  assert.equal(hasSolidMarker('#solid\tBackground'), true)
  assert.equal(hasSolidMarker('#solidBox'), false)
  assert.equal(hasSolidMarker('Background #solid'), false)
})

test('根 Frame 水平翻转时按画布视觉坐标导出节点', () => {
  const root = {
    id: '1:37',
    name: 'Frame7',
    absoluteTransform: [
      [-1, 0, 1818],
      [0, 1, 15],
    ],
    absoluteBoundingBox: { x: 938, y: 15, width: 880, height: 1325 },
  } as unknown as FrameNode
  const node = {
    id: '1:40',
    name: 'Rectangle19',
    absoluteTransform: [
      [1, 0, 1047],
      [0, -1, 278],
    ],
  } as unknown as SceneNode
  const context = createExportTransformContext(root)
  const transform = readNodeTransform(node, context)
  assert.equal(context.width, 880)
  assert.equal(context.height, 1325)
  assert.deepEqual(transform.position, { x: 109, y: 263 })
  assert.deepEqual(transform.scale, { x: 1, y: -1 })
  assert.equal(transform.rotation, 0)
})
