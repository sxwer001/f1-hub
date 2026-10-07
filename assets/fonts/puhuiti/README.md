# 阿里巴巴普惠体 · 来源与许可

本目录下的 4 个 `.otf` 是**阿里巴巴普惠体**（Alibaba PuHuiTi），用于本项目界面里的中文显示。

## 来源

- 官方发布：阿里巴巴设计在 UCAN 2019 设计大会上发布的免费商用字体
- 官方下载入口：<https://ics.alibaba.com/project/Hn8mXx>
- 本目录的文件经第三方镜像仓库 [liruifengv/alibaba-puhuiti](https://github.com/liruifengv/alibaba-puhuiti) 获取

## 许可

阿里巴巴普惠体**允许免费商用**（含个人与企业用途）。使用时请遵守阿里巴巴官方的字体使用条款，条款以官方发布页为准。

本项目只把字体文件**原样引用**（不做子集化之外的修改），并通过 `assets/css/tokens.css` 的 `unicode-range` 限定其只作用于 CJK 字符 —— 拉丁字形一律走同目录上层的 Titillium Web。

## 文件

| 文件 | 字重 |
|---|---|
| `PuHuiTi-Regular.otf` | 400 |
| `PuHuiTi-Medium.otf` | 500 |
| `PuHuiTi-Bold.otf` | 700 |
| `PuHuiTi-Heavy.otf` | 900 |

> **注意**：这套字体只有 400 / 500 / 700 / 900 四档。CSS 里写 `font-weight: 800` 会被浏览器静默抬到最近的 900（Heavy），中文看起来会比预期粗一档 —— 本项目全站已清除 `font-weight: 800`。
