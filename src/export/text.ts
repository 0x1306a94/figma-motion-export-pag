import { readNodeTransform } from './solid'
import type { ExportTransformContext } from './solid'
import type { ExportIssue, TextSvgMetrics } from './types'
import {
  ParagraphJustification,
  type PagColor,
  type PagPoint,
  type PagTextDocument,
  type PagTextLayer,
} from './pag/types'

const black: PagColor = { red: 0, green: 0, blue: 0 }
const firstBaselineFactor = 0.8

interface TextLayoutMetrics {
  firstBaseline: number
  leading: number
}

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

function pointPosition(node: TextNode, context: ExportTransformContext, firstBaseline: number): PagPoint {
  let offsetX = 0
  if (node.textAlignHorizontal === 'CENTER') offsetX = node.width / 2
  else if (node.textAlignHorizontal === 'RIGHT') offsetX = node.width
  const offsetY = firstBaseline
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

export function buildTextDocument(
  node: TextNode,
  warnings: ExportIssue[],
  metrics?: TextLayoutMetrics,
): PagTextDocument {
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
  const fill = readFill(node)
  return {
    applyFill: true,
    applyStroke: false,
    boxText: mode === 'box',
    fauxBold: false,
    fauxItalic: false,
    strokeOverFill: true,
    baselineShift: 0,
    firstBaseLine: mode === 'box'
      ? metrics?.firstBaseline ?? estimateFirstBaseline(fontSize)
      : 0,
    boxTextPos: { x: 0, y: 0 },
    boxTextSize: mode === 'box' ? { x: node.width, y: node.height } : { x: 0, y: 0 },
    fillColor: fill.color,
    fontSize,
    strokeColor: black,
    strokeWidth: 1,
    text: node.characters,
    justification: justificationFromAlign(node.textAlignHorizontal),
    leading: metrics?.leading ?? leadingFromLineHeight(node.lineHeight, fontSize),
    tracking: trackingFromLetterSpacing(node.letterSpacing, fontSize),
    fontFamily: fontName.family,
    fontStyle: fontName.style || 'Regular',
  }
}

export async function readTextNode(
  node: TextNode,
  id: number,
  duration: number,
  context: ExportTransformContext,
  warnings: ExportIssue[],
  parseTextSvg?: (bytes: Uint8Array) => Promise<TextSvgMetrics>,
): Promise<PagTextLayer> {
  const metrics = await readTextLayoutMetrics(node, warnings, parseTextSvg)
  const sourceText = buildTextDocument(node, warnings, metrics)
  const fill = readFill(node)
  const transform = readNodeTransform(node, context)
  if (!sourceText.boxText) {
    transform.anchorPoint = { x: 0, y: 0 }
    transform.position = pointPosition(node, context, metrics.firstBaseline)
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

async function readTextLayoutMetrics(
  node: TextNode,
  warnings: ExportIssue[],
  parseTextSvg?: (bytes: Uint8Array) => Promise<TextSvgMetrics>,
): Promise<TextLayoutMetrics> {
  const fontSize = node.fontSize === figma.mixed ? 12 : node.fontSize as number
  const fallback = {
    firstBaseline: estimateFirstBaseline(fontSize),
    leading: leadingFromLineHeight(node.lineHeight, fontSize),
  }
  if (parseTextSvg === undefined) return fallback

  try {
    const renderBounds = node.absoluteRenderBounds
    const transform = node.absoluteTransform
    if (
      renderBounds === null
      || Math.abs(transform[0][1]) > 0.000001
      || Math.abs(transform[1][0]) > 0.000001
      || transform[1][1] <= 0
    ) {
      throw new Error('文本包含旋转、斜切或不可用的渲染边界')
    }
    const bytes = await node.exportAsync({ format: 'SVG', svgOutlineText: false })
    const parsed = await parseTextSvg(bytes)
    if (parsed.baselines.length === 0 || !parsed.baselines.every(Number.isFinite)) {
      throw new Error('SVG 中没有有效基线')
    }
    const renderTop = (renderBounds.y - transform[1][2]) / transform[1][1]
    return {
      firstBaseline: renderTop + parsed.baselines[0],
      leading: parsed.baselines.length > 1
        ? parsed.baselines[1] - parsed.baselines[0]
        : fallback.leading,
    }
  } catch {
    warnings.push({
      nodeId: node.id,
      nodeName: node.name,
      message: '未能读取 Figma 实际文字基线，已使用估算值。',
    })
    return fallback
  }
}
