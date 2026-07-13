import assert from 'node:assert/strict'
import test from 'node:test'
import { readMotionTransform } from '../src/export/motion'
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

test('非 SET track 会中断', () => {
  const root = {}
  const node = {
    id: '1:3',
    name: 'Invalid Motion',
    parent: root,
    animations: {
      OPACITY: {
        baseValue: { type: 'FLOAT', value: 1 },
        timelineDuration: 1,
        tracks: [{ id: 'track', keyframeOperation: 'OFFSET', keyframes: [] }],
      },
    },
  }
  assert.throws(() =>
    readMotionTransform(node as unknown as SceneNode, root as FrameNode, 30, {}, [], identityContext),
  )
})

test('根 Frame 水平翻转会映射 Motion 位移、旋转和缩放', () => {
  const root = {}
  const node = {
    id: '1:4',
    name: 'Flipped Motion',
    parent: root,
    relativeTransform: [
      [1, 0, 30],
      [0, 1, 20],
    ],
    animations: {
      TRANSLATION_XY: {
        baseValue: { type: 'VECTOR', value: { x: 30, y: 20 } },
        timelineDuration: 1,
        tracks: [
          {
            id: 'position',
            keyframeOperation: 'SET',
            keyframes: [
              {
                id: 'position-end',
                timelinePosition: 1,
                easing: { type: 'LINEAR' },
                value: { type: 'VECTOR', value: { x: 50, y: 40 } },
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
  assert.deepEqual(position.keyframes[0].startValue, { x: 70, y: 20 })
  assert.deepEqual(position.keyframes[0].endValue, { x: 50, y: 40 })
  assert.deepEqual([rotation.keyframes[0].startValue, rotation.keyframes[0].endValue], [180, 150])
  assert.deepEqual(scale.keyframes[0].startValue, { x: 1, y: -1 })
  assert.deepEqual(scale.keyframes[0].endValue, { x: 2, y: -3 })
})
