import type { ExportIssue } from './types'

export type SupportedGradientPaint = GradientPaint & {
  type: 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR'
}

export type SupportedFillPaint = SolidPaint | ImagePaint | SupportedGradientPaint

export function isSupportedGradientPaint(paint: Paint): paint is SupportedGradientPaint {
  return paint.type === 'GRADIENT_LINEAR'
    || paint.type === 'GRADIENT_RADIAL'
    || paint.type === 'GRADIENT_ANGULAR'
}

export function readVisibleFills(node: SceneNode, warnings: ExportIssue[]): Paint[] | null {
  if (!('fills' in node) || node.fills === figma.mixed) return null
  const fills: Paint[] = []
  for (const paint of node.fills) {
    if (paint.visible === false) continue
    if (paint.type === 'SHADER') {
      warnings.push({
        nodeId: node.id,
        nodeName: node.name,
        message: 'PAG 不支持 Shader Fill，已忽略。',
      })
      continue
    }
    if (paint.type === 'GRADIENT_DIAMOND') {
      warnings.push({
        nodeId: node.id,
        nodeName: node.name,
        message: 'PAG 不支持 Diamond 渐变，已忽略。',
      })
      continue
    }
    fills.push(paint)
  }
  return fills
}
