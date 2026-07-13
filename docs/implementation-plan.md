# Figma Motion → PAG 实现计划

> 状态：Phase 0～6 已实现；Phase 7 待后续处理。
> 范围：仅二进制 `.pag`；纯 TypeScript 编码，不使用 WASM。

## 1. 实现目标

第一阶段交付一个可验证的纵向切片：

```text
UI 配置
→ 选择一个顶层 Frame
→ 校验并导出 #solid Rectangle
→ TypeScript 编码最小 .pag
→ 原生 libpag PAGFile::Load() 回读
→ UI 下载文件
```

后续依次增加普通 Shape、图片填充/WebP、Motion Transform。每个阶段都必须保持 `.pag` 可回读，不先构建理论完整的导出框架。

## 2. 实现状态

- `src/code.ts` 和 `ui.html` 已替换为导出流程及配置面板。
- `manifest.json` 已开启 Motion Beta 所需的 proposed API。
- 已提供纯 TypeScript PAG 编码器，不使用 WASM。
- 已提供 TypeScript 单元测试与链接 `build_libpag/libpag.a` 的原生回读测试。
- `npm run verify` 会执行单测、原生回读、构建和 lint。

## 3. 建议目录

只建立实际需要的模块：

```text
src/
  code.ts                       # 插件入口、消息分发、下载结果协调
  export/
    export-selection.ts         # 导出总流程
    motion.ts                   # Motion 轨道规范化
    solid.ts                    # #solid 识别与校验
    shape.ts                    # Rectangle/Ellipse/Vector
    image.ts                    # 图片收集、UI WebP 请求
    types.ts                    # ExportOptions、IR、错误类型
    pag/
      types.ts                  # 最小 PAG 文件模型
      encode-stream.ts          # bit/byte/varint/float 写入
      encode-file.ts            # 文件头、Tag、Layer、Property 编码
test/
  *.test.ts                     # 纯函数和编码测试
  native/
    verify.cpp                  # PAGFile::Load() 回读工具
ui.html                         # 配置、进度、错误、Canvas WebP、下载
```

不为一次性逻辑创建 class；除 `EncodeStream` 外优先使用纯函数和简单对象。

## 4. 关键接口

### 4.1 配置与消息

```ts
type FrameRate = 24 | 30 | 60

interface ExportOptions {
  frameRate: FrameRate
  webpEnabled: boolean
  webpQuality: number // UI 值，默认 80
}

type UIToPluginMessage =
  | { type: 'start-export'; options: ExportOptions }
  | { type: 'cancel-export' }
  | { type: 'webp-result'; requestId: string; bytes?: Uint8Array; error?: string }

type PluginToUIMessage =
  | { type: 'selection-changed'; valid: boolean; message?: string }
  | { type: 'export-progress'; completed: number; total: number; label: string }
  | { type: 'encode-webp'; requestId: string; sourceBytes: Uint8Array; quality: number }
  | { type: 'export-error'; issues: ExportIssue[] }
  | { type: 'export-complete'; name: string; bytes: Uint8Array }
```

UI 默认值：frameRate=30、webpEnabled=true、webpQuality=80。

### 4.2 导出入口

```ts
async function exportSelection(
  selection: readonly SceneNode[],
  options: ExportOptions,
  encodeWebP: (source: Uint8Array, quality: number) => Promise<Uint8Array>,
): Promise<ExportResult>

interface ExportResult {
  fileName: string
  bytes: Uint8Array
  warnings: ExportIssue[]
}

interface ExportIssue {
  code: string
  message: string
  nodeId?: string
  nodeName?: string
}
```

所有不可恢复错误统一抛出包含 `ExportIssue[]` 的导出错误，由 `code.ts` 转发到 UI；不要在底层直接操作 UI。

### 4.3 `#solid`

```ts
interface SolidNodeData {
  name: string
  width: number
  height: number
  color: RGB
  opacity: number
}

function readSolidNode(node: SceneNode): SolidNodeData | null
```

返回 `null` 表示没有 `#solid` 标记；存在标记但不合格时抛出详细校验错误。

### 4.4 Motion

```ts
interface MotionPoint<T> {
  frame: number
  value: T
  easing: MotionEasing
}

function readMotionTrack<T>(
  binding: KeyframeBinding,
  frameRate: FrameRate,
): MotionPoint<T>[]

function makeKeyframes<T>(points: readonly MotionPoint<T>[]): PagKeyframe<T>[]
```

MVP 仅接受单个 `SET` track；多轨、OFFSET、SCALE 在语义实测完成前返回明确错误。

### 4.5 PAG 编码

```ts
function encodePagFile(file: PagFile): Uint8Array

class EncodeStream {
  writeBit(value: boolean): void
  writeBits(value: number, count: number): void
  writeUint8(value: number): void
  writeUint32(value: number): void
  writeEncodedUint32(value: number): void
  writeEncodedInt32(value: number): void
  writeFloat32(value: number): void
  writeBytes(value: Uint8Array): void
  alignToByte(): void
  toUint8Array(): Uint8Array
}
```

只实现当前 Tag 实际调用的方法，不复制 libpag 完整 Stream API。

## 5. 核心伪代码

### 5.1 主导出流程

```text
exportSelection(selection, options):
  assert selection 只有一个 Frame
  validate options
  collect root width/height/timeline duration
  traverse visible children in layer order

  for each node:
    if name starts with #solid:
      validate and create SolidLayer IR
    else if supported basic shape:
      create ShapeLayer IR
    else if supported image fill:
      collect source bytes
      if webpEnabled:
        request UI Canvas WebP encode
      create ImageBytes + ImageLayer IR
    else:
      record blocking issue

    read supported Motion fields from node.animations
    attach Transform2D properties

  if any blocking issue:
    abort without producing bytes

  build VectorComposition using selected frameRate
  bytes = encodePagFile(file)
  return bytes
```

### 5.2 UI WebP 编码

```text
on encode-webp message:
  create Blob from source bytes
  decode with createImageBitmap
  draw to canvas at original size
  canvas.toBlob('image/webp', quality / 100)
  convert Blob to Uint8Array
  post webp-result with same requestId

on any decode/canvas/toBlob failure:
  post webp-result error
```

WebP 失败不静默回退；主线程中断导出并显示对应节点错误。

### 5.3 `#solid` 校验

```text
if name does not start with literal #solid:
  return null

require node.type == RECTANGLE
require width > 0 and height > 0
require all four corner radii are numeric zero
require fills is not mixed
require fills.length == 1
require fills[0].type == SOLID and fills[0].visible != false
require no visible stroke

outputName = remove /^#solid\s*/
opacity = node.opacity * (fill.opacity ?? 1)
return SolidNodeData
```

### 5.4 时间与关键帧

```text
for each Figma key point:
  frame = round(timelinePosition * frameRate)

sort by frame
resolve same-frame collisions using confirmed product rule
for each adjacent pair:
  emit PAG keyframe [startFrame, endFrame)
  map LINEAR / HOLD / CUSTOM_CUBIC_BEZIER
```

## 6. 分阶段实施

### Phase 0：约束确认与工程清理

变更：

- 确认开放问题中标记为阻塞的产品规则。
- 验证 Motion API 是否需要 `enableProposedApi`。
- 修正 pack 脚本中的 PAGX 包名、说明和仓库地址。
- 增加 `npm test`；使用 Node 内置 `node:test`，仅增加轻量 TypeScript 执行层（如 `tsx`），不引入完整测试框架。

验收：build、lint、空测试命令均通过，产物命名不出现 PAGX。

### Phase 1：UI 与消息协议

变更：

- UI 增加帧率下拉、WebP 开关、质量滑块、导出/取消按钮。
- 增加进度、错误列表和 `.pag` Blob 下载。
- 主线程只完成选择校验与消息协调。

验收：默认值正确；24/30/60 可选；WebP 关闭时质量控件禁用；错误可显示节点名。

### Phase 2：最小 PAG 编码器

先只支持手工构造的单 Composition + 单 SolidLayer：

- PAG 文件头与 Tag header。
- FileTags、VectorComposition、Layer、LayerAttributes。
- Transform2D 静态 Property。
- SolidColor Tag。
- 必要的枚举、默认值、reference ID。

依据逐文件对照：

- `libpag/src/codec/Codec.cpp`
- `libpag/src/codec/TagHeader.*`
- `libpag/src/codec/AttributeHelper.h`
- `libpag/src/codec/tags/FileTags.cpp`
- `libpag/src/codec/tags/VectorCompositionTag.cpp`
- `libpag/src/codec/tags/LayerTag.cpp`
- `libpag/src/codec/tags/LayerAttributes.*`
- `libpag/src/codec/tags/Transform2D.*`
- `libpag/src/codec/tags/SolidColor.cpp`

验收：固定测试对象编码稳定；原生 `PAGFile::Load()` 返回非空并读出正确尺寸、帧率、duration、层类型和颜色。

#### Phase 2 已证实的编码常量与顺序

- 所有多字节数值使用 little-endian。
- bit stream 从当前字节的低位向高位写入（LSB-first），写普通 byte 后 bit position 自动对齐。
- 文件头依次为 ASCII `PAG`、version `1`、body uint32 长度、compression ASCII `U`、body。
- Tag header 为 uint16：高 10 bit 是 TagCode，低 6 bit 是长度；长度小于 63 直接写，反之低 6 bit 写 63，再追加 uint32 长度。
- End Tag 是 uint16 `0`。
- 最小使用的 TagCode：VectorCompositionBlock=2、CompositionAttributes=3、LayerBlock=5、LayerAttributes=6、SolidColor=7、Transform2D=13；需要名称时使用 LayerAttributesV2=52。
- LayerType：Solid=2。
- unsigned varint 每字节 7 bit 数据 + 最高位 continuation；signed varint 使用 `abs(value) << 1 | negativeFlag`，不是标准 ZigZag。

最小文件顺序：

```text
PAG file header
└─ VectorCompositionBlock
   ├─ composition id: encoded uint32
   ├─ CompositionAttributes
   ├─ LayerBlock
   │  ├─ layer type: uint8 (Solid=2)
   │  ├─ layer id: encoded uint32
   │  ├─ LayerAttributes 或 LayerAttributesV2
   │  ├─ Transform2D
   │  ├─ SolidColor
   │  └─ End
   └─ End
└─ End
```

CompositionAttributes 内容固定为：width encoded int32、height encoded int32、duration encoded uint64、frameRate float32、background RGB 三字节。

SolidColor 内容固定为：RGB 三字节、width encoded int32、height encoded int32。

Transform2D 属性顺序与默认值：anchorPoint=(0,0)、position=(0,0)、xPosition=0、yPosition=0、scale=(1,1)、rotation=0、opacity=255。静态非默认 Property 写 `exist=1, animatable=0` 后写值；默认值写 `exist=0`。Spatial Property 仅在 animatable 时再写 hasSpatial bit。

LayerAttributes 顺序：isActive、autoOrientation、parent、stretch、startTime、blendMode、trackMatteType、timeRemap、duration；V2 最后增加 name。duration 是 FixedValue，不写 exist bit。flag bits 先连续写入并按 byte 对齐，再追加所有存在属性的 value bytes。

依据：`libpag/src/codec/Version.h`、`CompressionAlgorithm.h`、`TagHeader.*`、`utils/EncodeStream.*`、`AttributeHelper.*`、`tags/CompositionAttributes.cpp`、`tags/LayerAttributes.cpp`、`tags/Transform2D.cpp`、`tags/SolidColor.cpp`、`tags/LayerTag.cpp`。

### Phase 3：`#solid` 端到端

变更：

- 遍历选择 Frame 的直接/递归子节点。
- 完成 `#solid` 校验、重命名、Transform 和 Layer 时间范围。
- 任一标记节点不合格时整个导出失败。

验收：

- 合法 Rectangle 加载后是 `PAGSolidLayer`。
- 圆角、多填充、非纯色、visible stroke、零尺寸分别得到准确 UI 错误。
- 名称正确去除前缀和后续空白。

### Phase 4：基础 Shape

变更：

- Rectangle/Ellipse/Vector 的静态几何。
- SolidFill、SolidStroke 的静态属性。
- ShapeLayer、ShapeElement 与必要 Property 编码。

验收：结构回读正确；PAGViewer 与 Figma 静态截图对比。

### Phase 5：图片填充与 WebP

变更：

- 收集 IMAGE Paint 对应原始字节并去重。
- UI Canvas WebP 编码请求队列。
- ImageBytes、ImageReference、ImageLayer 和基础缩放/裁剪。
- WebP 开关及质量值贯通。

实际边界：仅支持 Rectangle + 单一可见 IMAGE Paint；支持 FIT 与使用矩形 PAG Mask 的 FILL。
圆角裁剪、图片滤镜、TILE、CROP、图片旋转及可见描边会中断导出。关闭 WebP 时保留
PNG/JPEG/WebP 原始字节，非 WebP 通过 ImageBytesV3 显式记录尺寸。

验收：默认导出的 ImageBytes 可识别为 WebP；透明图片透明度正确；相同 imageHash 只编码一次；质量设置影响输出大小；关闭 WebP 走已确认格式。

### Phase 6：Motion Transform

变更：

- OPACITY、TRANSLATION_X/Y/XY、ROTATION、SCALE_X/Y/XY。
- 静态与 AnimatableProperty。
- Linear、Hold、Custom Cubic Bezier。
- 24/30/60 的秒→Frame 转换。

验收：每种属性覆盖静态、2 点、多点、同帧碰撞、三种 easing；逐帧对比 Figma 与 PAG。

### Phase 7：增强项

按探索文档顺序逐项加入：path trim、统一圆角/尺寸、fill/stroke 动画、Spring 采样、简单 mask、PreCompose、DropShadow。每项单独提交，不提前建立通用抽象。

## 7. 测试与验证

### TypeScript 单元测试

- varint、signed int、bit 对齐、float/颜色量化。
- 秒→Frame 与 duration。
- N 个点生成 N-1 个区间。
- Linear/Hold/Bezier 编码。
- `#solid` 每个成功/失败条件。
- name 前缀移除。
- imageHash 去重和 UI requestId 配对。

### 二进制测试

- 每个 Tag 一个最小 fixture。
- TypeScript 编码结果使用原生 libpag 小工具调用 `PAGFile::Load(bytes)`。
- 回读并输出 JSON 摘要供测试断言，不只判断非空。
- 禁止使用任何 PAGX verifier。

### 视觉测试

- 24/30/60 fps 各一份。
- Solid、Shape、透明 WebP、Motion Transform 各一个固定 Figma 样例。
- 比较关键帧与区间中点；Spring 加入后再增加逐帧误差阈值。

## 8. 提交拆分建议

1. `chore: prepare PAG export workflow`
2. `feat: add export settings UI`
3. `feat: encode minimal PAG solid layer`
4. `feat: export tagged solid rectangles`
5. `feat: encode basic PAG shapes`
6. `feat: export WebP image fills`
7. `feat: encode transform animations`

每个提交都要求 build、lint、相关单测及 `PAGFile::Load()` gate 通过。

## 9. 已确认决策

### 阻塞对应阶段

| 问题 | 决策 |
|---|---|
| WebP 质量 | 0～100，步长 1，默认 80 |
| 关闭 WebP | 保留 Figma 原始图片字节 |
| `#solid` 边界 | 仅匹配 `#solid` 后为空白或名称结束；不匹配 `#solidBox` |
| `#solid` 描边 | 存在可见描边立即中断 |
| 图片填充 MVP | Rectangle + 单一可见 IMAGE Paint |
| 同帧碰撞 | 保留后写入点并产生 warning |
| Motion track | 仅单一 SET；多轨、OFFSET、SCALE 中断 |
| PAG 版本 | 对齐仓库内当前 libpag codec/tag |
| 不支持属性 | 中断导出，不静默保留首帧 |
| 本次范围 | Phase 0～6；Phase 7 后续单独实现 |

## 10. 仍需 Figma 实测

- TRANSLATION、ROTATION、SCALE、OPACITY 在真实 Motion 文件中的局部坐标、方向和值域。
- Animation Style 展开到 `node.animations` 后的时间语义。
- Figma 与 PAGViewer 的关键帧、中点帧视觉对比。
