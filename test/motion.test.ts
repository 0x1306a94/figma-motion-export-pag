import assert from 'node:assert/strict'
import test from 'node:test'
import {
  composeAncestorMotionTransform,
  readMotionAnchor,
  readMotionTransform,
  refreshMotionAnchorCache,
} from '../src/export/motion'
import type { PagPoint } from '../src/export/pag/types'
import type { ExportTransformContext } from '../src/export/solid'

const identityContext: ExportTransformContext = {
  width: 100,
  height: 100,
  absoluteToExportTransform: [
    [1, 0, 0],
    [0, 1, 0],
  ],
  rootToExportTransform: [
    [1, 0, 0],
    [0, 1, 0],
  ],
  scale: 1,
  orientation: 1,
  rotation: 0,
}

test('Motion 秒数转帧、碰撞保留后值并生成 N-1 段', () => {
  const root = {}
  const node = {
    id: '1:2',
    name: 'Motion Layer',
    parent: root,
    animations: {
      TRANSLATION_X: {
        baseValue: { type: 'FLOAT', value: 0 },
        timelineDuration: 1,
        tracks: [
          {
            id: 'track',
            keyframeOperation: 'SET',
            keyframes: [
              { id: 'a', timelinePosition: 0.5, easing: { type: 'LINEAR' }, value: { type: 'FLOAT', value: 10 } },
              { id: 'b', timelinePosition: 0.51, easing: { type: 'HOLD' }, value: { type: 'FLOAT', value: 20 } },
              {
                id: 'c',
                timelinePosition: 1,
                easing: {
                  type: 'CUSTOM_CUBIC_BEZIER',
                  easingFunctionCubicBezier: { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
                },
                value: { type: 'FLOAT', value: 30 },
              },
            ],
          },
        ],
      },
    },
    relativeTransform: [
      [1, 0, 0],
      [0, 1, 5],
    ],
  }
  const warnings: Array<{ message: string }> = []
  const transform = readMotionTransform(
    node as unknown as SceneNode,
    root as FrameNode,
    24,
    { position: { x: 0, y: 5 } },
    warnings,
    identityContext,
  )
  const xPosition = transform.xPosition as { keyframes: Array<{ endTime: number; endValue: number }> }
  assert.equal(warnings.length, 1)
  assert.equal(xPosition.keyframes.length, 2)
  assert.deepEqual(
    xPosition.keyframes.map((keyframe) => [keyframe.endTime, keyframe.endValue]),
    [
      [12, 20],
      [24, 30],
    ],
  )
  assert.equal(transform.yPosition, 5)
})

test('首个 Motion 关键帧延迟时向前保持首值', () => {
  const root = {}
  const node = {
    id: '38:156',
    name: '触桌',
    parent: root,
    width: 155,
    height: 116,
    animations: {
      SCALE_XY: {
        baseValue: { type: 'VECTOR', value: { x: 1, y: 1 } },
        timelineDuration: 3.3,
        tracks: [{
          id: 'scale',
          keyframeOperation: 'SET',
          keyframes: [
            {
              id: 'hidden',
              timelinePosition: 0.94,
              easing: { type: 'LINEAR' },
              value: { type: 'VECTOR', value: { x: 0, y: 0 } },
            },
            {
              id: 'visible',
              timelinePosition: 1.51,
              easing: { type: 'LINEAR' },
              value: { type: 'VECTOR', value: { x: 1, y: 1 } },
            },
          ],
        }],
      },
    },
    relativeTransform: [[1, 0, 10], [0, 1, 20]],
  }
  const transform = readMotionTransform(
    node as unknown as SceneNode,
    root as FrameNode,
    10,
    { position: { x: 10, y: 20 }, scale: { x: 1, y: 1 } },
    [],
    identityContext,
  )
  const scale = transform.scale as {
    keyframes: Array<{ startTime: number; endTime: number; startValue: PagPoint; endValue: PagPoint }>
  }
  assert.deepEqual(scale.keyframes[0], {
    startTime: 0,
    endTime: 9,
    startValue: { x: 0, y: 0 },
    endValue: { x: 0, y: 0 },
    interpolation: 1,
    bezier: undefined,
  })
})

test('OFFSET track 会叠加 baseValue 并应用 timelineOffset', () => {
  const root = {}
  const node = {
    id: '1:3',
    name: 'Offset Motion',
    parent: root,
    animations: {
      TRANSLATION_X: {
        baseValue: { type: 'FLOAT', value: 100 },
        timelineDuration: 1,
        tracks: [{
          id: 'track',
          keyframeOperation: 'OFFSET',
          animationPreset: { timelineOffset: 0.5 },
          keyframes: [
            { id: 'start', timelinePosition: 0, easing: { type: 'LINEAR' }, value: { type: 'FLOAT', value: -20 } },
            { id: 'end', timelinePosition: 0.5, easing: { type: 'LINEAR' }, value: { type: 'FLOAT', value: 0 } },
          ],
        }],
      },
    },
    relativeTransform: [
      [1, 0, 100],
      [0, 1, 20],
    ],
  }
  const transform = readMotionTransform(
    node as unknown as SceneNode,
    root as FrameNode,
    10,
    { position: { x: 100, y: 20 } },
    [],
    identityContext,
  )
  const xPosition = transform.xPosition as {
    keyframes: Array<{ startTime: number; endTime: number; startValue: number; endValue: number; interpolation: number }>
  }
  assert.deepEqual(
    xPosition.keyframes.map((keyframe) => [
      keyframe.startTime,
      keyframe.endTime,
      keyframe.startValue,
      keyframe.endValue,
      keyframe.interpolation,
    ]),
    [
      [0, 5, 100, 80, 3],
      [5, 10, 80, 100, 1],
    ],
  )
})

test('多 track 按顺序逐帧合成 OFFSET 与 SCALE', () => {
  const root = {}
  const node = {
    id: '1:5',
    name: 'Multi Track Motion',
    parent: root,
    animations: {
      TRANSLATION_X: {
        baseValue: { type: 'FLOAT', value: 10 },
        timelineDuration: 1,
        tracks: [
          {
            id: 'offset',
            keyframeOperation: 'OFFSET',
            keyframes: [
              { id: 'offset-start', timelinePosition: 0, easing: { type: 'LINEAR' }, value: { type: 'FLOAT', value: 0 } },
              { id: 'offset-end', timelinePosition: 1, easing: { type: 'LINEAR' }, value: { type: 'FLOAT', value: 10 } },
            ],
          },
          {
            id: 'scale',
            keyframeOperation: 'SCALE',
            keyframes: [
              { id: 'scale-start', timelinePosition: 0, easing: { type: 'LINEAR' }, value: { type: 'FLOAT', value: 1 } },
              { id: 'scale-end', timelinePosition: 1, easing: { type: 'LINEAR' }, value: { type: 'FLOAT', value: 2 } },
            ],
          },
        ],
      },
    },
    relativeTransform: [
      [1, 0, 10],
      [0, 1, 20],
    ],
  }
  const transform = readMotionTransform(
    node as unknown as SceneNode,
    root as FrameNode,
    2,
    { position: { x: 10, y: 20 } },
    [],
    identityContext,
  )
  const xPosition = transform.xPosition as { keyframes: Array<{ startValue: number; endValue: number }> }
  assert.deepEqual(
    xPosition.keyframes.map((keyframe) => [keyframe.startValue, keyframe.endValue]),
    [
      [10, 22.5],
      [22.5, 40],
    ],
  )
})

test('SCALE track 在 PAG 透明度映射前计算', () => {
  const root = {}
  const node = {
    id: '1:6',
    name: 'Opacity Scale Motion',
    parent: root,
    animations: {
      OPACITY: {
        baseValue: { type: 'FLOAT', value: 0.5 },
        timelineDuration: 1,
        tracks: [{
          id: 'opacity',
          keyframeOperation: 'SCALE',
          animationPreset: { timelineOffset: 0.5 },
          keyframes: [
            { id: 'opacity-start', timelinePosition: 0, easing: { type: 'LINEAR' }, value: { type: 'FLOAT', value: 1 } },
            { id: 'opacity-end', timelinePosition: 0.5, easing: { type: 'LINEAR' }, value: { type: 'FLOAT', value: 0 } },
          ],
        }],
      },
    },
  }
  const transform = readMotionTransform(
    node as unknown as SceneNode,
    root as FrameNode,
    10,
    { opacity: 127.5 },
    [],
    identityContext,
  )
  const opacity = transform.opacity as {
    keyframes: Array<{ startValue: number; endValue: number; interpolation: number }>
  }
  assert.deepEqual(
    opacity.keyframes.map((keyframe) => [
      keyframe.startValue,
      keyframe.endValue,
      keyframe.interpolation,
    ]),
    [
      [127.5, 127.5, 3],
      [127.5, 0, 1],
    ],
  )
})

test('Motion Rotation 转换旋转方向并保持节点中心不动', () => {
  const root = {}
  const node = {
    id: '1:7',
    name: 'Centered Rotation',
    parent: root,
    width: 442,
    height: 235,
    animations: {
      ROTATION: {
        baseValue: { type: 'FLOAT', value: 0 },
        timelineDuration: 0.5,
        tracks: [{
          id: 'rotation',
          keyframeOperation: 'OFFSET',
          keyframes: [
            { id: 'start', timelinePosition: 0, easing: { type: 'LINEAR' }, value: { type: 'FLOAT', value: 180 } },
            { id: 'end', timelinePosition: 0.5, easing: { type: 'LINEAR' }, value: { type: 'FLOAT', value: 0 } },
          ],
        }],
      },
    },
    relativeTransform: [
      [1, 0, 557],
      [0, 1, 501],
    ],
  }
  const transform = readMotionTransform(
    node as unknown as SceneNode,
    root as FrameNode,
    30,
    { position: { x: 557, y: 501 }, rotation: 0 },
    [],
    identityContext,
  )
  const rotation = transform.rotation as { keyframes: Array<{ startValue: number; endValue: number }> }
  assert.deepEqual(transform.anchorPoint, { x: 221, y: 117.5 })
  assert.deepEqual(transform.position, { x: 778, y: 618.5 })
  assert.deepEqual([rotation.keyframes[0].startValue, rotation.keyframes[0].endValue], [-180, 0])
})

test('纯 SET SCALE_XY 从当前渲染边界推导并缓存 Motion 锚点', () => {
  const store = { value: '' }
  const node = {
    id: '17:91',
    name: 'Rectangle 32',
    width: 177,
    height: 155,
    animations: {
      SCALE_XY: {
        baseValue: { type: 'VECTOR', value: { x: 1, y: 1 } },
        timelineDuration: 0.5,
        tracks: [{
          id: 'scale',
          keyframeOperation: 'SET',
          keyframes: [],
        }],
      },
    },
    absoluteBoundingBox: { x: 1280.992431640625, y: 3303.99658203125, width: 177.007568359375, height: 155.006591796875 },
    absoluteRenderBounds: { x: 1220.043701171875, y: 3277.31005859375, width: 237.956298828125, height: 205.68994140625 },
    getSharedPluginData: () => store.value,
    setSharedPluginData: (_namespace: string, _key: string, value: string) => { store.value = value },
  }

  assert.deepEqual(refreshMotionAnchorCache(node as unknown as SceneNode), { x: 177, y: 77.5 })
  assert.equal(store.value, '177,77.5')

  node.absoluteRenderBounds = { ...node.absoluteBoundingBox }
  assert.deepEqual(readMotionAnchor(node as unknown as SceneNode), { x: 177, y: 77.5 })
})

test('独立 SCALE_X 与 SCALE_Y 按各自时间线合成为二维 Scale', () => {
  const root = {}
  const scaleTrack = (id: string, endTime: number) => ({
    id,
    keyframeOperation: 'SCALE',
    keyframes: [
      { id: `${id}-start`, timelinePosition: 0, easing: { type: 'LINEAR' }, value: { type: 'FLOAT', value: 0 } },
      { id: `${id}-end`, timelinePosition: endTime, easing: { type: 'LINEAR' }, value: { type: 'FLOAT', value: 1 } },
    ],
  })
  const node = {
    id: '1:8',
    name: 'Separated Scale',
    parent: root,
    width: 100,
    height: 50,
    animations: {
      SCALE_X: {
        baseValue: { type: 'FLOAT', value: 1 },
        timelineDuration: 2,
        tracks: [scaleTrack('scale-x', 1)],
      },
      SCALE_Y: {
        baseValue: { type: 'FLOAT', value: 1 },
        timelineDuration: 2,
        tracks: [scaleTrack('scale-y', 2)],
      },
    },
    relativeTransform: [
      [1, 0, 10],
      [0, 1, 20],
    ],
  }
  const transform = readMotionTransform(
    node as unknown as SceneNode,
    root as FrameNode,
    2,
    { position: { x: 10, y: 20 }, scale: { x: 1, y: 1 } },
    [],
    identityContext,
  )
  const scale = transform.scale as {
    keyframes: Array<{ startValue: { x: number; y: number }; endValue: { x: number; y: number } }>
  }
  assert.deepEqual(transform.anchorPoint, { x: 50, y: 25 })
  assert.deepEqual(transform.position, { x: 60, y: 45 })
  assert.deepEqual(
    scale.keyframes.map((keyframe) => [keyframe.startValue, keyframe.endValue]),
    [
      [{ x: 0, y: 0 }, { x: 0.5, y: 0.25 }],
      [{ x: 0.5, y: 0.25 }, { x: 1, y: 0.5 }],
      [{ x: 1, y: 0.5 }, { x: 1, y: 0.75 }],
      [{ x: 1, y: 0.75 }, { x: 1, y: 1 }],
    ],
  )
})

test('WIDTH 与 HEIGHT 以左上角为锚点映射为二维 Scale', () => {
  const root = {}
  const sizeTrack = (id: string) => ({
    id,
    keyframeOperation: 'OFFSET',
    keyframes: [
      { id: `${id}-start`, timelinePosition: 0, easing: { type: 'LINEAR' }, value: { type: 'FLOAT', value: 0 } },
      { id: `${id}-end`, timelinePosition: 1, easing: { type: 'LINEAR' }, value: { type: 'FLOAT', value: 150 } },
    ],
  })
  const node = {
    id: '1:9',
    name: 'Size Motion',
    parent: root,
    width: 390,
    height: 355,
    animations: {
      WIDTH: {
        baseValue: { type: 'FLOAT', value: 240 },
        timelineDuration: 2,
        tracks: [sizeTrack('width')],
      },
      HEIGHT: {
        baseValue: { type: 'FLOAT', value: 205 },
        timelineDuration: 2,
        tracks: [sizeTrack('height')],
      },
    },
    relativeTransform: [
      [1, 0, 1130],
      [0, 1, 192],
    ],
  }
  const transform = readMotionTransform(
    node as unknown as SceneNode,
    root as FrameNode,
    2,
    { position: { x: 1130, y: 192 }, scale: { x: 1, y: 1 } },
    [],
    identityContext,
  )
  const scale = transform.scale as {
    keyframes: Array<{ startValue: { x: number; y: number }; endValue: { x: number; y: number } }>
  }
  assert.equal(transform.anchorPoint, undefined)
  assert.deepEqual(transform.position, { x: 1130, y: 192 })
  assert.deepEqual(scale.keyframes[0].startValue, { x: 240 / 390, y: 205 / 355 })
  assert.deepEqual(scale.keyframes[scale.keyframes.length - 1].endValue, { x: 1, y: 1 })
})

test('WIDTH/HEIGHT 尺寸比例与 SCALE 动画逐帧相乘', () => {
  const root = {}
  const node = {
    id: '1:10',
    name: 'Size And Scale Motion',
    parent: root,
    width: 200,
    height: 100,
    animations: {
      WIDTH: {
        baseValue: { type: 'FLOAT', value: 100 },
        timelineDuration: 1,
        tracks: [{
          id: 'width',
          keyframeOperation: 'OFFSET',
          keyframes: [
            { id: 'width-start', timelinePosition: 0, easing: { type: 'LINEAR' }, value: { type: 'FLOAT', value: 0 } },
            { id: 'width-end', timelinePosition: 1, easing: { type: 'LINEAR' }, value: { type: 'FLOAT', value: 100 } },
          ],
        }],
      },
      SCALE_XY: {
        baseValue: { type: 'VECTOR', value: { x: 1, y: 1 } },
        timelineDuration: 1,
        tracks: [{
          id: 'scale',
          keyframeOperation: 'SET',
          keyframes: [
            { id: 'scale-start', timelinePosition: 0, easing: { type: 'LINEAR' }, value: { type: 'VECTOR', value: { x: 1, y: 1 } } },
            { id: 'scale-end', timelinePosition: 1, easing: { type: 'LINEAR' }, value: { type: 'VECTOR', value: { x: 2, y: 3 } } },
          ],
        }],
      },
    },
    relativeTransform: [
      [1, 0, 10],
      [0, 1, 20],
    ],
  }
  const transform = readMotionTransform(
    node as unknown as SceneNode,
    root as FrameNode,
    2,
    { position: { x: 10, y: 20 }, scale: { x: 1, y: 1 } },
    [],
    identityContext,
  )
  const scale = transform.scale as {
    keyframes: Array<{ startValue: PagPoint; endValue: PagPoint }>
  }
  assert.equal(transform.anchorPoint, undefined)
  assert.deepEqual(transform.position, { x: 10, y: 20 })
  assert.deepEqual(scale.keyframes[0].startValue, { x: 0.5, y: 1 })
  assert.deepEqual(scale.keyframes[scale.keyframes.length - 1].endValue, { x: 2, y: 3 })
})

test('根 Frame 水平翻转会映射 Motion 位移、旋转和缩放', () => {
  const root = {}
  const node = {
    id: '1:4',
    name: 'Flipped Motion',
    parent: root,
    width: 20,
    height: 10,
    relativeTransform: [
      [1, 0, 30],
      [0, 1, 20],
    ],
    animations: {
      TRANSLATION_XY: {
        baseValue: { type: 'VECTOR', value: { x: 0, y: 0 } },
        timelineDuration: 1,
        tracks: [
          {
            id: 'position',
            keyframeOperation: 'SET',
            keyframes: [
              {
                id: 'position-start',
                timelinePosition: 0,
                easing: { type: 'LINEAR' },
                value: { type: 'VECTOR', value: { x: 0, y: 0 } },
              },
              {
                id: 'position-end',
                timelinePosition: 1,
                easing: { type: 'LINEAR' },
                value: { type: 'VECTOR', value: { x: 20, y: 20 } },
              },
            ],
          },
        ],
      },
      ROTATION: {
        baseValue: { type: 'FLOAT', value: 0 },
        timelineDuration: 1,
        tracks: [
          {
            id: 'rotation',
            keyframeOperation: 'SET',
            keyframes: [
              {
                id: 'rotation-start',
                timelinePosition: 0,
                easing: { type: 'LINEAR' },
                value: { type: 'FLOAT', value: 0 },
              },
              {
                id: 'rotation-end',
                timelinePosition: 1,
                easing: { type: 'LINEAR' },
                value: { type: 'FLOAT', value: 30 },
              },
            ],
          },
        ],
      },
      SCALE_XY: {
        baseValue: { type: 'VECTOR', value: { x: 1, y: 1 } },
        timelineDuration: 1,
        tracks: [
          {
            id: 'scale',
            keyframeOperation: 'SET',
            keyframes: [
              {
                id: 'scale-start',
                timelinePosition: 0,
                easing: { type: 'LINEAR' },
                value: { type: 'VECTOR', value: { x: 1, y: 1 } },
              },
              {
                id: 'scale-end',
                timelinePosition: 1,
                easing: { type: 'LINEAR' },
                value: { type: 'VECTOR', value: { x: 2, y: 3 } },
              },
            ],
          },
        ],
      },
    },
  }
  const context: ExportTransformContext = {
    ...identityContext,
    rootToExportTransform: [
      [-1, 0, 100],
      [0, 1, 0],
    ],
    orientation: -1,
    rotation: 180,
  }
  const transform = readMotionTransform(
    node as unknown as SceneNode,
    root as FrameNode,
    30,
    { position: { x: 70, y: 20 }, scale: { x: 1, y: -1 }, rotation: 180 },
    [],
    context,
  )
  const position = transform.position as { keyframes: Array<{ startValue: { x: number; y: number }; endValue: { x: number; y: number } }> }
  const rotation = transform.rotation as { keyframes: Array<{ startValue: number; endValue: number }> }
  const scale = transform.scale as { keyframes: Array<{ startValue: { x: number; y: number }; endValue: { x: number; y: number } }> }
  assert.deepEqual(transform.anchorPoint, { x: 10, y: 5 })
  assert.deepEqual(position.keyframes[0].startValue, { x: 60, y: 25 })
  assert.deepEqual(position.keyframes[0].endValue, { x: 40, y: 45 })
  assert.deepEqual([rotation.keyframes[0].startValue, rotation.keyframes[0].endValue], [180, 210])
  assert.deepEqual(scale.keyframes[0].startValue, { x: 1, y: -1 })
  assert.deepEqual(scale.keyframes[0].endValue, { x: 2, y: -3 })
})

test('嵌套节点 Motion 使用直接父节点坐标映射到导出画布', () => {
  const root = {}
  const parent = {
    absoluteTransform: [
      [1, 0, 100],
      [0, 1, 50],
    ],
  }
  const node = {
    id: '1:10',
    name: 'Nested Motion',
    parent,
    width: 20,
    height: 20,
    animations: {
      TRANSLATION_X: {
        baseValue: { type: 'FLOAT', value: 10 },
        timelineDuration: 1,
        tracks: [{
          id: 'position',
          keyframeOperation: 'SET',
          keyframes: [
            { id: 'start', timelinePosition: 0, easing: { type: 'LINEAR' }, value: { type: 'FLOAT', value: 10 } },
            { id: 'end', timelinePosition: 1, easing: { type: 'LINEAR' }, value: { type: 'FLOAT', value: 30 } },
          ],
        }],
      },
    },
    relativeTransform: [
      [1, 0, 10],
      [0, 1, 20],
    ],
  }
  const transform = readMotionTransform(
    node as unknown as SceneNode,
    root as unknown as SceneNode,
    10,
    { position: { x: 110, y: 70 } },
    [],
    identityContext,
  )
  const x = transform.xPosition as { keyframes: Array<{ startValue: number; endValue: number }> }
  assert.equal(x.keyframes[0].startValue, 110)
  assert.equal(x.keyframes[0].endValue, 130)
  assert.equal(transform.yPosition, 70)
})

test('Group 子节点的 TRANSLATION_XY 不重复叠加父级平移', () => {
  const root = {}
  const parent = {
    absoluteTransform: [
      [1, 0, 100],
      [0, 1, 50],
    ],
  }
  const node = {
    id: '1:13',
    name: '下球线蒙版',
    parent,
    width: 100,
    height: 50,
    animations: {
      TRANSLATION_XY: {
        baseValue: { type: 'VECTOR', value: { x: 0, y: 0 } },
        timelineDuration: 1,
        tracks: [{
          id: 'position',
          keyframeOperation: 'SET',
          keyframes: [
            { id: 'start', timelinePosition: 0, easing: { type: 'LINEAR' }, value: { type: 'VECTOR', value: { x: 0, y: 0 } } },
            { id: 'end', timelinePosition: 1, easing: { type: 'LINEAR' }, value: { type: 'VECTOR', value: { x: 20, y: 10 } } },
          ],
        }],
      },
    },
    relativeTransform: [
      [1, 0, 110],
      [0, 1, 70],
    ],
  }
  const transform = readMotionTransform(
    node as unknown as SceneNode,
    root as unknown as SceneNode,
    10,
    { position: { x: 110, y: 70 } },
    [],
    identityContext,
  )
  const position = transform.position as {
    keyframes: Array<{ startValue: PagPoint; endValue: PagPoint }>
  }
  assert.deepEqual(position.keyframes[0].startValue, { x: 110, y: 70 })
  assert.deepEqual(position.keyframes[0].endValue, { x: 130, y: 80 })
})

test('容器 Motion 会逐帧合成到后代图层', () => {
  const root = { absoluteTransform: identityContext.rootToExportTransform }
  const parent = {
    id: '1:11',
    name: 'Animated Group',
    parent: root,
    width: 100,
    height: 100,
    opacity: 1,
    animations: {
      TRANSLATION_X: {
        baseValue: { type: 'FLOAT', value: 100 },
        timelineDuration: 1,
        tracks: [{
          id: 'position',
          keyframeOperation: 'SET',
          keyframes: [
            { id: 'start', timelinePosition: 0, easing: { type: 'LINEAR' }, value: { type: 'FLOAT', value: 100 } },
            { id: 'end', timelinePosition: 1, easing: { type: 'LINEAR' }, value: { type: 'FLOAT', value: 200 } },
          ],
        }],
      },
    },
    relativeTransform: [
      [1, 0, 100],
      [0, 1, 0],
    ],
    absoluteTransform: [
      [1, 0, 100],
      [0, 1, 0],
    ],
  }
  const node = {
    id: '1:12',
    name: 'Child',
    parent,
    animations: {},
    relativeTransform: [
      [1, 0, 10],
      [0, 1, 0],
    ],
  }
  const transform = composeAncestorMotionTransform(
    node as unknown as SceneNode,
    root as unknown as SceneNode,
    [parent as unknown as SceneNode],
    10,
    10,
    { position: { x: 110, y: 0 } },
    [],
    identityContext,
  )
  const position = transform.position as { keyframes: Array<{ startValue: PagPoint; endValue: PagPoint }> }
  assert.deepEqual(position.keyframes[0].startValue, { x: 110, y: 0 })
  assert.deepEqual(position.keyframes[position.keyframes.length - 1].endValue, { x: 210, y: 0 })
})
