import assert from 'node:assert/strict'
import test from 'node:test'
import { createExportTransformContext, hasSolidMarker, readNodeTransform, readSolidNode } from '../src/export/solid'
import { readBlendMode } from '../src/export/blend-mode'
import { PagBlendMode } from '../src/export/pag/types'

test('#solid 仅匹配名称结束或后接空白', () => {
  assert.equal(hasSolidMarker('#solid'), true)
  assert.equal(hasSolidMarker('#solid Background'), true)
  assert.equal(hasSolidMarker('#solid\tBackground'), true)
  assert.equal(hasSolidMarker('#solidBox'), false)
  assert.equal(hasSolidMarker('Background #solid'), false)
})

test('Figma 混合模式映射为 PAG BlendMode', () => {
  const node = { id: '1:1', name: 'Blend' } as unknown as SceneNode
  assert.equal(readBlendMode('MULTIPLY', node), PagBlendMode.Multiply)
  assert.equal(readBlendMode('LINEAR_DODGE', node), PagBlendMode.Add)
  assert.throws(() => readBlendMode('LINEAR_BURN', node), /PAG 不支持 LINEAR_BURN/)
})

test('#solid 纯色填充保留混合模式', () => {
  Object.defineProperty(globalThis, 'figma', {
    value: { mixed: Symbol('mixed') },
    configurable: true,
  })
  const node = {
    id: '12:33',
    name: '#solid Rectangle 33',
    type: 'RECTANGLE',
    topLeftRadius: 0,
    topRightRadius: 0,
    bottomLeftRadius: 0,
    bottomRightRadius: 0,
    fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, blendMode: 'MULTIPLY' }],
    strokes: [],
    strokeWeight: 0,
    width: 100,
    height: 50,
    opacity: 1,
    absoluteTransform: [
      [1, 0, 10],
      [0, 1, 20],
    ],
  } as unknown as RectangleNode
  const layer = readSolidNode(node, 2, 30, {
    width: 100,
    height: 50,
    absoluteToExportTransform: [[1, 0, 0], [0, 1, 0]],
    rootToExportTransform: [[1, 0, 0], [0, 1, 0]],
    scale: 1,
    orientation: 1,
    rotation: 0,
  })
  assert.equal(layer?.blendMode, PagBlendMode.Multiply)
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
