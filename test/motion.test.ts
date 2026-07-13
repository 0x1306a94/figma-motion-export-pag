import assert from 'node:assert/strict'
import test from 'node:test'
import { readMotionTransform } from '../src/export/motion'

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
    x: 0,
    y: 5,
  }
  const warnings: Array<{ message: string }> = []
  const transform = readMotionTransform(
    node as unknown as SceneNode,
    root as FrameNode,
    24,
    { position: { x: 0, y: 5 } },
    warnings,
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
    readMotionTransform(node as unknown as SceneNode, root as FrameNode, 30, {}, []),
  )
})
