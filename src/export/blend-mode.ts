import { PagBlendMode } from './pag/types'
import { ExportError } from './types'

export function readBlendMode(mode: BlendMode | undefined, node: SceneNode): PagBlendMode {
  switch (mode ?? 'NORMAL') {
    case 'NORMAL': return PagBlendMode.Normal
    case 'MULTIPLY': return PagBlendMode.Multiply
    case 'SCREEN': return PagBlendMode.Screen
    case 'OVERLAY': return PagBlendMode.Overlay
    case 'DARKEN': return PagBlendMode.Darken
    case 'LIGHTEN': return PagBlendMode.Lighten
    case 'COLOR_DODGE': return PagBlendMode.ColorDodge
    case 'COLOR_BURN': return PagBlendMode.ColorBurn
    case 'HARD_LIGHT': return PagBlendMode.HardLight
    case 'SOFT_LIGHT': return PagBlendMode.SoftLight
    case 'DIFFERENCE': return PagBlendMode.Difference
    case 'EXCLUSION': return PagBlendMode.Exclusion
    case 'HUE': return PagBlendMode.Hue
    case 'SATURATION': return PagBlendMode.Saturation
    case 'COLOR': return PagBlendMode.Color
    case 'LUMINOSITY': return PagBlendMode.Luminosity
    case 'LINEAR_DODGE': return PagBlendMode.Add
    default:
      throw new ExportError([
        { nodeId: node.id, nodeName: node.name, message: `PAG 不支持 ${mode} 混合模式。` },
      ])
  }
}
