export interface PagColor {
  red: number
  green: number
  blue: number
}

export interface PagPoint {
  x: number
  y: number
}

export interface PagKeyframe<T> {
  startTime: number
  endTime: number
  startValue: T
  endValue: T
  interpolation: 1 | 2 | 3
  bezier?: Array<{ out: PagPoint; in: PagPoint }>
}

export interface PagAnimatedProperty<T> {
  keyframes: PagKeyframe<T>[]
}

export type PagProperty<T> = T | PagAnimatedProperty<T>

export interface PagTransform {
  anchorPoint?: PagProperty<PagPoint>
  position?: PagProperty<PagPoint>
  xPosition?: PagProperty<number>
  yPosition?: PagProperty<number>
  scale?: PagProperty<PagPoint>
  rotation?: PagProperty<number>
  opacity?: PagProperty<number>
}

export interface PagLayerBase {
  id: number
  active?: boolean
  name: string
  startTime: number
  duration: number
  transform: PagTransform
  masks?: PagMask[]
  trackMatteType?: PagTrackMatteType
}

export type PagTrackMatteType = 'alpha' | 'alpha-inverted' | 'luma' | 'luma-inverted'

export type PagMaskMode = 'none' | 'add' | 'subtract' | 'intersect' | 'lighten' | 'darken' | 'difference' | 'accum'

export interface PagMask {
  id: number
  commands: PagProperty<PagPathCommand[]>
  inverted?: boolean
  mode?: PagMaskMode
  feather?: PagProperty<PagPoint>
  opacity?: PagProperty<number>
  expansion?: PagProperty<number>
}

export interface PagSolidLayer extends PagLayerBase {
  type: 'solid'
  width: number
  height: number
  color: PagColor
}

export interface PagPathCommand {
  type: 'move' | 'line' | 'curve' | 'close'
  values: number[]
}

export type PagShapeGeometry =
  | { type: 'rectangle'; size: PagPoint; position: PagPoint; roundness: number }
  | { type: 'ellipse'; size: PagPoint; position: PagPoint }
  | { type: 'path'; commands: PagPathCommand[] }

export interface PagShapePaint {
  color: PagColor
  opacity: number
}

export interface PagShapeStroke extends PagShapePaint {
  width: number
  lineCap: number
  lineJoin: number
  miterLimit: number
}

export interface PagShapeLayer extends PagLayerBase {
  type: 'shape'
  geometry: PagShapeGeometry
  fill?: PagShapePaint
  fillRule: number
  stroke?: PagShapeStroke
}

export interface PagImageLayer extends PagLayerBase {
  type: 'image'
  imageId: number
}

export interface PagImage {
  id: number
  width: number
  height: number
  bytes: Uint8Array
  explicitSize: boolean
}

export type PagLayer = PagSolidLayer | PagShapeLayer | PagImageLayer

export interface PagComposition {
  id: number
  width: number
  height: number
  duration: number
  frameRate: number
  backgroundColor: PagColor
  images?: PagImage[]
  layers: PagLayer[]
}
