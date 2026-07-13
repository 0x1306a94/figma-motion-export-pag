import { readNumberKeyframeBinding } from './motion'
import type { PagFastBlurEffect } from './pag/types'
import { ExportError } from './types'
import type { ExportIssue } from './types'

export function readLayerEffects(
  node: SceneNode,
  frameRate: number,
  warnings: ExportIssue[],
): PagFastBlurEffect[] {
  if (!('effects' in node)) return []
  const effects: PagFastBlurEffect[] = []
  for (const [effectIndex, effect] of node.effects.entries()) {
    if (effect.visible === false) continue
    if (effect.type !== 'LAYER_BLUR') {
      fail(node, `当前版本不支持可见 Effect：${effect.type}。`)
    }
    if (effect.blurType === 'PROGRESSIVE') {
      warnings.push({
        nodeId: node.id,
        nodeName: node.name,
        message: 'PAG 不支持渐进模糊，已降级为均匀模糊。',
      })
    }
    const binding = node.animations.effects?.[effectIndex]
    const unsupportedFields = binding === undefined
      ? []
      : Object.keys(binding).filter((field) => field !== 'RADIUS')
    if (unsupportedFields.length > 0) {
      fail(node, `当前版本不支持 Layer Blur Motion 属性：${unsupportedFields.join('、')}。`)
    }
    const radiusBinding = binding?.RADIUS
    const blurriness = radiusBinding === undefined
      ? Math.max(0, effect.radius)
      : readNumberKeyframeBinding(
          node,
          radiusBinding,
          'Layer Blur RADIUS',
          frameRate,
          warnings,
          (value) => Math.max(0, value),
        )
    effects.push({
      type: 'fast-blur',
      blurriness,
      blurDimensions: 0,
      repeatEdgePixels: true,
      effectOpacity: 255,
    })
  }
  return effects
}

function fail(node: SceneNode, message: string): never {
  throw new ExportError([{ nodeId: node.id, nodeName: node.name, message }])
}
