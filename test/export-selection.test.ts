import assert from 'node:assert/strict'
import test from 'node:test'
import { exportSelection, readRootBackgroundLayer } from '../src/export/export-selection'

const mixed = Symbol('mixed')
Object.defineProperty(globalThis, 'figma', { value: { mixed }, configurable: true })

test('根 Frame 纯色填充导出为全画布 Solid Layer', () => {
  const root = {
    id: '1:37',
    name: 'Frame7',
    opacity: 0.8,
    fills: [
      {
        type: 'SOLID',
        color: { r: 1, g: 0.5, b: 0 },
        opacity: 0.5,
        visible: true,
      },
    ],
  } as unknown as FrameNode
  const layer = readRootBackgroundLayer(root, 7, 60, 880, 1325)
  assert.deepEqual(layer, {
    type: 'solid',
    id: 7,
    name: 'Frame7 Background',
    startTime: 0,
    duration: 60,
    width: 880,
    height: 1325,
    color: { red: 255, green: 128, blue: 0 },
    blendMode: 0,
    transform: { opacity: 102 },
  })
})

test('根 Frame 渐变填充明确提示暂未实现', () => {
  const root = {
    id: '1:37',
    name: 'Frame7',
    opacity: 1,
    fills: [{ type: 'GRADIENT_LINEAR', visible: true }],
  } as unknown as FrameNode
  assert.throws(
    () => readRootBackgroundLayer(root, 7, 60, 880, 1325),
    /渐变填充暂未实现/,
  )
})

test('Figma 从底到顶的图层顺序会转换为 PAG 从顶到底的顺序', async () => {
  const root = {
    id: '1:1',
    name: 'Root',
    type: 'FRAME',
    parent: { type: 'PAGE' },
    animations: {},
    timelines: [{ duration: 1 }],
    absoluteTransform: [
      [1, 0, 0],
      [0, 1, 0],
    ],
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    opacity: 1,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, visible: true }],
    children: [] as SceneNode[],
  }
  const makeSolid = (id: string, name: string): SceneNode =>
    ({
      id,
      name: `#solid ${name}`,
      type: 'RECTANGLE',
      parent: root,
      visible: true,
      animations: {},
      effects: [],
      blendMode: 'NORMAL',
      isMask: false,
      topLeftRadius: 0,
      topRightRadius: 0,
      bottomLeftRadius: 0,
      bottomRightRadius: 0,
      fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, visible: true }],
      strokes: [],
      strokeWeight: 0,
      width: 20,
      height: 20,
      opacity: 1,
      absoluteTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ],
    }) as unknown as SceneNode
  root.children.push(makeSolid('1:2', 'Bottom'), makeSolid('1:3', 'Top'))

  const result = await exportSelection(
    [root as unknown as FrameNode],
    { frameRate: 30, webpEnabled: false, webpQuality: 80 },
    async (bytes) => bytes,
  )
  const content = new TextDecoder().decode(result.bytes)
  const topIndex = content.indexOf('Top')
  const bottomIndex = content.indexOf('Bottom')
  const backgroundIndex = content.indexOf('Root Background')
  assert.ok(topIndex >= 0 && topIndex < bottomIndex)
  assert.ok(bottomIndex < backgroundIndex)
})

test('Figma Mask 导出为目标图层前的 PAG Track Matte', async () => {
  const root = {
    id: '12:2',
    name: 'Frame9',
    type: 'FRAME',
    parent: { type: 'PAGE' },
    animations: {},
    timelines: [{ duration: 1 }],
    absoluteTransform: [
      [1, 0, 0],
      [0, 1, 0],
    ],
    absoluteBoundingBox: { x: 0, y: 0, width: 812, height: 1229 },
    opacity: 1,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, visible: true }],
    children: [] as SceneNode[],
  }
  const rectangle = (id: string, name: string, isMask: boolean, x: number, y: number) =>
    ({
      id,
      name,
      type: 'RECTANGLE',
      visible: true,
      animations: {},
      effects: [],
      blendMode: 'NORMAL',
      isMask,
      maskType: 'ALPHA',
      cornerSmoothing: 0,
      topLeftRadius: 0,
      topRightRadius: 0,
      bottomLeftRadius: 0,
      bottomRightRadius: 0,
      fills: [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8 }, visible: true }],
      strokes: [],
      strokeWeight: 0,
      strokeAlign: 'CENTER',
      dashPattern: [],
      strokeCap: 'NONE',
      strokeJoin: 'MITER',
      strokeMiterLimit: 4,
      width: 100,
      height: 100,
      opacity: 1,
      absoluteTransform: [
        [1, 0, x],
        [0, 1, y],
      ],
    }) as unknown as SceneNode
  const mask = rectangle('12:3', 'Rectangle 29', true, 137, 220)
  const target = rectangle('12:4', '#solid Rectangle 30', false, 205, 100)
  const group = {
    id: '15:25',
    name: 'Group 1',
    type: 'GROUP',
    visible: true,
    animations: {},
    effects: [],
    blendMode: 'PASS_THROUGH',
    absoluteTransform: [
      [1, 0, 0],
      [0, 1, 0],
    ],
    children: [mask, target],
  } as unknown as SceneNode
  root.children.push(group)

  const result = await exportSelection(
    [root as unknown as FrameNode],
    { frameRate: 30, webpEnabled: false, webpQuality: 80 },
    async (bytes) => bytes,
  )
  const content = new TextDecoder().decode(result.bytes)
  const matteIndex = content.indexOf('Rectangle 29 Matte')
  const targetIndex = content.indexOf('Rectangle 30')
  assert.ok(matteIndex >= 0 && matteIndex < targetIndex)
  assert.equal(content.includes('Figma Mask'), false)
})

test('任意单选叶子节点可作为导出根节点', async () => {
  const parent = {
    type: 'GROUP',
    absoluteTransform: [
      [1, 0, 40],
      [0, 1, 50],
    ],
  }
  const node = {
    id: '20:1',
    name: '#solid Selected Rectangle',
    type: 'RECTANGLE',
    parent,
    visible: true,
    animations: {},
    timelines: [{ duration: 1 }],
    effects: [],
    blendMode: 'NORMAL',
    isMask: false,
    topLeftRadius: 0,
    topRightRadius: 0,
    bottomLeftRadius: 0,
    bottomRightRadius: 0,
    fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, visible: true }],
    strokes: [],
    strokeWeight: 0,
    width: 20,
    height: 30,
    opacity: 1,
    relativeTransform: [
      [1, 0, 10],
      [0, 1, 10],
    ],
    absoluteTransform: [
      [1, 0, 50],
      [0, 1, 60],
    ],
    absoluteBoundingBox: { x: 50, y: 60, width: 20, height: 30 },
  } as unknown as SceneNode

  const result = await exportSelection(
    [node],
    { frameRate: 30, webpEnabled: false, webpQuality: 80 },
    async (bytes) => bytes,
  )
  assert.equal(result.fileName, '#solid Selected Rectangle.pag')
  assert.ok(new TextDecoder().decode(result.bytes).includes('Selected Rectangle'))
})

test('普通 TEXT 子图层会导出为 PAG 文本图层', async () => {
  const root = {
    id: '72:163',
    name: 'Frame10',
    type: 'FRAME',
    parent: { type: 'PAGE' },
    animations: {},
    timelines: [{ duration: 2 }],
    absoluteTransform: [
      [1, 0, 0],
      [0, 1, 0],
    ],
    absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 600 },
    opacity: 1,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, visible: true }],
    effects: [],
    blendMode: 'PASS_THROUGH',
    children: [] as SceneNode[],
  }
  const text = {
    id: '72:165',
    name: 'Figma Motion to PAG',
    type: 'TEXT',
    visible: true,
    parent: root,
    animations: {},
    effects: [],
    blendMode: 'NORMAL',
    opacity: 1,
    width: 220,
    height: 32,
    characters: 'Figma Motion to PAG',
    fontName: { family: 'Inter', style: 'Regular' },
    fontSize: 24,
    textAutoResize: 'WIDTH_AND_HEIGHT',
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    lineHeight: { unit: 'AUTO' },
    letterSpacing: { unit: 'PIXELS', value: 0 },
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, visible: true }],
    absoluteTransform: [
      [1, 0, 40],
      [0, 1, 80],
    ],
  } as unknown as SceneNode
  const imageLikeSolid = {
    id: '72:164',
    name: '#solid Background',
    type: 'RECTANGLE',
    parent: root,
    visible: true,
    animations: {},
    effects: [],
    blendMode: 'NORMAL',
    isMask: false,
    topLeftRadius: 0,
    topRightRadius: 0,
    bottomLeftRadius: 0,
    bottomRightRadius: 0,
    fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, visible: true }],
    strokes: [],
    strokeWeight: 0,
    width: 400,
    height: 600,
    opacity: 1,
    absoluteTransform: [
      [1, 0, 0],
      [0, 1, 0],
    ],
  } as unknown as SceneNode
  root.children.push(imageLikeSolid, text)

  const result = await exportSelection(
    [root as unknown as FrameNode],
    { frameRate: 30, webpEnabled: false, webpQuality: 80 },
    async (bytes) => bytes,
  )
  assert.equal(result.warnings.length, 0)
  assert.ok(new TextDecoder().decode(result.bytes).includes('Figma Motion to PAG'))
  assert.ok(new TextDecoder().decode(result.bytes).includes('Inter'))
  assert.ok(new TextDecoder().decode(result.bytes).includes('Background'))
})

test('图片与纯色多 Fill 会拆分到 PreCompose', async () => {
  Object.defineProperty(globalThis, 'figma', {
    value: {
      mixed,
      getImageByHash: () => ({
        getBytesAsync: async () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
        getSizeAsync: async () => ({ width: 100, height: 100 }),
      }),
    },
    configurable: true,
  })
  const root = {
    id: '54:5',
    name: 'Frame11',
    type: 'FRAME',
    parent: { type: 'PAGE' },
    animations: {},
    timelines: [{ duration: 1 }],
    absoluteTransform: [[1, 0, 0], [0, 1, 0]],
    absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 600 },
    opacity: 1,
    fills: [],
    effects: [],
    blendMode: 'PASS_THROUGH',
    children: [] as SceneNode[],
  }
  root.children.push({
    id: '54:6',
    name: 'IMG_18581',
    type: 'RECTANGLE',
    parent: root,
    visible: true,
    animations: {},
    effects: [],
    blendMode: 'NORMAL',
    opacity: 1,
    width: 400,
    height: 600,
    cornerSmoothing: 0,
    topLeftRadius: 0,
    topRightRadius: 0,
    bottomLeftRadius: 0,
    bottomRightRadius: 0,
    strokeWeight: 0,
    strokes: [],
    fills: [
      { type: 'IMAGE', imageHash: 'image', scaleMode: 'FILL', blendMode: 'NORMAL' },
      {
        type: 'SOLID',
        color: { r: 24 / 255, g: 41 / 255, b: 228 / 255 },
        opacity: 0.2,
        blendMode: 'LINEAR_DODGE',
      },
    ],
    absoluteTransform: [[1, 0, 0], [0, 1, 0]],
  } as unknown as SceneNode)

  const result = await exportSelection(
    [root as unknown as FrameNode],
    { frameRate: 30, webpEnabled: false, webpQuality: 80 },
    async (bytes) => bytes,
  )
  assert.equal(result.warnings.length, 0)
  assert.ok(new TextDecoder().decode(result.bytes).includes('IMG_18581'))
})
