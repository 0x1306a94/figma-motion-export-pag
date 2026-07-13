import type { PagComposition } from '../src/export/pag/types'

export const solidFixture: PagComposition = {
  id: 1,
  width: 320,
  height: 180,
  duration: 30,
  frameRate: 30,
  backgroundColor: { red: 255, green: 255, blue: 255 },
  images: [
    {
      id: 1,
      width: 1,
      height: 1,
      explicitSize: true,
      bytes: Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x04, 0x00, 0x00, 0x00, 0xb5, 0x1c, 0x0c, 0x02, 0x00, 0x00, 0x00,
        0x0b, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0x64, 0xf8, 0x0f, 0x00,
        0x01, 0x05, 0x01, 0x01, 0x27, 0x18, 0xe3, 0x66, 0x00, 0x00, 0x00, 0x00,
        0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
      ]),
    },
  ],
  layers: [
    {
      type: 'solid',
      id: 2,
      name: 'Background',
      startTime: 0,
      duration: 30,
      width: 320,
      height: 180,
      color: { red: 255, green: 128, blue: 0 },
      transform: { position: { x: 12, y: 8 }, opacity: 204 },
    },
    {
      type: 'shape',
      id: 3,
      name: 'Badge',
      startTime: 0,
      duration: 30,
      transform: {
        position: {
          keyframes: [
            {
              startTime: 0,
              endTime: 15,
              startValue: { x: 100, y: 40 },
              endValue: { x: 160, y: 40 },
              interpolation: 1,
            },
            {
              startTime: 15,
              endTime: 30,
              startValue: { x: 160, y: 40 },
              endValue: { x: 200, y: 80 },
              interpolation: 2,
              bezier: [{ out: { x: 0.42, y: 0 }, in: { x: 0.58, y: 1 } }],
            },
          ],
        },
      },
      geometry: {
        type: 'rectangle',
        size: { x: 80, y: 40 },
        position: { x: 40, y: 20 },
        roundness: 8,
      },
      fill: { color: { red: 20, green: 110, blue: 240 }, opacity: 255 },
      fillRule: 0,
      stroke: {
        color: { red: 255, green: 255, blue: 255 },
        opacity: 255,
        width: 2,
        lineCap: 1,
        lineJoin: 1,
        miterLimit: 4,
      },
    },
    {
      type: 'image',
      id: 4,
      imageId: 1,
      name: 'Picture',
      startTime: 0,
      duration: 30,
      transform: { position: { x: 220, y: 80 }, scale: { x: 40, y: 40 } },
      masks: [
        {
          id: 1,
          commands: [
            { type: 'move', values: [0, 0] },
            { type: 'line', values: [1, 0] },
            { type: 'line', values: [1, 1] },
            { type: 'line', values: [0, 1] },
            { type: 'close', values: [] },
          ],
        },
      ],
    },
  ],
}
