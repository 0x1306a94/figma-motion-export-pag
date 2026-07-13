# 开放问题

## 已决策

| 问题 | 决策 |
|---|---|
| 是否使用 WASM 调用 libpag | 否；直接使用 TypeScript 实现最小 PAG 编码器 |
| 输出格式 | 仅二进制 `.pag` |
| 帧率 | UI 下拉仅支持 24/30/60，默认 30 |
| WebP | 默认开启；质量滑块默认 80；UI 线程使用 Canvas 编码 |
| `#solid` | 合格 Rectangle 编码为 `pag::SolidLayer`；失败中断并在 UI 提醒 |

## 需 Figma 插件实测

1. TRANSLATION/ROTATION/SCALE/OPACITY 的精确值域、单位、局部坐标和方向。
2. `node.animations` 中 style 的 offset/duration 是否已经完全展开到关键帧时间。
3. SET/OFFSET/SCALE 的数学语义、轨道顺序、同一字段多轨合成规则。
4. `timelineDuration`、`node.timelines[0].duration`、最后关键帧时间不一致时的含义。
5. 动画样式与手工轨冲突时的输出 tracks 顺序。
6. fills/strokes/effects 的实际 KeyframeValue 组合及 effect 列表重排行为。
7. 内置 easing preset 的实际 cubic/播放曲线，以及 Spring 是否有可采样求值接口。

## 需产品确认

1. 秒→帧碰撞时是保留最后点、提高 fps，还是阻止导出。
2. 遇到不支持属性时：阻止导出、保留首帧、还是生成序列帧。
3. MVP 是否接受“仅单 SET track”，这会排除部分 Animation Style。
4. 序列帧降级的尺寸、帧数、文件大小上限。
5. 支持的最低 PAG SDK/TagLevel，用于确定 TypeScript 编码 Tag 版本。
6. WebP 质量滑块的最小值、最大值和步长。
7. 关闭 WebP 后，图片统一编码 PNG，还是尽量保留 Figma 原始图片字节。
8. `#solid` 是否必须要求 `#solid` 后有空白分隔；当前规则按真正前缀处理，`#solidBox` 也会得到名称 `Box`。

## 需实现前源码确认

1. MVP 每个 Tag 的精确 flag、默认值、量化精度与版本号。
2. TypeScript 中 ID 分配与 Composition/Layer reference 安装规则。
3. Shape/Image 最小合法对象所需的必填属性。
4. `VerifyAndMake` 执行的全部必要约束，确保 TS 侧在编码前等价校验。

## Phase A 问题归类

| 问题 | 回答来源 | 当前状态 |
|---|---|---|
| Frame Timeline → Composition | typings + file.h + 产品 fps 决策 | 部分证实 |
| 节点树 → Layer/PreCompose/裁剪 | file.h + exporter | 模型已证实，策略待确认 |
| 秒 → Frame | typings + AE exporter + 产品决策 | round 有先例，冲突策略待确认 |
| 变换字段映射 | typings + Transform2D | 字段已证实，单位/坐标待实测 |
| Bezier/Spring/HOLD | typings + PAG keyframes | Hold/Bezier 已证实，Spring 待采样方案 |
| fills/strokes/effects | typings + file.h/filters | 白名单草案，需逐项实测 |
| Style 与 Manual 优先级 | Figma 实测 | 未回答 |

“禁止假设却已假设”的条目：无。未证实项均未作为事实写入映射。

## 依据与置信度

- Figma 未决项来自 `node_modules/@figma/plugin-typings/plugin-api.d.ts` 未定义的运行时语义，置信度：确认为 typings 无法回答，需实测。
- PAG 未决项来自 `libpag/include/pag/file.h` 与 `libpag/src/codec/`，置信度：对象模型已证实，逐 Tag 编码细节待实现前确认。
- 产品项没有源码真相源，置信度：明确待用户确认。
