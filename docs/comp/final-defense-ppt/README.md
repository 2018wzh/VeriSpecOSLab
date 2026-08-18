# VeriSpecOSLab 决赛 PPT

本目录包含从 `final-defense-blueprint.md` 生成的可编辑决赛演示文稿。

## 生成

脚本使用成熟的 `PptxGenJS`，参考仓库中的真实架构图，并结合 Portal 验收截图、终端关键帧和 H.264 演示视频，生成 18 页主讲页与 8 页答辩附录：

```sh
npm install --no-save pptxgenjs
node docs/comp/final-defense-ppt/build.cjs
```

若默认 PPT 正在 PowerPoint 中打开，可通过 `VOS_PPT_OUTPUT_NAME=VeriSpecOSLab-final-defense-ratio-fixed.pptx` 生成独立候选文件；环境变量只接受不含目录的安全 `.pptx` 文件名。

交付物：

- `VeriSpecOSLab-final-defense.pptx`：26 页可编辑演示文稿，含 18 页主讲与 8 页附录；
- `VeriSpecOSLab-final-defense.pdf`：与 PPT 同版的提交及打印版本；
- `preview/幻灯片*.PNG`：逐页预览，便于快速复核和选取截图；
- `preview/contact-*.png`：主讲页和附录的联系表。
- `image-layout-report.json`：记录每处图片的源比例和缩放策略，以及原生结构图的节点数和最小字号；所有图片必须保持统一缩放，复杂结构图必须通过可读性门槛。

P8、P9、P11、P12 内嵌真实视频；P10 使用原生图形解释 `vos verify` 的 Agent 测试生成与 Runner 裁决边界。导出 PDF 时，PowerPoint 会使用同一段视频的关键帧作为静态画面。所有本地路径仅在生成阶段解析，不写入页面正文。

PDF 和逐页 PNG 使用 Microsoft PowerPoint 的标准导出器生成，不由脚本伪造渲染结果。

终端关键帧与视频框保持 16:9，Portal 截图在白色画框内等比居中。原始 SVG 中信息密度较高的架构图、Spec 图、Agent 事务图和证据链不再缩进小画框，而是重建为可编辑的 PowerPoint 原生图形：主讲页最小字号不低于 11.5 pt，附录不低于 9.5 pt。若图片需要填满非等比画框，必须显式选择 `cover`，并在布局报告中留下裁剪记录。

## 素材来源

- `docs/comp/final-report/figures/*.svg`：原生结构图重建时使用的系统、Spec、Agent、证据链和课程历史参考；
- `docs/portal/visual-acceptance/*.png`：Portal 教师与学生工作台验收截图；
- `docs/comp/final-defense-media/frames/*.png`：四段真实演示的关键帧；
- `docs/comp/final-defense-media/videos/*.mp4`：P8、P9、P11、P12 使用的四段真实演示视频；
- `docs/comp/final-defense-blueprint.md`：讲稿、证据边界和引用口径。
