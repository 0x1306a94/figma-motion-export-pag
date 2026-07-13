# PAG 二进制模型与编码路径分析

> 范围：仅 `.pag`。不使用 PAGX。结论基于当前仓库中的 libpag 源码。

## 1. 结论摘要

PAG 的最小对象图是 `File → Composition → Layer → Property/Effect/LayerStyle`。主合成应使用 `VectorComposition`，每个有效 Layer 必须拥有 `transform` 或 `transform3D`，本项目 MVP 只需 `Transform2D`。

TypeScript 实现不使用 WASM，因而需要直接复刻 `libpag/src/codec/` 的最小二进制写入规则。应只编码实际支持的 Tag 和属性，不移植整个 libpag。

## 2. 数据模型

| 模型 | 关键字段/约束 | 依据 | 置信度 |
|---|---|---|---|
| `Composition` | `width`、`height`、`duration: Frame`、`frameRate`、背景色 | `libpag/include/pag/file.h` | 已证实 |
| `VectorComposition` | 继承 Composition，持有有序 `layers` | `libpag/include/pag/file.h` | 已证实 |
| `Layer` | `parent`、`startTime`、`duration`、`transform`、mask/effect/style；duration 必须大于 0 | `libpag/include/pag/file.h`、`libpag/src/base/Layer.cpp` | 已证实 |
| `PreComposeLayer` | 通过 `composition` 引用子合成；`compositionStartTime` 指定内容偏移 | `libpag/include/pag/file.h` | 已证实 |
| `SolidLayer` | `solidColor`、`width`、`height`；verify 要求宽高大于 0 | `libpag/include/pag/file.h`、`libpag/src/base/SolidLayer.cpp` | 已证实 |
| `Transform2D` | anchorPoint、position 或拆分 x/y、scale、rotation、opacity 均为 Property | `libpag/include/pag/file.h` | 已证实 |
| `Property<T>` | 静态值 | `libpag/include/pag/file.h` | 已证实 |
| `AnimatableProperty<T>` | 有序 `Keyframe<T>[]`，按 frame 求值 | `libpag/include/pag/file.h` | 已证实 |
| `Keyframe<T>` | 区间 `[startTime,endTime)`，含首尾值、插值类型、时间 Bezier、空间切线 | `libpag/include/pag/file.h` | 已证实 |

PAG 基础单位：`Frame=int64`，`Opacity=uint8 [0,255]`，`Percent=float [0,1]`。依据：`libpag/include/pag/types.h`。

## 3. 关键帧语义

PAG 关键帧不是单个“时间点”，而是相邻输入关键帧组成的区间。N 个输入点生成 N-1 个 PAG Keyframe：

```text
输入点 (t0,v0), (t1,v1), (t2,v2)
→ Keyframe { startTime:t0, endTime:t1, startValue:v0, endValue:v1 }
→ Keyframe { startTime:t1, endTime:t2, startValue:v1, endValue:v2 }
```

| 插值 | PAG 表达 | 依据 | 置信度 |
|---|---|---|---|
| Hold | `KeyframeInterpolationType::Hold` | `file.h`、`StreamProperty.h` | 已证实 |
| Linear | `Linear` | 同上 | 已证实 |
| Cubic Bezier | `Bezier` + 每维 `bezierOut/bezierIn` | `StreamProperty.h`、`AttributeHelper.h` | 已证实 |
| 多维非空间属性 | 每个维度可有独立时间曲线 | `MultiDimensionPointKeyframe.cpp` | 已证实 |
| 空间位置 | 一条时间曲线 + `spatialOut/spatialIn` 路径切线 | `SpatialPointKeyframe.cpp` | 已证实 |

Figma Motion 只暴露时间 easing，未暴露空间路径切线。因此位置动画初期应使用非空间线性路径，不能虚构空间曲线。

## 4. AE 导出器可复用的模式

AE 导出流程：

```text
PAGExport::exportAsFile
→ ExportComposition
→ ExportLayers / ExportLayer
→ GetTransform2D / GetShapes / GetEffects / GetLayerStyles
→ Codec::InstallReferences
→ Codec::VerifyAndMake
→ Codec::Encode
→ File::Load 回读验证
```

依据：

- `libpag/exporter/src/export/PAGExport.cpp`
- `libpag/exporter/src/export/ExportComposition.cpp`
- `libpag/exporter/src/export/ExportLayer.cpp`
- `libpag/exporter/src/export/data/Transform2D.cpp`
- `libpag/exporter/src/export/stream/StreamProperty.h`

AE 的 `AEDurationToFrame()` 使用 `round(seconds * frameRate)`，可作为 Figma 秒到帧的先例，但碰撞规则仍需本项目定义。置信度：已证实。

## 5. 二进制编码路径

`Codec::Encode` 写入 `PAG` 魔数、版本、body 长度、压缩方式，再写 Tag 流。文件内依次包含资源、Composition、Layer；每层再写 Transform/Shape/Effect 等 Tag。

Property 编码顺序由 `libpag/src/codec/AttributeHelper.h` 证实：

1. 写属性 flag：是否存在、是否可动画、是否有空间数据。
2. 动画属性写关键帧数量和每段 2-bit 插值类型。
3. 写起始时间、各段结束时间、首值和各段结束值。
4. 仅 Bezier 段写时间控制点。
5. 仅空间属性存在切线时写空间控制数据。

TypeScript 最小编码器还必须对照：

- `libpag/src/codec/Codec.cpp`
- `libpag/src/codec/tags/FileTags.cpp`
- `libpag/src/codec/tags/VectorCompositionTag.cpp`
- `libpag/src/codec/tags/LayerTag.cpp`
- 各 MVP Tag 的 config 文件

置信度：编码总体路径已证实；精确 bit layout 必须在实现前逐 Tag 再核对。

### SolidLayer 编码

二进制对象图应创建 `pag::SolidLayer`，写入 `solidColor`、`width`、`height` 和通用 Layer/Transform Tag；`PAGSolidLayer` 是 PAG SDK 加载后的运行时包装类型，不是文件模型中的编码对象。

`libpag/src/codec/tags/SolidColor.cpp` 的 `SolidColor` Tag 依次写颜色、宽度、高度。`libpag/src/base/SolidLayer.cpp` 证实宽高必须大于 0。置信度：已证实。

### WebP 图片资源

`ImageBytes.fileBytes` 保存完整编码图片字节，PAG 图像解码链支持 WebP。AE exporter 的 `EncodeImageData()` 也使用 `WebPEncodeRGBA()`，证明 WebP 可作为 `.pag` 内的图片资源。

本项目不使用 C++/WASM，因此 WebP 编码改在插件 UI 线程通过 Canvas 完成，再将 WebP `ArrayBuffer` 传回主线程写入 `ImageBytes.fileBytes`。Figma typings 的 `ExportSettingsImage.format` 只有 JPG/PNG，不能直接要求 `exportAsync()` 输出 WebP。依据：

- `libpag/include/pag/file.h` 的 `ImageBytes`
- `libpag/exporter/src/utils/ImageData.cpp`
- `libpag/third_party/tgfx/src/core/codecs/webp/WebpCodec.cpp`
- `node_modules/@figma/plugin-typings/plugin-api.d.ts` 的 `ExportSettingsImage`

置信度：PAG WebP 支持已证实；UI Canvas 编码的浏览器兼容性与透明通道需实测。

## 6. Effect 与 LayerStyle 能力边界

PAG Effect 类型：MotionTile、LevelsIndividual、CornerPin、Bulge、FastBlur、Glow、DisplacementMap、RadialBlur、Mosaic、BrightnessContrast、HueSaturation。依据：`file.h`。

PAG LayerStyle 类型：DropShadow、Stroke、GradientOverlay、OuterGlow。依据：`file.h`。渲染实现见 `libpag/src/rendering/filters/` 与其 `layerstyle/` 子目录。

AE exporter 能写入上述效果不代表 Figma 同名效果可直接映射；参数、采样区域和合成顺序必须逐项相同才可声称无损。

## 7. 假设与风险

“禁止假设却已假设”的条目：无。本文未假设 Figma 与 PAG 的坐标、旋转、锚点或效果参数相同；这些均留待实测。

待实测/实现验证：

- TypeScript 编码字节是否可被 `PAGFile::Load()` 加载。
- Tag 版本选择是否覆盖目标 PAG SDK 最低版本。
- 同一 frame 上的关键帧合并后是否仍满足 codec 校验。
