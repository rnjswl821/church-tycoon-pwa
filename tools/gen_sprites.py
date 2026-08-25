"""
픽셀아트 스프라이트 생성기 — 순수 절차적 드로잉(외부 이미지·폰트 미사용, 라이선스 이슈 없음).
캔버스를 작게(네이티브 픽셀 해상도) 그린 뒤 그대로 PNG로 저장한다. 브라우저에서는
image-rendering: pixelated 로 확대 표시해 또렷한 픽셀아트 느낌을 유지한다.
"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "assets")
os.makedirs(OUT, exist_ok=True)

def img(w, h):
    return Image.new("RGBA", (w, h), (0, 0, 0, 0))

def save(im, name):
    im.save(os.path.join(OUT, name))
    print("saved", name, im.size)

def outline_rect(d, x0, y0, x1, y1, fill, edge, ew=1):
    d.rectangle([x0, y0, x1, y1], fill=fill)
    d.rectangle([x0, y0, x1, y1], outline=edge, width=ew)

# ---------------------------------------------------------------- palette
INK      = (58, 42, 34, 255)     # soft dark brown outline
WALL     = (247, 236, 214, 255)
WALL_SH  = (223, 205, 172, 255)
WOOD     = (150, 102, 61, 255)
WOOD_SH  = (117, 78, 45, 255)
ROOF     = (196, 84, 58, 255)
ROOF_SH  = (156, 62, 41, 255)
ROOF2    = (110, 128, 150, 255)   # slate roof (higher levels)
ROOF2_SH = (84, 100, 120, 255)
WIN      = (129, 196, 219, 255)
WIN_SH   = (92, 156, 181, 255)
WIN_WARM = (255, 224, 150, 255)
GOLD     = (231, 180, 82, 255)
CROSS    = (253, 250, 240, 255)
DOOR     = (108, 68, 40, 255)
DOOR_SH  = (80, 48, 27, 255)
GLASS_R  = (214, 92, 92, 255)
GLASS_B  = (99, 142, 214, 255)
GLASS_Y  = (232, 196, 92, 255)
GLASS_G  = (118, 179, 120, 255)

def sanctuary(level):
    # bottom-up explicit layout so nothing gets clipped off the top of canvas
    body_w  = [20, 24, 28, 28, 30, 32][level]
    body_h  = [14, 16, 17, 19, 20, 21][level]
    roof_h  = [10, 11, 12, 13, 14, 15][level]
    tower_h = [0, 0, 10, 12, 13, 15][level]
    spire_h = [0, 0, 6, 7, 8, 9][level]
    cross_h = [5, 5, 6, 6, 7, 7][level]
    wing_w  = [0, 0, 0, 10, 11, 12][level]
    wing_h  = [0, 0, 0, 11, 12, 13][level]
    margin_x, margin_top, margin_bot = 6, 3, 2

    total_wing = wing_w * (1 if level == 3 else (2 if level >= 4 else 0))
    W = body_w + total_wing + margin_x * 2
    H = margin_top + cross_h + spire_h + tower_h + roof_h + body_h + margin_bot
    im = img(W, H)
    d = ImageDraw.Draw(im)

    ground = H - margin_bot
    cx = W // 2
    body_x0 = cx - body_w // 2
    body_x1 = body_x0 + body_w
    body_top = ground - body_h

    roof_color = ROOF if level < 4 else ROOF2
    roof_shadow = ROOF_SH if level < 4 else ROOF2_SH

    # side wings (single-slope lean-to), drawn behind main body
    def draw_wing(wx0, wx1, roof_dir):
        wtop = ground - wing_h
        outline_rect(d, wx0, wtop + 3, wx1, ground, WALL, INK)
        if roof_dir == "left":
            d.polygon([(wx0 - 1, wtop + 3), (wx1, wtop - 2), (wx1, wtop + 3)], fill=roof_color, outline=INK)
        else:
            d.polygon([(wx1 + 1, wtop + 3), (wx0, wtop - 2), (wx0, wtop + 3)], fill=roof_color, outline=INK)

    if level == 3:
        draw_wing(body_x0 - wing_w, body_x0, "left")
    if level >= 4:
        draw_wing(body_x0 - wing_w, body_x0, "left")
        draw_wing(body_x1, body_x1 + wing_w, "right")

    # main body
    outline_rect(d, body_x0, body_top, body_x1, ground, WALL, INK)
    d.line([(body_x0 + 1, ground - 1), (body_x1 - 1, ground - 1)], fill=WALL_SH)

    # gable roof — pixel stairstep triangle
    roof_peak_y = body_top - roof_h
    half = (body_x1 - body_x0) / 2 + 2
    steps = max(4, body_w // 4)
    for i in range(steps + 1):
        t = i / steps
        y = round(body_top - t * (body_top - roof_peak_y))
        xw = round(half * (1 - t))
        d.line([(cx - xw, y), (cx + xw, y)], fill=roof_color)
    d.line([(cx, roof_peak_y), (body_x0 - 2, body_top)], fill=INK)
    d.line([(cx, roof_peak_y), (body_x1 + 2, body_top)], fill=INK)
    d.line([(cx, roof_peak_y), (cx + 3, body_top)], fill=roof_shadow)

    # steeple / bell tower
    if tower_h > 0:
        tw = max(6, body_w // 4)
        tx0, tx1 = cx - tw // 2, cx + tw // 2
        tower_top = roof_peak_y - tower_h
        outline_rect(d, tx0, tower_top, tx1, roof_peak_y + 2, WALL, INK)
        bw = max(2, tw - 4)
        d.rectangle([cx - bw // 2, tower_top + 3, cx + bw // 2, tower_top + 3 + bw], fill=INK)
        spire_top = tower_top - spire_h
        d.polygon([(tx0 - 1, tower_top + 1), (cx, spire_top), (tx1 + 1, tower_top + 1)], fill=roof_color, outline=INK)
        stack_top = spire_top
    else:
        stack_top = roof_peak_y
        d.line([(cx, roof_peak_y), (cx, roof_peak_y - 4)], fill=WOOD)
        stack_top = roof_peak_y - 4

    # cross on top
    cross_top = stack_top - cross_h
    d.line([(cx, cross_top), (cx, cross_top + cross_h)], fill=CROSS, width=2)
    bar_y = cross_top + max(1, cross_h // 3)
    d.line([(cx - 2, bar_y), (cx + 2, bar_y)], fill=CROSS, width=2)

    # door (height relative to body_h, not total canvas H)
    door_h = max(6, int(body_h * 0.55))
    door_w = max(4, body_w // 5)
    d.rectangle([cx - door_w // 2, ground - door_h, cx + door_w // 2, ground], fill=DOOR)
    d.rectangle([cx - door_w // 2, ground - door_h, cx + door_w // 2, ground], outline=DOOR_SH)
    if level >= 2:
        d.rectangle([cx - door_w // 2 - 3, ground - door_h, cx - door_w // 2 - 1, ground], fill=DOOR)
        d.rectangle([cx + door_w // 2 + 1, ground - door_h, cx + door_w // 2 + 3, ground], fill=DOOR)

    # windows, plus a rosette above the door for the grandest levels
    win_c = WIN_WARM if level >= 5 else WIN
    win_sh = GOLD if level >= 5 else WIN_SH
    nwin = min(4, level + 1)
    win_y = body_top + int(body_h * 0.20)
    win_size = max(3, body_w // 10)
    span = body_x1 - body_x0
    gap = span / (nwin + 1)
    for i in range(nwin):
        wx = int(body_x0 + gap * (i + 1))
        if level >= 4 and abs(wx - cx) < win_size:
            continue
        d.rectangle([wx - win_size // 2, win_y, wx + win_size // 2, win_y + win_size], fill=win_c, outline=INK)
        d.line([(wx, win_y), (wx, win_y + win_size)], fill=win_sh)
    if level >= 4:
        r = max(3, int(body_w * 0.11))
        ry = body_top + int(body_h * 0.12)
        d.ellipse([cx - r, ry, cx + r, ry + 2 * r], fill=win_sh, outline=INK)
        d.ellipse([cx - r + 1, ry + 1, cx + r - 1, ry + 2 * r - 1], fill=win_c)
        d.line([(cx - r, ry + r), (cx + r, ry + r)], fill=win_sh)
        d.line([(cx, ry), (cx, ry + 2 * r)], fill=win_sh)

    return im

# ---------------------------------------------------------------- education
EDU_WALL   = (255, 244, 219, 255)
EDU_WALLSH = (232, 217, 182, 255)
EDU_ROOF   = (99, 148, 111, 255)
EDU_ROOFSH = (73, 116, 85, 255)
BOOK_RED   = (196, 84, 66, 255)
BOOK_BLUE  = (86, 120, 168, 255)

def education(level):
    body_w = [16, 20, 24, 26, 28][level]
    body_h = [12, 14, 15, 16, 18][level]
    roof_h = [7, 8, 9, 9, 10][level]
    flag_h = [0, 0, 8, 9, 10][level]
    margin_x, margin_top, margin_bot = 4, 3, 2
    W = body_w + margin_x * 2
    H = margin_top + flag_h + roof_h + body_h + margin_bot
    im = img(W, H)
    d = ImageDraw.Draw(im)

    ground = H - margin_bot
    cx = W // 2
    x0, x1 = cx - body_w // 2, cx + body_w // 2
    body_top = ground - body_h

    outline_rect(d, x0, body_top, x1, ground, EDU_WALL, INK)
    d.line([(x0 + 1, ground - 1), (x1 - 1, ground - 1)], fill=EDU_WALLSH)

    peak_y = body_top - roof_h
    half = (x1 - x0) / 2 + 2
    steps = max(3, body_w // 4)
    for i in range(steps + 1):
        t = i / steps
        y = round(body_top - t * (body_top - peak_y))
        xw = round(half * (1 - t))
        d.line([(cx - xw, y), (cx + xw, y)], fill=EDU_ROOF)
    d.line([(cx, peak_y), (x0 - 2, body_top)], fill=INK)
    d.line([(cx, peak_y), (x1 + 2, body_top)], fill=INK)
    d.line([(cx, peak_y), (cx + 2, body_top)], fill=EDU_ROOFSH)

    if flag_h > 0:
        pole_x = x1 - 3
        d.line([(pole_x, peak_y), (pole_x, peak_y - flag_h)], fill=WOOD)
        d.polygon([(pole_x, peak_y - flag_h), (pole_x + 6, peak_y - flag_h + 3), (pole_x, peak_y - flag_h + 5)], fill=BOOK_RED, outline=INK)

    door_h = max(5, int(body_h * 0.55))
    door_w = max(3, body_w // 5)
    d.rectangle([cx - door_w // 2, ground - door_h, cx + door_w // 2, ground], fill=DOOR, outline=DOOR_SH)

    nwin = min(3, level + 1)
    win_y = body_top + int(body_h * 0.20)
    win_size = max(3, body_w // 9)
    span = x1 - x0
    gap = span / (nwin + 1)
    for i in range(nwin):
        wx = int(x0 + gap * (i + 1))
        if abs(wx - cx) < door_w // 2 + 1:
            continue
        d.rectangle([wx - win_size // 2, win_y, wx + win_size // 2, win_y + win_size], fill=WIN, outline=INK)
        d.line([(wx, win_y), (wx, win_y + win_size)], fill=WIN_SH)

    if level >= 1:
        # small book sign above the door
        bw = max(4, door_w + 2)
        by = ground - door_h - 5
        d.rectangle([cx - bw // 2, by, cx + bw // 2, by + 3], fill=BOOK_BLUE, outline=INK)
        d.line([(cx, by), (cx, by + 3)], fill=INK)

    return im

# ---------------------------------------------------------------- fellowship
FEL_WALL   = (250, 232, 214, 255)
FEL_WALLSH = (226, 202, 178, 255)
AWN_A      = (214, 122, 84, 255)
AWN_B      = (240, 228, 210, 255)
CUP        = (196, 84, 58, 255)
STEAM      = (240, 240, 240, 255)

def fellowship(level):
    body_w = [16, 20, 23, 26, 28][level]
    body_h = [10, 12, 13, 14, 15][level]
    awn_h  = [5, 6, 6, 7, 7][level]
    sign_h = 7
    margin_x, margin_top, margin_bot = 6, 3, 3
    W = body_w + margin_x * 2
    H = margin_top + sign_h + awn_h + body_h + margin_bot
    im = img(W, H)
    d = ImageDraw.Draw(im)

    ground = H - margin_bot
    cx = W // 2
    x0, x1 = cx - body_w // 2, cx + body_w // 2
    body_top = ground - body_h

    outline_rect(d, x0, body_top, x1, ground, FEL_WALL, INK)
    d.line([(x0 + 1, ground - 1), (x1 - 1, ground - 1)], fill=FEL_WALLSH)

    # flat roof line
    d.rectangle([x0 - 2, body_top - 2, x1 + 2, body_top], fill=WOOD_SH, outline=INK)

    # striped awning
    awn_top = body_top - 2 - awn_h
    stripes = max(3, body_w // 5)
    sw = (x1 - x0 + 4) / stripes
    for i in range(stripes):
        sx0 = x0 - 2 + i * sw
        color = AWN_A if i % 2 == 0 else AWN_B
        d.polygon([(sx0, awn_top), (sx0 + sw, awn_top), (sx0 + sw - 2, body_top - 2), (sx0 + 2, body_top - 2)], fill=color, outline=INK)

    door_h = max(5, int(body_h * 0.6))
    door_w = max(3, body_w // 5)
    d.rectangle([cx - door_w // 2, ground - door_h, cx + door_w // 2, ground], fill=DOOR, outline=DOOR_SH)

    nwin = min(2, max(1, level))
    win_y = body_top + int(body_h * 0.25)
    win_size = max(3, body_w // 9)
    for i in range(nwin):
        wx = x0 + int(body_w * 0.22) if i == 0 else x1 - int(body_w * 0.22)
        d.rectangle([wx - win_size // 2, win_y, wx + win_size // 2, win_y + win_size], fill=WIN_WARM, outline=INK)
        d.line([(wx, win_y), (wx, win_y + win_size)], fill=GOLD)

    # cup sign
    cw = 7
    cyx0, cyy0 = cx - cw // 2, awn_top - sign_h + 1
    d.rectangle([cyx0, cyy0 + 2, cyx0 + cw - 2, cyy0 + sign_h - 1], fill=CUP, outline=INK)
    d.rectangle([cyx0 + cw - 2, cyy0 + 3, cyx0 + cw, cyy0 + sign_h - 3], outline=INK)
    if level >= 2:
        d.point([(cx - 1, cyy0 - 1), (cx, cyy0 - 2), (cx + 1, cyy0 - 1)], fill=STEAM)

    # outdoor tables at higher levels
    if level >= 3:
        for tx in (x0 - 5, x1 + 2):
            d.rectangle([tx, ground - 4, tx + 4, ground - 3], fill=WOOD)
            d.line([(tx + 1, ground - 3), (tx + 1, ground)], fill=WOOD_SH)
            d.line([(tx + 3, ground - 3), (tx + 3, ground)], fill=WOOD_SH)

    return im

# ---------------------------------------------------------------- parking
LOT_DIRT  = (196, 175, 138, 255)
LOT_DIRTSH= (172, 150, 112, 255)
LOT_PAVE  = (156, 160, 168, 255)
LOT_LINE  = (240, 240, 230, 255)
CAR_COLORS = [(196, 92, 92, 255), (92, 130, 196, 255), (120, 168, 120, 255), (222, 178, 92, 255)]

def parking(level):
    W, H = 44, 20
    im = img(W, H)
    d = ImageDraw.Draw(im)
    if level == 0:
        d.rectangle([2, 4, W - 3, H - 3], fill=LOT_DIRT, outline=INK)
        for i in range(6):
            x = 6 + i * 6
            d.point([(x, 8), (x + 2, 12), (x - 1, 15)], fill=LOT_DIRTSH)
        return im

    d.rectangle([2, 4, W - 3, H - 3], fill=LOT_PAVE, outline=INK)
    d.line([(2, 5), (W - 3, 5)], fill=(180, 184, 190, 255))
    nslots = min(4, level + 1)
    slot_w = (W - 8) / nslots
    for i in range(1, nslots):
        x = 4 + slot_w * i
        d.line([(x, 6), (x, H - 5)], fill=LOT_LINE)

    ncars = min(len(CAR_COLORS), level)
    for i in range(ncars):
        cxp = int(4 + slot_w * i + slot_w / 2)
        color = CAR_COLORS[i % len(CAR_COLORS)]
        cw = max(6, int(slot_w) - 4)
        cx0 = cxp - cw // 2
        d.rectangle([cx0, 9, cx0 + cw, 15], fill=color, outline=INK)
        d.rectangle([cx0 + 2, 7, cx0 + cw - 2, 10], fill=color, outline=INK)
        d.point([(cx0 + 1, 15), (cx0 + cw - 1, 15)], fill=INK)
    return im

def visiting_car(color_idx=0):
    """위에서 본 정면(진입) 방향 자동차 — 경내 진입로를 오가는 방문 차량용."""
    W, H = 14, 20
    im = img(W, H)
    d = ImageDraw.Draw(im)
    color = CAR_COLORS[color_idx % len(CAR_COLORS)]
    d.rounded_rectangle([1, 2, W - 2, H - 3], radius=3, fill=color, outline=INK)
    d.rectangle([3, 4, W - 4, 9], fill=(196, 224, 234, 255))
    d.line([(3, 6), (W - 4, 6)], fill=(150, 190, 205, 255))
    d.rectangle([1, 4, 3, 6], fill=INK)
    d.rectangle([W - 4, 4, W - 2, 6], fill=INK)
    d.rectangle([1, H - 6, 3, H - 4], fill=INK)
    d.rectangle([W - 4, H - 6, W - 2, H - 4], fill=INK)
    d.rectangle([5, H - 5, W - 6, H - 4], fill=(255, 232, 150, 255))
    return im

# ---------------------------------------------------------------- ground / decor
GRASS_A = (139, 196, 107, 255)
GRASS_B = (124, 184, 92, 255)
PATH_A  = (217, 198, 163, 255)
PATH_B  = (199, 174, 130, 255)

def grass_tile(variant=0):
    S = 16
    im = img(S, S)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, S - 1, S - 1], fill=GRASS_A)
    dots = [(2, 3), (9, 2), (5, 8), (12, 10), (2, 13), (13, 5)] if variant == 0 else [(4, 1), (11, 6), (1, 9), (8, 12), (14, 14)]
    for (x, y) in dots:
        d.point([(x, y)], fill=GRASS_B)
    return im

def path_tile():
    S = 16
    im = img(S, S)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, S - 1, S - 1], fill=PATH_A)
    for (x, y) in [(2, 2), (10, 4), (5, 9), (13, 12), (3, 13), (8, 6)]:
        d.point([(x, y)], fill=PATH_B)
    return im

TREE_LEAF = (94, 156, 90, 255)
TREE_LEAF_SH = (72, 130, 70, 255)
TREE_TRUNK = (120, 82, 50, 255)

def tree(variant=0):
    W, H = 14, 20
    im = img(W, H)
    d = ImageDraw.Draw(im)
    d.rectangle([W // 2 - 1, H - 6, W // 2 + 1, H - 1], fill=TREE_TRUNK, outline=INK)
    cy = H - 8 if variant == 0 else H - 7
    r = 6 if variant == 0 else 5
    d.ellipse([W // 2 - r, cy - r, W // 2 + r, cy + r], fill=TREE_LEAF, outline=INK)
    d.ellipse([W // 2 - r + 2, cy - r + 3, W // 2 + 1, cy + 1], fill=TREE_LEAF_SH)
    return im

def bush():
    W, H = 12, 8
    im = img(W, H)
    d = ImageDraw.Draw(im)
    d.ellipse([0, 1, W - 1, H - 1], fill=TREE_LEAF, outline=INK)
    d.ellipse([1, 3, 6, H - 1], fill=TREE_LEAF_SH)
    return im

def fence_tile():
    """캠퍼스 경계 낮은 목재 울타리 — 부지 테두리에 둘러 '경내' 느낌을 준다"""
    W, H = 16, 10
    im = img(W, H)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 4, W - 1, 5], fill=WOOD, outline=INK)
    for px in (1, 7, 13):
        d.rectangle([px, 1, px + 1, 8], fill=WOOD_SH, outline=INK)
    return im

FLOWER_COLORS = [(224, 122, 149, 255), (231, 180, 82, 255), (129, 178, 154, 255), (214, 92, 92, 255)]

def flower_bed():
    """화단 — 예배당·건물 입구를 장식하는 작은 꽃밭"""
    W, H = 16, 8
    im = img(W, H)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 3, W - 1, H - 1], fill=(107, 79, 51, 255), outline=INK)
    d.rectangle([0, 2, W - 1, 3], fill=(94, 156, 90, 255))
    spots = [(2, 1), (5, 0), (8, 1), (11, 0), (14, 1), (3, 2), (9, 2), (13, 2)]
    for i, (x, y) in enumerate(spots):
        d.point([(x, y)], fill=FLOWER_COLORS[i % len(FLOWER_COLORS)])
    return im

# ---------------------------------------------------------------- people
SKIN_TONES = [(244, 201, 155, 255), (224, 172, 124, 255), (166, 116, 78, 255), (240, 214, 180, 255)]
SHIRTS = [(224, 122, 95, 255), (61, 90, 128, 255), (129, 178, 154, 255), (242, 204, 143, 255), (155, 93, 229, 255), (239, 71, 111, 255), (110, 110, 120, 255), (94, 156, 90, 255)]
HAIR = [(58, 42, 34, 255), (90, 60, 40, 255), (30, 30, 30, 255), (150, 110, 70, 255), (200, 200, 200, 255)]

def person(idx):
    W, H = 10, 16
    im = img(W, H)
    d = ImageDraw.Draw(im)
    skin = SKIN_TONES[idx % len(SKIN_TONES)]
    shirt = SHIRTS[idx % len(SHIRTS)]
    hair = HAIR[idx % len(HAIR)]
    cx = W // 2
    # legs
    d.rectangle([cx - 2, H - 4, cx - 1, H - 1], fill=(70, 70, 80, 255))
    d.rectangle([cx, H - 4, cx + 1, H - 1], fill=(58, 58, 68, 255))
    # body
    d.rectangle([cx - 3, H - 10, cx + 2, H - 4], fill=shirt, outline=INK)
    # arms
    d.rectangle([cx - 4, H - 9, cx - 3, H - 5], fill=shirt)
    d.rectangle([cx + 3, H - 9, cx + 4, H - 5], fill=shirt)
    # head
    d.ellipse([cx - 3, H - 15, cx + 3, H - 9], fill=skin, outline=INK)
    # hair
    d.chord([cx - 3, H - 16, cx + 3, H - 10], 180, 360, fill=hair)
    return im

# ---------------------------------------------------------------- stat icons
def icon_fund():
    """섬김기금 — 헌금 주머니"""
    W, H = 20, 20
    im = img(W, H)
    d = ImageDraw.Draw(im)
    d.polygon([(4, 9), (16, 9), (17, 18), (3, 18)], fill=GOLD, outline=INK)
    d.arc([5, 3, 15, 13], 200, 340, fill=INK, width=2)
    d.ellipse([3, 6, 17, 12], fill=(224, 176, 90, 255), outline=INK)
    d.line([(9, 12), (9, 16)], fill=INK)
    d.line([(11, 12), (11, 16)], fill=INK)
    return im

def icon_members():
    """성도수 — 두 사람"""
    W, H = 20, 20
    im = img(W, H)
    d = ImageDraw.Draw(im)
    d.ellipse([2, 5, 10, 13], fill=(224, 122, 95, 255), outline=INK)
    d.rectangle([1, 12, 11, 18], fill=(224, 122, 95, 255), outline=INK)
    d.ellipse([10, 3, 18, 11], fill=(97, 144, 178, 255), outline=INK)
    d.rectangle([9, 10, 19, 18], fill=(97, 144, 178, 255), outline=INK)
    return im

def icon_faith():
    """신앙지수 — 십자가"""
    W, H = 20, 20
    im = img(W, H)
    d = ImageDraw.Draw(im)
    for (x, y) in [(3, 3), (17, 3), (3, 17), (17, 17)]:
        d.line([(10, 10), (x, y)], fill=(255, 224, 150, 180), width=2)
    d.rectangle([8, 2, 12, 18], fill=(253, 250, 240, 255), outline=INK)
    d.rectangle([3, 7, 17, 11], fill=(253, 250, 240, 255), outline=INK)
    return im

def icon_reputation():
    """지역신뢰 — 하트"""
    W, H = 20, 20
    im = img(W, H)
    d = ImageDraw.Draw(im)
    d.pieslice([2, 3, 11, 12], 180, 360, fill=(224, 122, 149, 255), outline=INK)
    d.pieslice([9, 3, 18, 12], 180, 360, fill=(224, 122, 149, 255), outline=INK)
    d.polygon([(3, 9), (17, 9), (10, 18)], fill=(224, 122, 149, 255), outline=INK)
    d.line([(3, 9), (17, 9)], fill=(224, 122, 149, 255))
    return im

def icon_volunteers():
    """봉사자 — 돕는 손"""
    W, H = 20, 20
    im = img(W, H)
    d = ImageDraw.Draw(im)
    d.rectangle([7, 10, 14, 18], fill=(244, 201, 155, 255), outline=INK)
    for i, fx in enumerate([6, 9, 12, 15]):
        d.rectangle([fx, 2 + (i % 2), fx + 2, 11], fill=(244, 201, 155, 255), outline=INK)
    d.rectangle([3, 8, 7, 13], fill=(244, 201, 155, 255), outline=INK)
    return im


# ---------------------------------------------------------------- app icon (PWA)
def app_icon(size):
    """홈화면/매니페스트 아이콘 — 48px 네이티브로 그린 뒤 정수배 확대해 픽셀아트 선명도 유지"""
    S = 48
    im = img(S, S)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=9, fill=(58, 90, 150, 255))
    d.polygon([(8, 21), (24, 8), (40, 21)], fill=ROOF, outline=INK)
    d.rectangle([12, 21, 35, 41], fill=WALL, outline=INK)
    d.rectangle([21, 9, 26, 19], fill=CROSS, outline=INK)
    d.rectangle([17, 12, 30, 16], fill=CROSS, outline=INK)
    d.rectangle([20, 29, 27, 41], fill=DOOR, outline=DOOR_SH)
    return im.resize((size, size), Image.NEAREST)


if __name__ == "__main__":
    for lv in range(6):
        save(sanctuary(lv), f"sanctuary_{lv}.png")
    for lv in range(5):
        save(education(lv), f"education_{lv}.png")
        save(fellowship(lv), f"fellowship_{lv}.png")
    for lv in range(4):
        save(parking(lv), f"parking_{lv}.png")
    save(grass_tile(0), "grass_0.png")
    save(grass_tile(1), "grass_1.png")
    save(path_tile(), "path_0.png")
    save(tree(0), "tree_0.png")
    save(tree(1), "tree_1.png")
    save(bush(), "bush_0.png")
    save(fence_tile(), "fence_0.png")
    save(flower_bed(), "flower_bed_0.png")
    for i in range(8):
        save(person(i), f"person_{i}.png")
    for i in range(3):
        save(visiting_car(i), f"visiting_car_{i}.png")
    save(icon_fund(), "icon_fund.png")
    save(icon_members(), "icon_members.png")
    save(icon_faith(), "icon_faith.png")
    save(icon_reputation(), "icon_reputation.png")
    save(icon_volunteers(), "icon_volunteers.png")

    ROOT = os.path.join(os.path.dirname(__file__), "..")
    for size in (192, 512):
        p = os.path.join(ROOT, f"icon-{size}.png")
        app_icon(size).save(p)
        print("saved", p)
