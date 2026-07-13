import { exportSelection } from './export/export-selection'
import {
  clearMotionAnchorCache,
  readCachedMotionAnchor,
  refreshMotionAnchorCache,
  setMotionAnchorCache,
} from './export/motion'
import { ExportError } from './export/types'
import type { AnimationDebugData, AnimationDebugNode, PluginMessage, UiMessage } from './export/types'

const defaultUiHeight = 430
const developerUiHeight = 720

figma.showUI(__html__, { width: 360, height: defaultUiHeight })

let cancelled = false
let developerModeEnabled = false
let nextWebPRequestId = 1
const webPRequests = new Map<
  number,
  { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }
>()

figma.ui.onmessage = async (message: PluginMessage) => {
  if (message.type === 'set-developer-mode') {
    developerModeEnabled = message.enabled
    figma.ui.resize(360, message.enabled ? developerUiHeight : defaultUiHeight)
    if (message.enabled) postAnimationDebugData()
    return
  }
  if (message.type === 'request-animation-debug-data') {
    postAnimationDebugData()
    return
  }
  if (message.type === 'refresh-motion-anchor') {
    refreshSelectedMotionAnchor()
    return
  }
  if (message.type === 'set-motion-anchor') {
    setSelectedMotionAnchor(message.x, message.y)
    return
  }
  if (message.type === 'clear-motion-anchor') {
    clearSelectedMotionAnchor()
    return
  }
  if (message.type === 'webp-result') {
    const request = webPRequests.get(message.requestId)
    if (request === undefined) return
    webPRequests.delete(message.requestId)
    if (message.error !== undefined || message.bytes === undefined) {
      request.reject(new Error(message.error ?? 'WebP 编码失败。'))
    } else {
      request.resolve(message.bytes)
    }
    return
  }
  if (message.type === 'cancel') {
    cancelled = true
    for (const request of webPRequests.values()) request.reject(new Error('导出已取消。'))
    webPRequests.clear()
    return
  }
  if (message.type !== 'start-export') return

  cancelled = false
  postMessage({ type: 'progress', message: '正在读取图层…' })
  try {
    const result = await exportSelection(figma.currentPage.selection, message.options, encodeWebP)
    if (cancelled) return
    postMessage({
      type: 'complete',
      bytes: result.bytes,
      fileName: result.fileName,
      warnings: result.warnings,
    })
  } catch (error) {
    const issues =
      error instanceof ExportError
        ? error.issues
        : [{ message: error instanceof Error ? error.message : '导出失败。' }]
    postMessage({ type: 'error', issues })
  }
}

function refreshSelectedMotionAnchor(): void {
  const selection = figma.currentPage.selection
  if (selection.length !== 1) {
    postMessage({ type: 'motion-anchor-result', success: false, message: '请选择一个节点。' })
    return
  }
  const anchor = refreshMotionAnchorCache(selection[0])
  if (anchor === null) {
    postMessage({
      type: 'motion-anchor-result',
      success: false,
      message: '未能推导锚点。请将纯 SET SCALE_XY 动画拖到已发生缩放的位置后重试。',
    })
    return
  }
  postMessage({
    type: 'motion-anchor-result',
    success: true,
    message: `已缓存锚点：${anchor.x}, ${anchor.y}`,
    anchor,
  })
  if (developerModeEnabled) postAnimationDebugData()
}

function setSelectedMotionAnchor(x: number, y: number): void {
  const node = selectedNodeForMotionAnchor()
  if (node === null) return
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    postMessage({ type: 'motion-anchor-result', success: false, message: '锚点坐标必须是有效数字。' })
    return
  }
  const anchor = { x, y }
  setMotionAnchorCache(node, anchor)
  postMessage({ type: 'motion-anchor-result', success: true, message: `已缓存锚点：${x}, ${y}`, anchor })
}

function clearSelectedMotionAnchor(): void {
  const node = selectedNodeForMotionAnchor()
  if (node === null) return
  clearMotionAnchorCache(node)
  postMessage({ type: 'motion-anchor-result', success: true, message: '已清除锚点缓存。' })
}

function selectedNodeForMotionAnchor(): SceneNode | null {
  const selection = figma.currentPage.selection
  if (selection.length === 1) return selection[0]
  postMessage({ type: 'motion-anchor-result', success: false, message: '请选择一个节点。' })
  return null
}

function encodeWebP(source: Uint8Array, mimeType: string, quality: number): Promise<Uint8Array> {
  const requestId = nextWebPRequestId++
  return new Promise((resolve, reject) => {
    webPRequests.set(requestId, { resolve, reject })
    postMessage({ type: 'encode-webp', requestId, bytes: source, mimeType, quality })
  })
}

figma.on('selectionchange', updateSelection)
updateSelection()

function updateSelection(): void {
  const selection = figma.currentPage.selection
  const node = selection.length === 1 ? selection[0] : undefined
  postMessage({
    type: 'selection-changed',
    canExport: node !== undefined,
    selectionName: node?.name,
    selectionWidth: node?.width,
    selectionHeight: node?.height,
    motionAnchor: node === undefined ? undefined : readCachedMotionAnchor(node) ?? undefined,
  })
  if (developerModeEnabled) postAnimationDebugData()
}

function postAnimationDebugData(): void {
  const selection = figma.currentPage.selection
  if (selection.length !== 1) {
    postMessage({ type: 'animation-debug-error', message: '请选择一个节点。' })
    return
  }

  postMessage({ type: 'animation-debug-data', data: collectAnimationDebugData(selection[0]) })
}

function collectAnimationDebugData(selectedNode: SceneNode): AnimationDebugData {
  const animatedNodes: AnimationDebugNode[] = []
  let visitedNodeCount = 0

  function visit(node: SceneNode, path: string): void {
    visitedNodeCount++
    if (hasAnimationData(node)) {
      animatedNodes.push({
        id: node.id,
        name: node.name,
        type: node.type,
        parentId: node.parent?.id,
        path,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        rotation: 'rotation' in node ? node.rotation : undefined,
        opacity: 'opacity' in node ? node.opacity : undefined,
        relativeTransform: node.relativeTransform,
        absoluteTransform: node.absoluteTransform,
        animationStyles: node.animationStyles,
        animations: node.animations,
        manualKeyframeTracks: node.manualKeyframeTracks,
        timelines: node.timelines,
      })
    }

    if ('children' in node) {
      for (const child of node.children) visit(child, `${path} / ${child.name}`)
    }
  }

  visit(selectedNode, selectedNode.name)
  return {
    selectedNode: { id: selectedNode.id, name: selectedNode.name, type: selectedNode.type },
    visitedNodeCount,
    animatedNodes,
  }
}

function hasAnimationData(node: SceneNode): boolean {
  return (
    node.animationStyles.length > 0 ||
    Object.keys(node.animations).length > 0 ||
    Object.keys(node.manualKeyframeTracks).length > 0
  )
}

function postMessage(message: UiMessage): void {
  figma.ui.postMessage(message)
}
