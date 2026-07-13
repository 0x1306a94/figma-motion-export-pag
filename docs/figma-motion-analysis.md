# Figma Motion 输入模型分析

> 权威版本：本机 `@figma/plugin-typings` 1.130.0。Motion API 为 Beta。

## 1. 读取策略

导出应优先读取 `node.animations`。typings 明确说明它包含动画样式展开后的关键帧和手工关键帧；`manualKeyframeTracks` 仅含手工轨，不能代表最终动画；`animationStyles` 只描述已应用样式实例及配置，不提供完整展开结果。

| API | 内容 | 导出用途 | 置信度 |
|---|---|---|---|
| `node.animations` | 完整 `Animations`，每字段含 baseValue、timelineDuration、tracks | 主输入 | 已证实 |
| `node.manualKeyframeTracks` | 手工轨的绑定与点 | 调试/来源说明 | 已证实 |
| `node.animationStyles` | styleId、duration、timelineOffset、props | 元数据与诊断 | 已证实 |
| `node.timelines` | 当前返回包含节点的顶层 Frame timeline | 合成 duration 候选 | 已证实（“currently”意味着 Beta 可变） |
| `figma.motion.figmaAnimationStyles()` | 文档中可用动画模板 | 不参与已展开动画导出 | 已证实 |

依据：`node_modules/@figma/plugin-typings/plugin-api.d.ts` 中 `MotionAPI`、`MotionNodeMixin`、`Animations`；[Figma Motion 文档](https://developers.figma.com/docs/plugins/api/Motion/)。

官方网页与本机 typings 在本次核对中未发现字段差异。

## 2. 时间、值与轨道

- `timelinePosition`、Timeline `duration`、style `duration/timelineOffset` 均为秒。
- `KeyframeValue` 可为 FLOAT、COLOR、TEXT_DATA、VECTOR、BOOL、CIRCLE、LINE、CIRCLE_POINT、COLOR_POINT。
- `KeyframeBinding` = `baseValue + timelineDuration + tracks[]`。
- 每条 track 有 `keyframeOperation: SET | OFFSET | SCALE`。

`SET/OFFSET/SCALE` 的合成顺序和数学语义未在 typings/官方 Motion 页面定义。不能把 OFFSET 静默当加法、SCALE 静默当乘法；需插件实测。置信度：待实测。

## 3. 缓动

| Figma easing | 初步 PAG 策略 | 置信度 |
|---|---|---|
| LINEAR | Linear | 已证实可表达 |
| HOLD | Hold | 已证实可表达 |
| CUSTOM_CUBIC_BEZIER | 直写时间 Bezier | 已证实可表达；控制点边界待验证 |
| EASE_IN/OUT/IN_AND_OUT | 转为固定 cubic preset | preset 数值待确认 |
| EASE_*_BACK | 可能用超出 0..1 的 cubic | PAG codec 接受范围待验证 |
| GENTLE/QUICK/BOUNCY/SLOW | 官方未给等价 cubic | 待实测，默认采样 |
| CUSTOM_SPRING | normalized bounce，不足以直接构造 PAG cubic | 采样烘焙 |
| VariableAlias | 先解析变量；无法解析则报错 | 待实测 |

依据：本机 typings 的 `MotionEasing`；[figma.motion 文档](https://developers.figma.com/docs/plugins/api/figma-motion/)。

## 4. 可动画字段清单

| Figma 字段 | 值候选 | PAG 候选 | 初判 |
|---|---|---|---|
| OPACITY | FLOAT | Transform2D.opacity | 支持，值域待实测 |
| TRANSLATION_X / TRANSLATION_Y | FLOAT | xPosition/yPosition | 支持，坐标待实测 |
| TRANSLATION_XY | VECTOR | position | 支持，坐标待实测 |
| ROTATION | FLOAT | rotation | 支持，方向/单位待实测 |
| SCALE_X / SCALE_Y / SCALE_XY | FLOAT/VECTOR | scale | 支持，基准值待实测 |
| WIDTH / HEIGHT | FLOAT | Shape size 或几何重建 | 条件支持；布局节点降级 |
| CORNER_RADIUS | FLOAT | Rectangle.roundness | 仅统一圆角支持 |
| RECTANGLE_TOP_LEFT_CORNER_RADIUS / RECTANGLE_TOP_RIGHT_CORNER_RADIUS / RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS / RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS | FLOAT | 无逐角字段 | 降级为路径或序列帧 |
| STROKE_WEIGHT | FLOAT | Solid/GradientStroke.strokeWidth | 条件支持 |
| BORDER_TOP_WEIGHT / BORDER_BOTTOM_WEIGHT / BORDER_LEFT_WEIGHT / BORDER_RIGHT_WEIGHT | FLOAT | 无四边独立描边 | 不支持/序列帧 |
| PATH_TRIM_START / PATH_TRIM_END | FLOAT | TrimPaths.start/end | 支持，值域待实测 |
| STACK_SPACING / STACK_COUNTER_SPACING | FLOAT | 无布局属性 | 不支持/烘焙几何 |
| STACK_PADDING_LEFT / STACK_PADDING_TOP / STACK_PADDING_RIGHT / STACK_PADDING_BOTTOM | FLOAT | 无布局属性 | 不支持/烘焙几何 |
| GRID_ROW_GAP / GRID_COLUMN_GAP | FLOAT | 无布局属性 | 不支持/烘焙几何 |
| fills[index] | KeyframeBinding 或组件属性绑定 | Shape Fill | 条件支持，Paint 类型需匹配 |
| strokes[index] | 同上 | Shape Stroke | 条件支持 |
| effects[index].field | FLOAT/COLOR 等 | Effect/LayerStyle | 仅白名单字段条件支持 |
| fills/strokes/effects propertyId | Shader/组件属性 | 无通用目标 | MVP 不支持 |

以上覆盖本机 `KeyframePropertyFieldName` 的全部成员。依据：`plugin-api.d.ts`。

## 5. Effect 字段

Figma Effect 联合类型包括 DropShadow、InnerShadow、Layer/Background Blur（含 progressive）、Noise、Texture、Glass、Shader。可动画字段名还包括 OFFSET_X/Y、RADIUS、SPREAD、COLOR、折射/高光/色散、噪声尺寸/密度/颜色等。

字段名不能脱离 `effects[index].type` 解释。例如 RADIUS 在 blur、shadow、texture、glass 中语义不同。索引也可能因 effect 列表重排失效，导出时必须同时读取静态 `node.effects[index]`。

| EffectKeyframeFieldName | Figma Effect 候选 | PAG 候选 | 初判 |
|---|---|---|---|
| OFFSET_X / OFFSET_Y | Shadow | DropShadowStyle angle + distance | 二期条件支持，需坐标实测 |
| RADIUS | Shadow / Blur / Texture / Glass | DropShadowStyle.size 或 FastBlur.blurriness | 按 effect type 条件支持 |
| SPREAD | Shadow | DropShadowStyle.spread | DropShadow 二期支持；InnerShadow 不支持 |
| COLOR | Shadow / Noise | DropShadowStyle.color | 仅 DropShadow 条件支持 |
| REFRACTION_RADIUS | Glass | 无 | 不支持/序列帧 |
| SPECULAR_ANGLE | Glass | 无 | 不支持/序列帧 |
| SPECULAR_INTENSITY | Glass | 无 | 不支持/序列帧 |
| CHROMATIC_ABERRATION | Glass | 无 | 不支持/序列帧 |
| SPLAY | Glass/Texture（具体归属待实测） | 无 | 不支持/序列帧 |
| REFRACTION_INTENSITY | Glass | 无 | 不支持/序列帧 |
| START_RADIUS | Progressive Blur | 无 | 不支持/序列帧 |
| NOISE_SIZE_X / NOISE_SIZE_Y | Noise / Texture | 无 | 不支持/序列帧 |
| DENSITY | Noise | 无 | 不支持/序列帧 |
| EFFECT_OPACITY | Noise Multitone | 无直接效果字段 | 不支持/序列帧 |
| SECONDARY_COLOR | Noise Duotone | 无 | 不支持/序列帧 |

以上覆盖本机 `EffectKeyframeFieldName` 的全部成员。具体字段归属不能仅由枚举判定，必须结合 `node.effects[index]`；其中 `SPLAY` 在静态 Effect typings 中没有同名公开属性，标记待实测。

## 6. 需实测项

仓库没有 Figma Motion 样例文件或探针结果，因此以下不能由源码判定：

- TRANSLATION 是相对节点当前位置还是最终局部 position。
- SCALE 的 1/100 基准、ROTATION 单位和正方向、OPACITY 值域。
- Animation Style 与 Manual Track 并存时 tracks 顺序及操作合成。
- style 的 timelineOffset 是否已经反映在 `animations.tracks[].timelinePosition`。
- timelineDuration 与顶层 `timelines[0].duration` 的边界关系。
- fills/strokes 整体 Paint 关键帧的实际 KeyframeValue 类型。

“禁止假设却已假设”的条目：无；上列全部保持待实测。

## 7. 静态节点标记

图层名称支持大小写敏感的 `#solid` 前缀，表示请求把该节点编码为文件模型 `pag::SolidLayer`，加载后对应 SDK 的 `PAGSolidLayer`。

Figma 侧最低检查：

- 节点 `type === 'RECTANGLE'`。
- 四个角半径均明确为 0，不能是 `figma.mixed`。
- `fills` 不是 `figma.mixed`，且恰好一个可见 `SOLID` Paint。
- 节点宽高均大于 0，这是 PAG `SolidLayer::verify()` 的硬约束。
- 存在可见 stroke 时中断，直到确认能用 PAG StrokeStyle 无损表达；否则 SolidLayer 本身无法保留描边内容。

检查失败应中断整个导出，并把图层名称及具体原因显示在 UI 面板中，不生成部分 `.pag`。

检查成功后移除名称开头的 `#solid` 及其后连续空白符，剩余名称写入 PAG Layer。依据：Figma Rectangle/Paint typings、`libpag/include/pag/file.h`、`libpag/src/base/SolidLayer.cpp`。置信度：PAG 条件已证实；Figma 特殊 Paint/Effect 组合仍需实测。
