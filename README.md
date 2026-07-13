# Figma Motion to PAG

Figma 插件：读取顶层 Frame 的静态图层与 Motion Transform，使用纯 TypeScript 生成二进制 `.pag`，不依赖 WASM。

## 开发

```bash
npm install
npm run build
```

在 Figma Desktop 中选择 **Plugins → Development → Import plugin from manifest…**，导入本目录的 `manifest.json`。

常用命令：

```bash
npm run watch
npm run verify
npm run pack
```

`npm run test:native` 会链接已构建的 `build_libpag/libpag.a`，使用 `PAGFile::Load()` 验证 TypeScript 生成的 PAG 文件。

## 当前支持

- 导出帧率：24 / 30 / 60 fps，默认 30。
- `#solid` Rectangle → PAG SolidLayer。
- Rectangle、Ellipse、单 Vector Path 的纯色 Fill/Stroke。
- Rectangle 单 IMAGE Paint；FIT/FILL，默认 UI Canvas 转 WebP，质量默认 80。
- Motion：Opacity、Translation、Rotation、Scale；单 SET track；Linear、Hold、Custom Cubic Bezier。

遇到不支持的图层、属性、轨道或缓动会中断导出，并在插件面板显示具体图层错误。
