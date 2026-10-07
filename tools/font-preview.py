# -*- coding: utf-8 -*-
"""
font-preview.py —— 校验中文字体的字形覆盖，并生成一张用于比对风格的预览图。

用法：python tools/font-preview.py
输出：dist/font-preview.png 与覆盖率报告
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
FONT_DIR = os.path.join(ROOT, "assets", "fonts", "puhuiti")
OUT = os.path.join(ROOT, "dist", "font-preview.png")

WEIGHTS = [
    ("Heavy", "PuHuiTi-Heavy.otf"),
    ("Bold", "PuHuiTi-Bold.otf"),
    ("Medium", "PuHuiTi-Medium.otf"),
    ("Regular", "PuHuiTi-Regular.otf"),
]

# 取自应用里真实出现的中文串
CORPUS = [
    "世界一级方程式锦标赛 赛历 积分榜 成绩 分站",
    "下一站 本赛季已完成 后续分站 周末时间表 上一站成绩 最新动态 提醒与设置",
    "新加坡大奖赛 滨海湾街道赛道 冲刺周末 常规周末 正赛 排位赛 冲刺排位赛",
    "第一节练习 第二节练习 第三节练习 已结束 进行中 还有 天 时 分 秒",
    "车手积分榜 安东内利 拉塞尔 汉密尔顿 勒克莱尔 诺里斯 维斯塔潘 皮亚斯特里",
    "梅赛德斯 法拉利 迈凯伦 红牛 威廉姆斯 阿斯顿马丁 凯迪拉克 奥迪 哈斯",
    "赛前提醒 提前量 跟随系统 亮色 深色 测试通知 关于 刷新数据 关注 取消关注",
    "圈数 发车 变化 时间状态 停站 最快停站 人均进站 总进站次数 赛道信息 纬度 经度",
]

BG = (21, 21, 30)
FG = (255, 255, 255)
DIM = (170, 170, 173)
RED = (225, 6, 0)


def load(name):
    path = os.path.join(FONT_DIR, name)
    return ImageFont.truetype(path, 40) if os.path.exists(path) else None


def mask_of(font, ch, size=40):
    img = Image.new("L", (size * 2, size * 2), 0)
    ImageDraw.Draw(img).text((size // 2, size // 2), ch, font=font, fill=255)
    return img.tobytes()


def coverage(font):
    """把每个字与「私用区必然缺字」的 .notdef 位图比对，判断是否缺字形"""
    notdef = mask_of(font, "\ue000")
    missing = []
    seen = set()
    for line in CORPUS:
        for ch in line:
            if ch in seen or ch == " ":
                continue
            seen.add(ch)
            if mask_of(font, ch) == notdef:
                missing.append(ch)
    return len(seen), missing


def main():
    fonts = []
    for label, filename in WEIGHTS:
        font = load(filename)
        if font is None:
            print(f"  跳过 {filename}（不存在）")
            continue
        total, missing = coverage(font)
        status = "全覆盖" if not missing else f"缺 {len(missing)} 字：{''.join(missing)}"
        print(f"  {label:<8} 校验 {total} 个汉字 → {status}")
        fonts.append((label, font))

    if not fonts:
        raise SystemExit("没有可用字体")

    W, H = 1500, 980
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.rectangle([0, 0, W, 6], fill=RED)
    title_font = ImageFont.truetype(os.path.join(FONT_DIR, WEIGHTS[0][1]), 46)
    d.text((48, 40), "阿里巴巴普惠体 · 风格核对", font=title_font, fill=FG)
    d.text((48, 104), "PUDHUITI / ALIBABA  —  与 F1 海报中文（厚重·方正·端点平切）比对", font=ImageFont.truetype(os.path.join(FONT_DIR, WEIGHTS[3][1]), 18), fill=DIM)

    y = 168
    for label, font in fonts:
        d.text((48, y + 10), label.upper(), font=ImageFont.truetype(os.path.join(FONT_DIR, WEIGHTS[3][1]), 16), fill=RED)
        d.text((160, y), "世界一级方程式锦标赛 赛历", font=ImageFont.truetype(os.path.join(FONT_DIR, WEIGHTS[0][1]), 42), fill=FG)
        y += 66
        d.text((160, y), "车手积分榜  安东内利  维斯塔潘  汉密尔顿", font=font, fill=FG)
        y += 58
        d.text((160, y), "下一站 · 新加坡大奖赛 · 滨海湾街道赛道", font=font, fill=DIM)
        y += 62
        d.line([48, y, W - 48, y], fill=(60, 60, 68), width=1)
        y += 18

    d.text((48, H - 44), "生成自 tools/font-preview.py", font=ImageFont.truetype(os.path.join(FONT_DIR, WEIGHTS[3][1]), 15), fill=(110, 110, 118))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT)
    print(f"  预览图 → {os.path.abspath(OUT)}")


if __name__ == "__main__":
    main()
