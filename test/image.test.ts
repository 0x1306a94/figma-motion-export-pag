import assert from 'node:assert/strict'
import test from 'node:test'
import { applyImageFit } from '../src/export/image'
import type { PagTransform } from '../src/export/pag/types'

test('图片 Scale Motion 与 FIT 偏移组合后保持图片适配比例和 Motion Anchor', () => {
  const transform: PagTransform = {
    anchorPoint: { x: 260, y: 578 },
    position: { x: 199, y: 437 },
    rotation: 15,
    scale: {
      keyframes: [
        {
          startTime: 0,
          endTime: 48,
          startValue: { x: 1.2, y: 1.2 },
          endValue: { x: 1, y: 1 },
          interpolation: 2,
          bezier: [
            { out: { x: 0, y: 0 }, in: { x: 0.58, y: 1 } },
            { out: { x: 0, y: 0 }, in: { x: 0.58, y: 1 } },
          ],
        },
      ],
    },
  }

  const result = applyImageFit(transform, { scale: 0.5, offset: { x: 0, y: 25 } })
  assert.deepEqual(result.anchorPoint, { x: 520, y: 1106 })
  assert.deepEqual(result.position, transform.position)
  assert.equal(result.rotation, 15)
  assert.deepEqual(result.scale, {
    keyframes: [
      {
        startTime: 0,
        endTime: 48,
        startValue: { x: 0.6, y: 0.6 },
        endValue: { x: 0.5, y: 0.5 },
        interpolation: 2,
        bezier: transform.scale && 'keyframes' in transform.scale
          ? transform.scale.keyframes[0].bezier
          : undefined,
      },
    ],
  })
})

test('FILL 裁剪图片通过负 Anchor 表达局部偏移，不改变节点位置', () => {
  const result = applyImageFit(
    { position: { x: 10, y: 20 }, scale: { x: 2, y: 2 }, rotation: 90 },
    { scale: 0.25, offset: { x: -50, y: 0 } },
  )
  assert.deepEqual(result.position, { x: 10, y: 20 })
  assert.deepEqual(result.anchorPoint, { x: 200, y: 0 })
  assert.deepEqual(result.scale, { x: 0.5, y: 0.5 })
  assert.equal(result.rotation, 90)
})
