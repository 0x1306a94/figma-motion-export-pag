# Agents 探索指导：Figma Motion → PAG

> 本文是给 Agent 的**探索任务说明书**，不是实现方案本身。  
> 探索完成后，在 `docs/` 产出分析文档与映射文档；**未确认方案前禁止编码实现导出器**。

---

## 1. 任务目标

将 **Figma Motion**（节点上的 animation styles / manual keyframes / timeline）导出为 libpag 可加载的 **二进制 `.pag`** 文件。

| 项 | 内容 |
|---|---|
| 输入 | Figma 插件可选中的 SceneNode（含 Motion 属性）+ 静态几何/样式 |
| 输出 | `.pag`（`PAGFile::Load()` 可加载） |
| 参考实现 | AE → PAG 导出插件 `libpag/exporter/` |
| 格式真相源 | `libpag/include/pag/file.h` |
| 效果能力边界 | `libpag/src/rendering/filters/`（及 `layerstyle/`） |

---

## 2. 硬性边界（违反即错误）

1. **只做 PAG（`.pag`）**，禁止默认走 PAGX（`.pagx`）、禁止用 `pagx verify`、禁止把 `libpag/src/pagx/` / `libpag/spec/` 当本任务主参考。
2. 用户未明确要求比较时，**不要**搜索、引用、修改 PAGX 代码路径。
3. Figma Motion API 处于 **Beta**，以本机 `node_modules/@figma/plugin-typings` 为准；官方文档与 typings 冲突时 **以 typings 为准**，并在文档中标注差异。
4. 探索阶段产出文档；实现阶段须先输出关键接口 + 伪代码 + 疑问清单，**用户确认后再编码**。
5. 优先简单、可验证的映射子集；不要为「理论完备」设计过度抽象。

---

## 3. 应产出的文档（探索结束标准）

在 `docs/` 下生成（文件名可微调，但内容必须覆盖）：

| 文档 | 职责 |
|---|---|
| `docs/pag-analysis.md` | PAG 侧：Composition / Layer / Property / Keyframe / Transform / Effect / LayerStyle 的数据模型与编码路径摘要 |
| `docs/figma-motion-analysis.md` | Figma 侧：Timeline、`animations` vs `manualKeyframeTracks` vs `animationStyles`、单位、坐标系、可动画字段清单 |
| `docs/figma-motion-to-pag-mapping.md` | **核心交付**：字段级映射表、时间/缓动转换、不支持项与降级策略、建议实现分期（MVP → 增强） |
| （可选）`docs/open-questions.md` | 无法从源码/文档判定、需产品或实测回答的问题 |

每份文档须标明：依据文件路径、结论置信度（已证实 / 推断 / 待实测）、以及「禁止假设却已假设」的条目。

---

## 4. 权威资料与查询顺序

### 4.1 Figma Motion（输入侧）

| 来源 | 用途 |
|---|---|
| https://developers.figma.com/docs/plugins/api/Motion/ | 类型总览 |
| https://developers.figma.com/docs/plugins/api/figma-motion/ | `figma.motion.*` API |
| `node_modules/@figma/plugin-typings/plugin-api.d.ts` | **权威**：`MotionAPI`、`MotionNodeMixin`、Keyframe 类型 |
| 插件内实测（如有样例文件） | `node.animations` 与 style 展开结果、时间轴单位行为 |

**优先阅读的 typings 符号：**

- `MotionAPI`：`figmaAnimationStyles`、`physicalSpringToNormalized`
- `MotionNodeMixin`：`animationStyles`、`animations`、`manualKeyframeTracks`、`timelines`
- `KeyframePropertyFieldName`、`EffectKeyframeFieldName`、`KeyframeField`
- `MotionEasing`、`KeyframeValue`、`KeyframeBinding`、`ManualKeyframeTrack`

**导出读取策略（探索时要写清）：**

- 导出应优先读 **`node.animations`**（含 style 展开后的完整轨道），还是只读 `manualKeyframeTracks`？
- `animationStyles` 的 `duration` / `timelineOffset` / `props` 与最终 keyframes 的关系？
- `keyframeOperation: 'SET' | 'OFFSET' | 'SCALE'` 对 PAG Property 语义意味着什么？

### 4.2 PAG / libpag（输出侧）

| 路径 | 查什么 | 工具 |
|---|---|---|
| `libpag/exporter/` | AE 如何把图层、变换、关键帧、效果写入 PAG | CodeGraph（`projectPath` 指到 exporter 或仓库根） |
| `libpag/include/pag/file.h` | `Property` / `AnimatableProperty` / `Keyframe` / `Transform2D` / `Layer` / `Composition` / Effect / LayerStyle | CodeGraph → 必要时 Read 片段 |
| `libpag/src/codec/` | Tag 编码、二进制写入 | CodeGraph |
| `libpag/src/base/` | 运行时属性与关键帧插值 | CodeGraph |
| `libpag/src/rendering/filters/` | 哪些 Effect 可渲染、参数语义 | CodeGraph；目录枚举可用 shell `ls` |

**禁止：** 用 `rg`/grep 扫整个 `libpag/`；结构问题一律 CodeGraph。  
**允许 grep 的：** 错误字符串、注释、字面量常量。

### 4.3 CodeGraph 用法（本仓库）

```text
codegraph_explore
  projectPath: /Users/king/WorkSpace/figma-motion-export-pag   # 或 .../libpag/exporter
  query: 具体符号名或短问题（如 "ExportLayer Transform2D StreamProperty"）
```

建议查询包（可分多次，每次聚焦一条链路）：

1. `ExportComposition` / `ExportLayer` / `PAGExport` — AE 导出主流程  
2. `Transform2D` / `StreamProperty` — 变换与可动画属性如何从 AE stream 落到 PAG Property  
3. `Keyframe` / `AnimatableProperty` / `SingleEaseKeyframe` — 时间与缓动编码  
4. `Effect` / `LayerStyle`（exporter 与 rendering/filters）— 效果能力与参数  

**注意：** 查询词若含泛化的 `Composition`/`Layer`，索引可能混入 PAGX / tgfx。查询时显式带上 `pag::`、`file.h`、`exporter/`、`ExportLayer` 等 PAG 侧关键词；结果若落到 `libpag/include/pagx/` 或 `libpag/src/pagx/`，视为串台，丢弃并收窄 query。

---

## 5. 探索阶段（按顺序执行）

### Phase A — 问题拆解（不读大段代码）

先列出必须回答的问题，例如：

1. 一个 Figma Frame 的 Timeline 如何对应 PAG `Composition`（fps、duration、frame 对齐）？
2. 节点树如何对应 Layer 树（PreCompose / 父子 / 裁剪）？
3. Motion 时间单位是秒；PAG 是 Frame — 换算与舍入规则？
4. `TRANSLATION_*` / `ROTATION` / `SCALE_*` / `OPACITY` 与 `Transform2D` 字段一一对应关系？坐标系与锚点？
5. Cubic Bezier / Spring / HOLD 如何落到 PAG Keyframe 插值（是否采样烘焙）？
6. fills/strokes/effects 关键帧：哪些可进 Shape/Fill，哪些必须光栅化或丢弃？
7. Animation Style 与 Manual Track 并存时的优先级？

每问标注：可用源码回答 / 需 Figma 实测 / 需产品决策。

### Phase B — Figma Motion 能力盘点

从 typings + 文档整理表格：

| 可动画字段 | 值类型 | 读取 API | PAG 候选目标 | 初步判定：支持 / 降级 / 不支持 |
|---|---|---|---|---|

覆盖至少：`OPACITY`、`TRANSLATION_*`、`ROTATION`、`SCALE_*`、`WIDTH`/`HEIGHT`、圆角、stroke、path trim、fills/strokes indexed、effects indexed。

### Phase C — PAG 模型与 AE 导出对照

用 CodeGraph 弄清：

- `Composition`：宽高、duration、frameRate、layers  
- `Layer`：`transform`（必有 2D 或 3D 之一）、时间范围、masks/effects/layerStyles  
- `Property<T>` vs `AnimatableProperty<T>` + `Keyframe`（bezier、spatial）  
- exporter 如何写 Transform / Shape / Image / Text / Effect  

产出「AE 概念 → PAG 结构」摘要，作为 Figma 映射的模板，而不是照搬 AE API。

### Phase D — 映射草案

在 `figma-motion-to-pag-mapping.md` 中给出：

1. **管线草图**（文字即可）：  
   `Figma Node 树 + Motion` → `中间 IR` → `pag::File 对象图` → `二进制 encode`
2. **字段映射表**（Figma → IR → PAG）
3. **时间与缓动**：秒↔Frame；Bezier 直出 vs Spring 采样；HOLD 处理
4. **不支持矩阵**：明确丢弃 / 警告 / 烘焙为序列帧 的策略与代价
5. **MVP 建议**：例如「仅静态几何 + OPACITY/POSITION/SCALE/ROTATION 关键帧 + 固定 fps」，其余二期

### Phase E — 验证策略（只规划，不强制本阶段执行）

| 层级 | 方法 |
|---|---|
| 单元 | 关键帧转换、单位换算纯函数测试 |
| 编码 | `npm test`（项目 PAG 测试，若已有） |
| 二进制 | `PAGFile::Load()` |
| 视觉 | PAGViewer / PAG SDK 渲染对比 Figma 预览 |
| 禁止 | `build_libpag/pagx` 处理 `.pag` |

---

## 6. 已知起点（减少空转；细节以源码为准）

### 6.1 Figma（typings 摘要）

- 时间：`timelinePosition` / `duration` / `timelineOffset` 均为 **秒**。
- 读全量动画：`node.animations`；读写手写轨：`manualKeyframeTracks`；样式实例：`animationStyles`。
- 缓动：`LINEAR` / `EASE_*` / `CUSTOM_CUBIC_BEZIER` / `CUSTOM_SPRING`（normalized bounce）/ `HOLD` 等。
- 变换相关字段：`TRANSLATION_X|Y|XY`、`ROTATION`、`SCALE_X|Y|XY`、`OPACITY`。
- Effect 关键帧字段含 shadow/blur/noise 等（`EffectKeyframeFieldName`），需与 PAG filters **逐项对齐**，默认多数不可无损映射。

### 6.2 PAG（file.h / exporter 摘要）

- `Transform2D`：`anchorPoint`、`position`（或拆分 x/y）、`scale`、`rotation`、`opacity` — 均可为可动画 Property。
- Layer 必须带 `transform` 或 `transform3D`；Composition 持有 layers 与时间信息。
- 关键帧插值在 `libpag/src/base/keyframes/`；空间路径与一维缓动模型不同，映射时不要混用。
- filters 目录存在 Blur / Glow / Displacement / Mosaic / MotionBlur 等；**存在渲染实现 ≠ AE/Figma 同名效果可直接对应**，必须对照 exporter 的 Effect 写入与参数。

### 6.3 概念鸿沟（文档必须显式处理）

| Figma Motion | PAG / AE 传统模型 |
|---|---|
| 设计工具节点 + 秒级时间轴 | 合成 / 图层 / Frame |
| Animation Style 模板 + 展开轨 | 直接关键帧属性 |
| Spring / HOLD 等 | 多为 Bezier 关键帧；Spring 可能需采样 |
| 布局属性动画（padding、stack gap） | 通常无直接对应 → 降级或忽略 |
| 相对操作 OFFSET/SCALE | AE/PAG 多为绝对 SET |

---

## 7. Agent 行为约束

**要做：**

- 先提问清单，再查源码；不确定就标「待确认」，不要静默选一种解释写进映射表当事实。
- 映射表每行写清：依据路径、是否有 AE exporter 先例、失败时降级。
- 发现更简单路径（例如 MVP 只支持变换+透明度）时主动提出。
- 中文撰写 `docs/` 产出；表述简洁、表格优先。

**不要做：**

- 未确认方案就改 `src/` 实现导出。
- 把 PAGX、SVGExporter、PPTExporter 当 PAG 导出参考。
- 大范围 grep `libpag/`。
- 发明未在 `file.h` / codec 出现的 PAG 字段。
- 假设 Figma 与 AE 坐标系/锚点/旋转方向一致（必须验证或标注风险）。

---

## 8. 推荐探索 Prompt（可直接复制给子 Agent）

```text
你在仓库 figma-motion-export-pag 中做只读探索（不写实现代码）。

目标：搞清如何把 Figma Motion 导出为 libpag 的 .pag。
硬约束：只分析 PAG（.pag），禁止 PAGX；结构查询用 CodeGraph；Figma API 以
node_modules/@figma/plugin-typings/plugin-api.d.ts 为准。

按 docs/explore.md 的 Phase A→E 执行。
最终在 docs/ 写入：
- pag-analysis.md
- figma-motion-analysis.md
- figma-motion-to-pag-mapping.md
并列出 open questions。

重点：
1) node.animations 与 Transform2D / Property / Keyframe 的字段级映射
2) 秒→Frame、Bezier/Spring/HOLD 策略
3) effects 哪些可映射到 rendering/filters，哪些必须放弃或烘焙
4) MVP 范围建议与验证方法（PAGFile::Load，禁用 pagx）
```

---

## 9. 完成检查清单

- [ ] PAG / PAGX 边界全文未越界  
- [ ] Figma 可动画字段表完整（相对 typings）  
- [ ] PAG Composition/Layer/Property/Keyframe 模型有源码依据  
- [ ] 映射表含：支持 / 降级 / 不支持  
- [ ] 时间与缓动策略写清  
- [ ] MVP 与后续分期明确  
- [ ] Open questions 已单列  
- [ ] 未提交实现代码（除非用户另开实现任务并确认方案）
