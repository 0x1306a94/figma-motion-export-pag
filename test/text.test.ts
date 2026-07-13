import assert from 'node:assert/strict'
import test from 'node:test'
import { readTextNode } from '../src/export/text'

const mixed = Symbol('mixed')
Object.defineProperty(globalThis, 'figma', { value: { mixed }, configurable: true })

function makeTextNode(): TextNode {
  return {
    id: '1:121',
    name: '不抢了',
    type: 'TEXT',
    characters: '不抢了',
    fontName: { family: 'PingFang SC', style: 'Medium' },
    fontSize: 28,
    lineHeight: { unit: 'AUTO' },
    letterSpacing: { unit: 'PIXELS', value: 0 },
    textAutoResize: 'HEIGHT',
    textAlignHorizontal: 'CENTER',
    textAlignVertical: 'CENTER',
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
    opacity: 1,
    width: 112,
    height: 39,
    relativeTransform: [[1, 0, 34.5874], [0, 1, 15.7403]],
    absoluteTransform: [[1, 0, 415.4653], [0, 1, 530.4269]],
    absoluteBoundingBox: { x: 415.4653, y: 530.4269, width: 112, height: 39 },
    absoluteRenderBounds: { x: 430.5573, y: 537.5509, width: 79.408, height: 25.816 },
    exportAsync: async () => new Uint8Array([1]),
  } as unknown as TextNode
}

test('框文本使用 Figma SVG 基线并映射回文字框坐标', async () => {
  const warnings: import('../src/export/types').ExportIssue[] = []
  const layer = await readTextNode(
    makeTextNode(),
    2,
    30,
    { absoluteToExportTransform: [[1, 0, 0], [0, 1, 0]], width: 100, height: 100 },
    warnings,
    async () => ({ baselines: [22.456] }),
  )

  assert.ok(Math.abs(layer.sourceText.firstBaseLine - 29.580) < 0.001)
  assert.equal(warnings.length, 0)
})

test('SVG 基线解析失败时保留估算值并产生警告', async () => {
  const warnings: import('../src/export/types').ExportIssue[] = []
  const layer = await readTextNode(
    makeTextNode(),
    2,
    30,
    { absoluteToExportTransform: [[1, 0, 0], [0, 1, 0]], width: 100, height: 100 },
    warnings,
    async () => { throw new Error('invalid svg') },
  )

  assert.ok(Math.abs(layer.sourceText.firstBaseLine - 22.4) < 0.001)
  assert.equal(warnings.length, 1)
})

test('点文本使用实际基线计算图层位置', async () => {
  const node = makeTextNode() as unknown as { textAutoResize: string }
  node.textAutoResize = 'WIDTH_AND_HEIGHT'
  const layer = await readTextNode(
    node as unknown as TextNode,
    2,
    30,
    { absoluteToExportTransform: [[1, 0, 0], [0, 1, 0]], width: 100, height: 100 },
    [],
    async () => ({ baselines: [22.456] }),
  )

  assert.equal(layer.sourceText.boxText, false)
  assert.ok(layer.transform.position !== undefined && !('keyframes' in layer.transform.position))
  if (layer.transform.position === undefined || 'keyframes' in layer.transform.position) return
  assert.ok(Math.abs(layer.transform.position.y - 560.0069) < 0.001)
})

test('多行文本使用 SVG 相邻基线差作为行距', async () => {
  const layer = await readTextNode(
    makeTextNode(),
    2,
    30,
    { absoluteToExportTransform: [[1, 0, 0], [0, 1, 0]], width: 100, height: 100 },
    [],
    async () => ({ baselines: [18.548, 49.548] }),
  )

  assert.ok(Math.abs(layer.sourceText.leading - 31) < 0.001)
})
