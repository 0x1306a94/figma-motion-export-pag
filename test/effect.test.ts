import assert from 'node:assert/strict'
import test from 'node:test'
import { readLayerEffects } from '../src/export/effect'

test('Layer Blur Radius Motion 直接映射为 PAG FastBlur', () => {
  const node = {
    id: '72:164',
    name: 'IMG_18581',
    effects: [{ type: 'LAYER_BLUR', blurType: 'NORMAL', radius: 21.2, visible: true }],
    animations: {
      effects: {
        0: {
          RADIUS: {
            baseValue: { type: 'FLOAT', value: 21.2 },
            timelineDuration: 2,
            tracks: [
              {
                id: 'blur',
                keyframeOperation: 'SET',
                keyframes: [
                  {
                    id: 'start',
                    timelinePosition: 0.007398,
                    easing: {
                      type: 'CUSTOM_CUBIC_BEZIER',
                      easingFunctionCubicBezier: { x1: 0.5, y1: 0, x2: 0.5, y2: 1 },
                    },
                    value: { type: 'FLOAT', value: 21.2 },
                  },
                  {
                    id: 'end',
                    timelinePosition: 0.612,
                    easing: { type: 'LINEAR' },
                    value: { type: 'FLOAT', value: 60 },
                  },
                ],
              },
            ],
          },
        },
      },
    },
  } as unknown as SceneNode

  const effects = readLayerEffects(node, 30, [])
  assert.equal(effects.length, 1)
  assert.deepEqual(effects[0], {
    type: 'fast-blur',
    blurriness: {
      keyframes: [
        {
          startTime: 0,
          endTime: 18,
          startValue: 21.2,
          endValue: 60,
          interpolation: 2,
          bezier: [{ out: { x: 0.5, y: 0 }, in: { x: 0.5, y: 1 } }],
        },
      ],
    },
    blurDimensions: 0,
    repeatEdgePixels: true,
    effectOpacity: 255,
  })
})

test('Progressive Layer Blur 降级为均匀模糊并警告', () => {
  const node = {
    id: '1:2',
    name: 'Progressive Blur',
    effects: [
      {
        type: 'LAYER_BLUR',
        blurType: 'PROGRESSIVE',
        radius: 16,
        startRadius: 0,
        startOffset: { x: 0, y: 0 },
        endOffset: { x: 1, y: 1 },
        visible: true,
      },
    ],
    animations: {},
  } as unknown as SceneNode
  const warnings: Array<{ message: string }> = []

  const effects = readLayerEffects(node, 30, warnings)
  assert.equal(effects[0].blurriness, 16)
  assert.match(warnings[0].message, /降级为均匀模糊/)
})

test('其他可见 Effect 仍明确报错', () => {
  const node = {
    id: '1:3',
    name: 'Shadow',
    effects: [{ type: 'DROP_SHADOW', visible: true }],
    animations: {},
  } as unknown as SceneNode

  assert.throws(() => readLayerEffects(node, 30, []), /DROP_SHADOW/)
})
