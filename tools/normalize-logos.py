#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""车队徽标归一化：裁掉透明留白 + 把「纯白字标」改成深色。

为什么需要这一步（都是实测出来的，不是猜的）：

1. TheSportsDB 的 strLogo 统一是 800x310 的画布，但**各家实际墨迹占比差得离谱** ——
   Williams 只有 48%x92%、Audi 93%x41%、Cadillac 100%x48%。渲染层用 object-fit:contain
   适配的是画布而不是墨迹，于是墨迹小的那几家在表格里显得又小又虚。

2. 更要命的是有 4 家的 strLogo 是**给深色底用的白色版**（不透明像素里亮像素占比）：
   aston_martin 100% / cadillac 100% / mercedes 100% / mclaren 88%。
   放在本项目的亮色卡片（白底）上就是「看不见」或「很虚」—— 这就是用户看到的
   「车队的图标显示效果不好」。

处置：
   - 一律裁到墨迹包围盒（此后图片高度 = 墨迹高度，26px 行高下各家视觉高度就一致了）；
   - **只对「亮像素 >80% 且平均亮度 >200」的徽标**把近白像素重映射成深色墨（保留 alpha）。
     判据卡得这么死是为了不误伤 Red Bull / Ferrari 这类「彩色主体 + 白色内嵌文字」的徽标
     —— 它们亮像素占比都不高（26% / 52%），内嵌白字必须保持白色。

原图备份到 assets/img/teams/_raw/，重跑不会二次处理（幂等）。

用法：
    python tools/normalize-logos.py            # 归一化（幂等）
    python tools/normalize-logos.py --report   # 只看现状，不写文件
"""

import os
import shutil
import sys

from PIL import Image

# Windows 控制台默认是 GBK，直接 print 中文/符号会 UnicodeEncodeError 把脚本打断。
# 强制 UTF-8 + errors='replace'：编码不出来的字符降级成 ?，绝不让输出把流程搞崩。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except (AttributeError, ValueError):
        pass

TEAM_DIR = os.path.join('assets', 'img', 'teams')
RAW_DIR = os.path.join(TEAM_DIR, '_raw')

# 判定「这是给深色底用的白色版徽标」的阈值
LIGHT_RATIO_MIN = 0.80
MEAN_LUM_MIN = 200.0
# 近白像素阈值：超过它就认为是「白字标」，重映射成深色
NEAR_WHITE_LUM = 180.0
INK = (21, 21, 30)  # #15151e，与顶栏同色


def stats(im):
    """返回 (不透明像素数, 平均亮度, 亮像素占比)。"""
    px = im.load()
    w, h = im.size
    total = 0
    lum_sum = 0.0
    light = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 40:
                continue
            lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
            total += 1
            lum_sum += lum
            if lum > 200:
                light += 1
    if not total:
        return 0, 0.0, 0.0
    return total, lum_sum / total, light / total


def darken_whites(im):
    """把近白像素重映射成深色墨，保留原 alpha（抗锯齿边缘因此仍然平滑）。"""
    px = im.load()
    w, h = im.size
    changed = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 40:
                continue
            if 0.2126 * r + 0.7152 * g + 0.0722 * b > NEAR_WHITE_LUM:
                px[x, y] = (INK[0], INK[1], INK[2], a)
                changed += 1
    return changed


def main():
    report_only = '--report' in sys.argv

    if not os.path.isdir(TEAM_DIR):
        print(f'找不到 {TEAM_DIR}')
        return 1

    names = sorted(f for f in os.listdir(TEAM_DIR) if f.lower().endswith('.png'))
    if not names:
        print(f'{TEAM_DIR} 下没有 PNG')
        return 1

    if not report_only:
        os.makedirs(RAW_DIR, exist_ok=True)

    print(f'{"文件":<20} {"画布":>10} {"墨迹":>10} {"亮像素":>7} {"处理":<28}')
    print('-' * 80)

    for name in names:
        path = os.path.join(TEAM_DIR, name)
        im = Image.open(path).convert('RGBA')
        total, mean_lum, light_ratio = stats(im)
        bbox = im.getchannel('A').getbbox()
        if bbox is None:
            print(f'{name:<20} {"全透明，跳过":<28}')
            continue

        ink_w, ink_h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        acts = []

        # 已经是裁过的（画布 = 墨迹）说明归一化过了，幂等跳过
        already_trimmed = im.size == (ink_w, ink_h)
        if not already_trimmed:
            acts.append('裁留白')
        if light_ratio > LIGHT_RATIO_MIN and mean_lum > MEAN_LUM_MIN:
            acts.append('白→深色')

        if report_only:
            print(f'{name:<20} {im.size[0]:>4}x{im.size[1]:<5} {ink_w:>4}x{ink_h:<5} '
                  f'{light_ratio:>6.0%} {" / ".join(acts) or "无需处理":<28}')
            continue

        if not acts:
            print(f'{name:<20} {im.size[0]:>4}x{im.size[1]:<5} {ink_w:>4}x{ink_h:<5} '
                  f'{light_ratio:>6.0%} {"无需处理":<28}')
            continue

        # 原图只在第一次归一化时备份
        backup = os.path.join(RAW_DIR, name)
        if not os.path.exists(backup):
            shutil.copy2(path, backup)

        out = im
        if light_ratio > LIGHT_RATIO_MIN and mean_lum > MEAN_LUM_MIN:
            darken_whites(out)
        if not already_trimmed:
            out = out.crop(bbox)

        out.save(path, 'PNG', optimize=True)
        print(f'{name:<20} {im.size[0]:>4}x{im.size[1]:<5} {ink_w:>4}x{ink_h:<5} '
              f'{light_ratio:>6.0%} {" / ".join(acts):<28}')

    print('-' * 80)

    if report_only:
        print('（--report 模式，未写入任何文件）')
        return 0

    # 收尾自检：归一化之后**不该再有**「亮像素占绝大多数」的徽标 ——
    # 有的话说明深色重映射没生效，亮色卡片上那家会看不见。
    bad = []
    for name in names:
        path = os.path.join(TEAM_DIR, name)
        im = Image.open(path).convert('RGBA')
        total, mean_lum, light_ratio = stats(im)
        if total and light_ratio > LIGHT_RATIO_MIN and mean_lum > MEAN_LUM_MIN:
            bad.append(f'{name}（亮像素 {light_ratio:.0%}，平均亮度 {mean_lum:.0f}）')

    print(f'原图备份在 {RAW_DIR}/')
    if bad:
        print('\n[FAIL] 自检未通过：以下徽标在亮色底上仍然看不清 ——')
        for b in bad:
            print(f'    {b}')
        return 1
    print(f'[OK] 自检通过：{len(names)} 个徽标全部已裁到墨迹，且无「白底白字」')
    return 0


if __name__ == '__main__':
    sys.exit(main())
