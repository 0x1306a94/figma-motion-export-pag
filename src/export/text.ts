import { readNodeTransform } from './solid'
import type { ExportTransformContext } from './solid'
import type { ExportIssue } from './types'
import {
  ParagraphJustification,
  type PagColor,
  type PagPoint,
  type PagTextDocument,
  type PagTextLayer,
} from './pag/types'

const black: PagColor = { red: 0, green: 0, blue: 0 }
const firstBaselineFactor = 0.8

export function textLayoutModeFromAutoResize(autoResize: string): 'point' | 'box' {
  return autoResize === 'WIDTH_AND_HEIGHT' ? 'point' : 'box'
}

export function estimateFirstBaseline(fontSize: number): number {
  return fontSize * firstBaselineFactor
}

function justificationFromAlign(align: string): ParagraphJustification {
  if (align === 'CENTER') return ParagraphJustification.Center
  if (align === 'RIGHT') return ParagraphJustification.Right
  if (align === 'JUSTIFIED') return ParagraphJustification.FullLastLineLeft
  return ParagraphJustification.Left
}

function leadingFromLineHeight(lineHeight: LineHeight | PluginAPI['mixed'], fontSize: number): number {
  if (lineHeight === figma.mixed || lineHeight.unit === 'AUTO') return 0
  if (lineHeight.unit === 'PIXELS') return lineHeight.value
  return (fontSize * lineHeight.value) / 100
}

function trackingFromLetterSpacing(
  letterSpacing: LetterSpacing | PluginAPI['mixed'],
  fontSize: number,
): number {
  if (letterSpacing === figma.mixed) return 0
  if (letterSpacing.unit === 'PIXELS') {
    return fontSize > 0 ? Math.round((letterSpacing.value / fontSize) * 1000) : 0
  }
  return letterSpacing.value * 10
}

function pointPosition(node: TextNode, context: ExportTransformContext, fontSize: number): PagPoint {
  let offsetX = 0
  if (node.textAlignHorizontal === 'CENTER') offsetX = node.width / 2
  else if (node.textAlignHorizontal === 'RIGHT') offsetX = node.width
  const offsetY = estimateFirstBaseline(fontSize)
  const transform = node.absoluteTransform
  const absolutePoint = {
    x: transform[0][0] * offsetX + transform[0][1] * offsetY + transform[0][2],
    y: transform[1][0] * offsetX + transform[1][1] * offsetY + transform[1][2],
  }
  return {
    x: context.absoluteToExportTransform[0][0] * absolutePoint.x
      + context.absoluteToExportTransform[0][1] * absolutePoint.y
      + context.absoluteToExportTransform[0][2],
    y: context.absoluteToExportTransform[1][0] * absolutePoint.x
      + context.absoluteToExportTransform[1][1] * absolutePoint.y
      + context.absoluteToExportTransform[1][2],
  }
}

function readFill(node: TextNode): { color: PagColor; opacity: number } {
  if (node.fills === figma.mixed) return { color: black, opacity: 1 }
  const fill = node.fills.find((paint) => paint.visible !== false && paint.type === 'SOLID')
  if (fill?.type !== 'SOLID') return { color: black, opacity: 1 }
  return {
    color: {
      red: Math.round(fill.color.r * 255),
      green: Math.round(fill.color.g * 255),
      blue: Math.round(fill.color.b * 255),
    },
    opacity: fill.opacity ?? 1,
  }
}

export function buildTextDocument(node: TextNode, warnings: ExportIssue[]): PagTextDocument {
  const mixedFont = node.fontName === figma.mixed
  const mixedSize = node.fontSize === figma.mixed
  const fontName: FontName = mixedFont
    ? { family: 'Inter', style: 'Regular' }
    : node.fontName as FontName
  const fontSize = mixedSize ? 12 : Math.round((node.fontSize as number) * 1000) / 1000
  const mode = textLayoutModeFromAutoResize(node.textAutoResize)
  if (mixedFont || mixedSize) {
    warnings.push({ nodeId: node.id, nodeName: node.name, message: '文本含混合样式，已取默认值。' })
  }
  if (node.textAlignVertical === 'BOTTOM') {
    warnings.push({ nodeId: node.id, nodeName: node.name, message: 'PAG 框文本无底对齐，已按默认规则导出。' })
  }
  const fill = readFill(node)
  return {
    applyFill: true,
    applyStroke: false,
    boxText: mode === 'box',
    fauxBold: false,
    fauxItalic: false,
    strokeOverFill: true,
    baselineShift: 0,
    firstBaseLine: mode === 'box' ? estimateFirstBaseline(fontSize) : 0,
    boxTextPos: { x: 0, y: 0 },
    boxTextSize: mode === 'box' ? { x: node.width, y: node.height } : { x: 0, y: 0 },
    fillColor: fill.color,
    fontSize,
    strokeColor: black,
    strokeWidth: 1,
    text: node.characters,
    justification: justificationFromAlign(node.textAlignHorizontal),
    leading: leadingFromLineHeight(node.lineHeight, fontSize),
    tracking: trackingFromLetterSpacing(node.letterSpacing, fontSize),
    fontFamily: fontName.family,
    fontStyle: fontName.style || 'Regular',
  }
}

export function readTextNode(
  node: TextNode,
  id: number,
  duration: number,
  context: ExportTransformContext,
  warnings: ExportIssue[],
): PagTextLayer {
  const sourceText = buildTextDocument(node, warnings)
  const fill = readFill(node)
  const transform = readNodeTransform(node, context)
  if (!sourceText.boxText) {
    transform.anchorPoint = { x: 0, y: 0 }
    transform.position = pointPosition(node, context, sourceText.fontSize)
  }
  transform.opacity = Math.round(node.opacity * fill.opacity * 255)
  return {
    type: 'text',
    id,
    name: node.name,
    startTime: 0,
    duration,
    transform,
    sourceText,
  }
}
