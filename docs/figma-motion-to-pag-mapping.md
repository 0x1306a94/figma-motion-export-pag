# Figma Motion → PAG 字段映射草案

> 状态：探索结论，不是已确认实现方案。输出仅为二进制 `.pag`；实现约束为纯 TypeScript，不使用 WASM。

## 1. 建议管线

```text
SceneNode 树 + node.animations + 静态样式
→ 规范化 TypeScript IR（绝对值、秒、RGBA、节点局部坐标）
→ 图片数据按 UI 配置在 UI 线程用 Canvas 转为 WebP（可选）
→ PAG IR（Frame、Property、Keyframe、Composition/Layer）
→ TypeScript PAG Tag/bit 编码器
→ Uint8Array(.pag)
→ PAGFile::Load() 验证
```

IR 的作用仅是隔离 Figma Beta API 与 PAG codec，保持为简单数据结构，不建立通用动画框架。

主线程与 UI 线程职责：主线程读取 Figma 节点并执行 PAG 对象/二进制编码；UI 线程负责配置面板和 Canvas WebP 编码，通过消息传递 `ArrayBuffer`，避免在 Figma 主线程依赖 DOM/Canvas。

### UI 导出配置（已确认）

| 配置 | UI | 默认值 | 导出语义 |
|---|---|---|---|
| 帧率 | 下拉框，仅 `24 / 30 / 60` | `30` | 同时写入 Composition.frameRate，并用于全部秒→Frame 换算 |
| WebP | 开关 | 开启 | 仅作用于需要写入 ImageBytes 的图片填充/光栅资源 |
| WebP 质量 | 滑块 | `80` | UI 线程 Canvas 编码时以 `quality / 100` 传入编码质量；仅在 WebP 开启时生效 |

WebP 转换失败必须中断导出并在 UI 显示具体图片/图层错误，不能静默回退到另一格式。

## 2. Composition 与节点树

| Figma | 中间 IR → PAG | AE exporter 先例 | 失败降级 | 依据/置信度 |
|---|---|---|---|---|
| 选中顶层 Frame | Composition → VectorComposition | `ExportComposition.cpp` | 阻止导出 | typings + `file.h`，字段已证实 |
| 普通可绘制节点 | Layer + content → Shape/Image/Text Layer | `ExportLayer.cpp` | 光栅 ImageLayer | `file.h`，条件支持 |
| 子 Frame/Group | child Composition → PreComposeLayer | `CreatePreComposeLayer` | 展平或光栅 | `file.h`，模型已证实 |
| parent-child 变换 | parentId → Layer.parent | `InitLayer` | 烘焙父变换 | `file.h` + codec，引用规则待实现确认 |
| clipsContent/mask | mask path → masks/track matte | `GetMasks` | 光栅 | `file.h`，MVP 仅简单矢量裁剪 |
| Auto Layout | 烘焙每帧几何 → 无直接字段 | 无 | 保持首帧或序列帧 | typings + `file.h`，确认无同构字段 |
| `#solid` Rectangle | SolidLayer IR → `pag::SolidLayer` | `CreateSolidLayer` | 任一资格检查失败即中断 | `file.h` + `SolidLayer.cpp`，已证实 |

### `#solid` 命名标记

识别节点名称开头的大小写敏感字面量 `#solid`。导出前执行以下硬检查：

1. 节点必须是 Rectangle。
2. 四角半径必须全部为 0，不能为 mixed。
3. 必须恰好一个可见的纯色填充，不接受渐变、图片、视频或多重填充。
4. width、height 必须大于 0。
5. 当前存在可见 stroke 时中断；支持的 effects 仍走通用 Layer effect/style 管线，不支持的 effect 按通用策略中断或降级。

任一检查失败：终止整个导出，在 UI 面板列出原始图层名与失败条件，不写出 `.pag`。

全部通过：构造文件模型 `pag::SolidLayer`，把矩形尺寸写入 width/height，纯色写入 solidColor，节点/填充透明度合并到 Transform2D.opacity。输出名称按 `name.replace(/^#solid\s*/, '')` 的语义移除前缀及随后连续空白符。

注意：加载 `.pag` 后 SDK 暴露为 `PAGSolidLayer`，但 TypeScript 编码阶段的目标类型是 `pag::SolidLayer`。

## 3. Transform 映射

| Figma | IR → PAG / 转换 | AE exporter 先例 | 失败降级 | 依据/置信度 |
|---|---|---|---|---|
| OPACITY | number → opacity；确认 [0,1] 后乘 255 | `GetTransform2D` | 保持首帧并警告 | typings + `file.h`，值域待实测 |
| TRANSLATION_X / TRANSLATION_Y | x/y → xPosition/yPosition；像素 | `GetTransform2D` 拆分维度 | 保持首帧或序列帧 | typings + `file.h`，局部原点待实测 |
| TRANSLATION_XY | Point → position；像素 | `GetTransform2D` | 保持首帧或序列帧 | typings + `file.h`，局部原点待实测 |
| ROTATION | degrees → rotation；符号待定 | `GetTransform2D` | 保持首帧并警告 | typings + `file.h`，方向待实测 |
| SCALE_X / SCALE_Y / SCALE_XY | ratio → scale Point | `GetTransform2D` | 保持首帧并警告 | typings + `file.h`，基准值待实测 |
| 静态 transform origin | anchor → anchorPoint | `GetTransform2D` | 烘焙到 position/path | Figma 无 Motion anchor 轨，静态条件支持 |

同一 Layer 不能同时把 position 与 x/y 拆分形式都作为有效数据；应按轨道形态二选一，规则参考 `LayerTag.cpp`。

## 4. Shape、Paint 与几何

| Figma → PAG | AE exporter 先例 | 支持级别 | 失败降级 | 依据 |
|---|---|---|---|---|
| 纯色 fill 颜色/透明度 → SolidFill | `GetShapes` | 条件支持 | 序列帧 | typings + `file.h` |
| 纯色 stroke 颜色/透明度/宽度 → SolidStroke | `GetShapes` | 条件支持 | 序列帧 | typings + `file.h` |
| 线性/径向渐变 → GradientFill/Stroke | `GetShapes` | 二期，需核对 stop/坐标 | 序列帧 | typings + `file.h` |
| WIDTH/HEIGHT（矩形/椭圆）→ size | Shape size stream | 条件支持 | Path 或序列帧 | typings + `file.h` |
| 统一圆角 → Rectangle.roundness | Rectangle Shape | 条件支持 | Path | typings + `file.h` |
| 独立四角圆角 → Path | Shape Path | 二期烘焙 | 序列帧 | typings；PAG 无逐角字段 |
| PATH_TRIM_START/END → TrimPaths.start/end | TrimPaths | 条件支持 | 保持首帧并警告 | typings + `file.h`，值域待实测 |
| 布局字段 → 无 | 无 | 不支持 | 保持首帧或序列帧 | typings + `file.h` |

## 5. Effect 映射白名单

| Figma Effect → PAG | AE exporter 先例 | 判定 | 失败降级 | 依据 |
|---|---|---|---|---|
| DROP_SHADOW → DropShadowStyle | `GetLayerStyles` | 二期条件支持 | 序列帧 | `file.h`；参数需视觉实测 |
| INNER_SHADOW → 无 | exporter 也不写此 PAG style | 不支持 | 序列帧 | `file.h` 无 InnerShadow |
| LAYER_BLUR NORMAL → FastBlurEffect | `GetEffects` | 二期近似 | 序列帧 | 两侧字段存在，参数语义未证实 |
| BACKGROUND_BLUR → 无 | 无 | 不支持 | 序列帧 | 依赖背景采样，无同构字段 |
| PROGRESSIVE BLUR → 无 | 无 | 不支持 | 序列帧 | `file.h` 无渐变 blur 参数 |
| NOISE/TEXTURE → 无 | 无 | 不支持 | 序列帧 | `file.h` 无同构 Effect |
| GLASS → 无 | 无 | 不支持 | 序列帧 | 折射/高光/色散无同构 Effect |
| SHADER → 无通用等价 | 无 | 不支持 | 序列帧 | PAG 无 Figma shader 定义 |

“filters 目录存在某效果”不构成映射依据；只有参数和合成语义都验证后才进入白名单。

## 6. 时间转换

帧率由 UI 下拉选择，仅允许 24、30、60，默认 30。换算规则：

```text
frame = round(seconds * framesPerSecond)
compositionDuration = max(1, round(timelineDuration * framesPerSecond))
```

`round` 有 AE exporter 先例。转换后必须：

1. 按 frame 排序。
2. 检测多个输入点落到同一 frame；禁止生成零长度 PAG Keyframe。
3. 碰撞默认报 warning，并保留时间上最后一个点（此规则属于产品决策）。
4. 相邻点构造 `[startFrame,endFrame)` 区间。
5. 末点可位于 `compositionDuration`，但可见帧仍为 `0..duration-1`。

同一次导出的所有 Composition 使用同一个 UI 帧率值，避免父子合成换算差异。

## 7. 缓动转换

| Figma | PAG | 策略 |
|---|---|---|
| LINEAR | Linear | 直出 |
| HOLD | Hold | 直出 |
| CUSTOM_CUBIC_BEZIER | Bezier | 将 `(x1,y1)` 写 bezierOut、`(x2,y2)` 写 bezierIn；先验证 PAG 控制点范围 |
| 可确认的固定 cubic preset | Bezier | 使用官方/实测固定参数 |
| Spring、无法确认的 preset | 多段 Linear 或 Bezier | 以 frame 采样；误差与文件大小成正比 |

Spring 只有 normalized bounce，不能可靠反推唯一物理曲线；必须以 Figma 实际播放曲线/可用 API 为依据。若无法获取求值结果，MVP 应拒绝而非发明曲线。

## 8. Track 操作

PAG Property 需要绝对值，而 Figma binding 可能叠加 SET/OFFSET/SCALE。规范化阶段应先把所有轨求值成单条绝对轨：

```text
for each animated field:
  read baseValue and ordered tracks
  resolve operation semantics at every union key time
  output absolute key points
```

但 operation 的顺序与公式目前待实测。MVP 安全边界：仅接受单一 SET track；遇到 OFFSET/SCALE 或多 track 就报可定位 warning，不静默导出错误结果。

## 9. 分期建议

### MVP

- 单个顶层 Frame，帧率下拉支持 24/30/60，默认 30。
- 静态 Shape/Image；简单节点树。
- 图片资源默认在 UI 线程经 Canvas 编码为质量 80 的 WebP，可关闭或调整质量。
- 支持符合资格检查的 `#solid` Rectangle，输出为 `pag::SolidLayer`。
- OPACITY、TRANSLATION、ROTATION、SCALE 的单 SET track。
- LINEAR、HOLD、CUSTOM_CUBIC_BEZIER。
- TypeScript 最小 PAG 编码：File、VectorComposition、基础 Layer、Transform2D、必要 Shape/Image Tag。
- 每个产物必须通过 `PAGFile::Load()`。

### 二期

- Spring/preset 采样、路径 trim、尺寸/统一圆角、纯色 fill/stroke 动画。
- 简单 mask、PreCompose、DropShadow、Layer Blur 近似。
- OFFSET/SCALE 与多轨（实测语义后）。

### 三期

- 渐变、文本动画、复杂裁剪、可控序列帧降级。
- 不追求对 Glass/Shader/布局动画的原生 PAG 字段映射。

## 10. 验证策略

| 层级 | 验证 |
|---|---|
| 单元 | 秒→帧、碰撞、值域、N 点→N-1 区间、Bezier/采样 |
| 编码 | 每个 Tag 的 golden bytes 或 libpag 解码回读 |
| 二进制 | `PAGFile::Load()` 非空；禁止使用 `pagx verify` |
| 结构 | 解码后 composition/layer/property 数量和值匹配 |
| 视觉 | PAGViewer/PAG SDK 逐关键帧及中间帧截图对比 Figma |

## 11. 假设登记

已采用但尚未产品确认的建议：frame 碰撞保留最后点、MVP 非 SET 直接拒绝。它们均是建议，不是事实。

未假设：坐标原点、锚点、旋转方向、scale/opacity 值域、effect 参数等价性。

## 12. 依据与置信度说明

- Figma 字段与读取结构：`node_modules/@figma/plugin-typings/plugin-api.d.ts` 1.130.0，已证实。
- PAG 对象字段：`libpag/include/pag/file.h`，已证实。
- PAG 编码顺序：`libpag/src/codec/`，总体路径已证实；TypeScript 逐 Tag bit layout 待实现前确认。
- AE 先例：`libpag/exporter/src/export/`，已证实，但只作为 PAG 构造模板，不证明 Figma 语义相同。
- 表内“支持”表示两侧有同构候选字段；凡涉及单位、坐标或效果参数者均标为条件支持/待实测。
