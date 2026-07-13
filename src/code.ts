import { exportSelection } from './export/export-selection'
import { ExportError } from './export/types'
import type { PluginMessage, UiMessage } from './export/types'

figma.showUI(__html__, { width: 360, height: 430 })

let cancelled = false
let nextWebPRequestId = 1
const webPRequests = new Map<
  number,
  { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }
>()

figma.ui.onmessage = async (message: PluginMessage) => {
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
  const frame = selection.length === 1 && selection[0].type === 'FRAME' ? selection[0] : undefined
  postMessage({
    type: 'selection-changed',
    canExport: frame !== undefined,
    selectionName: frame?.name,
  })
}

function postMessage(message: UiMessage): void {
  figma.ui.postMessage(message)
}
