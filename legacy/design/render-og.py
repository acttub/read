#!/usr/bin/env python3
"""공유 카드(og.jpg)를 만든다.

배경은 AI 생성물이 아니라 브랜드 그라데이션이다 — 이 도구는 그림이 필요 없고,
같은 가족(pick·stage)의 카드와 색을 맞추는 편이 피드에서 덜 튄다.
그라데이션 양 끝 색은 pick/og.jpg에서 실제로 뽑은 값이다.

    uv run --with pillow python design/render-og.py

⚠️ 문구를 바꾸면 index.html·input/index.html의 og:description·description도 같이 본다.
   공유 카드와 미리보기 설명이 다른 말을 하면 그게 더 어색하다.
⚠️ 저장만 약속한다. "아무 데도 안 나간다"고 쓰지 않는다(AGENTS.md 참고).
"""
import os
import pathlib

from PIL import Image, ImageDraw, ImageFont

HERE = pathlib.Path(__file__).parent
OUT = HERE.parent / "og.jpg"

# 카카오톡·페이스북·X가 공통으로 받아주는 크기다. 1.91:1.
W, H = 1200, 630
MARGIN = 88

# Pretendard 원본은 이 저장소에 두지 않는다(라이선스 원본을 재배포하지 않기 위해서다).
FONT_DIR = pathlib.Path(
    os.environ.get("PRETENDARD_DIR") or (HERE / ".." / ".." / ".." / "brand" / "fonts")
).expanduser()

# 대각선 그라데이션 양 끝. pick/og.jpg의 좌상단·우하단 실측값.
GRAD_FROM = (81, 211, 245)
GRAD_TO = (1, 97, 243)


def font(name, size):
    path = FONT_DIR / name
    if not path.is_file():
        raise SystemExit(f"폰트가 없다: {path}\nPRETENDARD_DIR로 원본 폴더를 지정한다.")
    return ImageFont.truetype(str(path), size)


# ── 문구 ──────────────────────────────────────────────────────────────
# 연기를 평가·판정하지 않는다. 읽어준다는 기능 설명까지만 쓴다.
BRAND = "acttub"
TITLE = "혼자 하는 대본 리딩"
SUB = "상대 대사는 소리로 읽어줘요"
BODY = ["대본을 붙여넣고 내 배역만 고르면 돼요.", "대본은 이 기기에만 저장돼요."]


def gradient():
    """대각선 그라데이션. 작은 이미지로 그리고 늘려서 밴딩을 줄인다."""
    small = Image.new("RGB", (W // 8, H // 8))
    px = small.load()
    for y in range(small.height):
        for x in range(small.width):
            t = (x / (small.width - 1) + y / (small.height - 1)) / 2
            px[x, y] = tuple(
                round(a + (b - a) * t) for a, b in zip(GRAD_FROM, GRAD_TO)
            )
    return small.resize((W, H), Image.BICUBIC)


def main():
    card = gradient()
    d = ImageDraw.Draw(card)
    white = (255, 255, 255)

    d.text((MARGIN, 148), BRAND, font=font("Pretendard-Bold.otf", 32), fill=white)
    d.text((MARGIN, 218), TITLE, font=font("Pretendard-Bold.otf", 76), fill=white)
    d.text((MARGIN, 336), SUB, font=font("Pretendard-SemiBold.otf", 36), fill=(233, 244, 255))

    body_font = font("Pretendard-Medium.otf", 29)
    y = 424
    for line in BODY:
        d.text((MARGIN, y), line, font=body_font, fill=(219, 236, 255))
        y += 44

    card.save(OUT, "JPEG", quality=88, optimize=True)
    print(f"{OUT} {card.size}")


if __name__ == "__main__":
    main()
