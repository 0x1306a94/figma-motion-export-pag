import assert from 'node:assert/strict'
import test from 'node:test'
import { exportSelection, readRootBackgroundLayer } from '../src/export/export-selection'
import { readShapeNode } from '../src/export/shape'

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

test('Vector 优先使用 fillGeometry 保留最终圆角轮廓', () => {
  const node = {
    id: '1:116',
    name: '路径 44备份',
    type: 'VECTOR',
    opacity: 1,
    width: 592,
    height: 185,
    vectorPaths: [{
      data: 'M 0 0 L 592 0 L 592 185 L 0 185 Z',
      windingRule: 'NONZERO',
    }],
    fillGeometry: [{
      data: 'M 0 0 L 301.836 0 L 588.006 0 C 590.215 0 592.006 1.79086 592.006 4 L 592.006 152.933 C 592.006 170.607 577.679 184.933 560.006 184.933 L 32 184.933 C 14.3269 184.933 0 170.606 0 152.933 L 0 0 Z',
      windingRule: 'EVENODD',
    }],
    fills: [{ type: 'SOLID', color: { r: 24 / 255, g: 118 / 255, b: 239 / 255 } }],
    strokes: [],
    strokeWeight: 0,
  } as unknown as VectorNode
  const layer = readShapeNode(node, 2, 30, {})
  assert.equal(layer?.fillRule, 1)
  assert.equal(layer?.geometry.type, 'path')
  if (layer?.geometry.type !== 'path') return
  const curves = layer.geometry.commands.filter((command) => command.type === 'curve')
  assert.equal(curves.length, 3)
  assert.deepEqual(curves[2].values.slice(-2), [0, 152.933])
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

test('渐变 Fill 正常导出，Shader Fill 警告后忽略', async () => {
  Object.defineProperty(globalThis, 'figma', { value: { mixed }, configurable: true })
  const root = {
    id: '1:104',
    name: 'Frame38',
    type: 'FRAME',
    parent: { type: 'PAGE' },
    animations: {},
    timelines: [{ duration: 1 }],
    absoluteTransform: [[1, 0, 0], [0, 1, 0]],
    absoluteBoundingBox: { x: 0, y: 0, width: 592, height: 644 },
    opacity: 1,
    fills: [],
    effects: [],
    blendMode: 'PASS_THROUGH',
    children: [] as SceneNode[],
  }
  const rectangle = (id: string, name: string, fill: Paint) => ({
    id,
    name,
    type: 'RECTANGLE',
    parent: root,
    visible: true,
    animations: {},
    effects: [],
    blendMode: 'NORMAL',
    opacity: 1,
    width: 592,
    height: 630,
    cornerSmoothing: 0,
    topLeftRadius: 32,
    topRightRadius: 32,
    bottomLeftRadius: 32,
    bottomRightRadius: 32,
    strokeWeight: 0,
    strokes: [],
    fills: [fill],
    absoluteTransform: [[1, 0, 0], [0, 1, 0]],
  }) as unknown as SceneNode
  const skewedGroup = {
    id: '1:109',
    name: '回击',
    type: 'GROUP',
    parent: root,
    visible: true,
    animations: {},
    effects: [],
    blendMode: 'PASS_THROUGH',
    opacity: 1,
    absoluteTransform: [[1, -0.08, 100], [0, 1, 120]],
    children: [] as SceneNode[],
  }
  skewedGroup.children.push({
    id: '1:110',
    name: '回击 Vector',
    type: 'VECTOR',
    parent: skewedGroup,
    visible: true,
    animations: {},
    effects: [],
    blendMode: 'NORMAL',
    opacity: 1,
    width: 20,
    height: 20,
    vectorPaths: [{ data: 'M 0 0 L 20 0 L 20 20 L 0 20 Z', windingRule: 'NONZERO' }],
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
    strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
    strokeWeight: 2,
    strokeAlign: 'INSIDE',
    dashPattern: [],
    strokeCap: 'NONE',
    strokeJoin: 'MITER',
    strokeMiterLimit: 4,
    absoluteTransform: [[1, -0.08, 100], [0, 1, 120]],
  } as unknown as SceneNode)
  root.children.push(
    rectangle('1:105', 'Rectangle 673', {
      type: 'GRADIENT_LINEAR',
      gradientTransform: [[1, 0, 0], [0, 1, 0]],
      gradientStops: [
        { position: 0.31976, color: { r: 35 / 255, g: 164 / 255, b: 244 / 255, a: 1 } },
        { position: 0.9504, color: { r: 254 / 255, g: 245 / 255, b: 244 / 255, a: 1 } },
      ],
    }),
    rectangle('1:106', 'Shader Decoration', { type: 'SHADER', id: 'shader' }),
    {
      id: '1:107',
      name: 'Ellipse 1',
      type: 'ELLIPSE',
      parent: root,
      visible: true,
      animations: {},
      effects: [],
      blendMode: 'NORMAL',
      opacity: 1,
      width: 52,
      height: 52,
      arcData: { startingAngle: 0, endingAngle: Math.PI * 2, innerRadius: 0 },
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
      strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
      strokeWeight: 2,
      strokeAlign: 'INSIDE',
      dashPattern: [],
      strokeCap: 'NONE',
      strokeJoin: 'MITER',
      strokeMiterLimit: 4,
      absoluteTransform: [[1, 0, 0], [0, 1, 0]],
    } as unknown as SceneNode,
    {
      id: '1:108',
      name: 'Vector 15',
      type: 'VECTOR',
      parent: root,
      visible: true,
      animations: {},
      effects: [],
      blendMode: 'NORMAL',
      opacity: 1,
      width: 100,
      height: 60,
      vectorPaths: [{ data: 'M 0 0 L 100 0 L 100 60 L 0 60 Z', windingRule: 'NONZERO' }],
      fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
      strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
      strokeWeight: 2,
      strokeAlign: 'OUTSIDE',
      dashPattern: [],
      strokeCap: 'NONE',
      strokeJoin: 'MITER',
      strokeMiterLimit: 4,
      absoluteTransform: [[1, -0.08, 100], [0, 1, 120]],
    } as unknown as SceneNode,
    skewedGroup as unknown as SceneNode,
  )

  const result = await exportSelection(
    [root as unknown as FrameNode],
    { frameRate: 30, webpEnabled: false, webpQuality: 80 },
    async (bytes) => bytes,
  )
  assert.equal(result.warnings.length, 1)
  assert.ok(result.warnings.some((warning) => /Shader Fill.*已忽略/.test(warning.message)))
  const content = new TextDecoder().decode(result.bytes)
  assert.ok(content.includes('Rectangle 673'))
  assert.ok(content.includes('Vector 15'))
  assert.ok(content.includes('Vector 15 Stroke'))
  assert.ok(content.indexOf('Vector 15\0') < content.indexOf('Vector 15 Stroke'))
  assert.ok(content.indexOf('Ellipse 1 Stroke') < content.indexOf('Ellipse 1\0'))
  assert.ok(content.includes('回击 Vector'))
  assert.ok(content.indexOf('回击 Vector Stroke') < content.indexOf('回击 Vector\0'))
})
