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

export interface AnimationDebugNode {
  id: string
  name: string
  type: SceneNode['type']
  parentId?: string
  path: string
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  opacity?: number
  relativeTransform: Transform
  absoluteTransform: Transform
  animationStyles: AppliedAnimationStyle[]
  animations: Animations
  manualKeyframeTracks: ManualKeyframeTracks
  timelines: ReadonlyArray<Timeline>
}

export interface AnimationDebugData {
  selectedNode: Pick<AnimationDebugNode, 'id' | 'name' | 'type'>
  visitedNodeCount: number
  animatedNodes: AnimationDebugNode[]
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
  | { type: 'set-developer-mode'; enabled: boolean }
  | { type: 'request-animation-debug-data' }
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
  | { type: 'animation-debug-data'; data: AnimationDebugData }
  | { type: 'animation-debug-error'; message: string }
  | { type: 'complete'; bytes: Uint8Array; fileName: string; warnings: ExportIssue[] }
