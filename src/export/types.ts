export type FrameRate = 24 | 30 | 60

export interface ExportOptions {
  frameRate: FrameRate
  webpEnabled: boolean
  webpQuality: number
}

export interface ExportIssue {
  nodeId?: string
  nodeName?: string
  message: string
}

export class ExportError extends Error {
  readonly issues: ExportIssue[]

  constructor(issues: ExportIssue[]) {
    super(issues.map((issue) => issue.message).join('\n'))
    this.name = 'ExportError'
    this.issues = issues
  }
}

export type PluginMessage =
  | { type: 'start-export'; options: ExportOptions }
  | { type: 'cancel' }
  | { type: 'webp-result'; requestId: number; bytes?: Uint8Array; error?: string }

export type UiMessage =
  | { type: 'selection-changed'; canExport: boolean; selectionName?: string }
  | { type: 'progress'; message: string }
  | {
      type: 'encode-webp'
      requestId: number
      bytes: Uint8Array
      mimeType: string
      quality: number
    }
  | { type: 'error'; issues: ExportIssue[] }
  | { type: 'complete'; bytes: Uint8Array; fileName: string; warnings: ExportIssue[] }
