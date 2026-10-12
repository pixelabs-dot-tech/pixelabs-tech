#!/usr/bin/env python3
"""Build the pixelabs.tech site.

Outputs
  out/pixelabs.html     artifact preview (no doctype/head wrapper)
  out/site/index.html   deployable page for pixelabs.tech

Brand assets for the Jeetak section (wordmark, slogan, pin, scooter, food
illustrations, village names and map positions) are read from a local clone of
pixelabs-dot-tech/jeetaklb-site, so they always match the live Jeetak site.
"""
import html
import json
import re
import sys
from pathlib import Path

import qrcode

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
OUT = ROOT / "out"
JEETAK = Path(sys.argv[1] if len(sys.argv) > 1 else "/home/claude/pixelabs-dot-tech/jeetaklb-site/index.html")

FONTS = ("https://fonts.googleapis.com/css2?family=Instrument+Sans:wdth,wght@75..100,400..700"
         "&family=Doto:wght@500..900&family=Kanit:ital,wght@1,600;1,700"
         "&family=Baloo+Bhaijaan+2:wght@600;700&display=swap")

PHONE_DISPLAY = "+961 79 173 773"
PHONE_WA = "96179173773"
EMAIL = "cesar@pixelabs.tech"


# ---------------------------------------------------------------- Jeetak assets
def balanced(s, start, tag):
    """Return s[start:end] for the element opening at `start`, honouring nesting."""
    depth, i = 0, start
    pat = re.compile(r"<(/?)%s\b[^>]*?(/?)>" % tag)
    for m in pat.finditer(s, start):
        if m.group(1) == "/":
            depth -= 1
        elif m.group(2) != "/":
            depth += 1
        if depth == 0:
            return s[start:m.end()]
    raise ValueError("unbalanced " + tag)


def jeetak_assets():
    s = JEETAK.read_text(encoding="utf-8")
    out = {}
    for pid in ("jk-word", "jk-slogan", "jk-pin"):
        i = s.find('id="%s"' % pid)
        st = s.rfind("<", 0, i)
        out[pid] = s[st:s.find(">", i) + 1]
    # scooter (from the intro animation)
    i = s.find('<g class="intro-scoot">')
    scoot = balanced(s, i, "g")
    scoot = scoot.replace('class="intro-scoot"', 'class="scoot-body-g"')
    out["scooter"] = scoot
    # food illustrations
    t0 = s.find('<template id="footFood">')
    tpl = s[t0:s.find("</template>", t0)]
    foods = {}
    for m in re.finditer(r'<div class="food" data-food="([^"]+)">', tpl):
        j = tpl.find("<svg", m.end())
        foods[m.group(1)] = balanced(tpl, j, "svg")
    out["food"] = foods
    # villages: first map (wide, viewBox 0 0 1000 670)
    vill = []
    for m in re.finditer(r'<g class="map-v"[^>]*>(.*?)<circle class="map-hit"', s, re.S):
        g = m.group(1)
        cx = float(re.search(r'class="map-dot" cx="([\d.]+)"', g).group(1))
        cy = float(re.search(r'class="map-dot" cx="[\d.]+" cy="([\d.]+)"', g).group(1))
        en = re.search(r'<g class="map-en"><text[^>]*>([^<]+)</text>', g).group(1)
        ar = re.search(r'<g class="map-ar"[^>]*><text[^>]*>([^<]+)</text>', g).group(1)
        vill.append([html.unescape(en), html.unescape(ar), round(cx / 1000, 4), round(cy / 670, 4)])
        if len(vill) == 24:
            break
    out["villages"] = vill
    return out


# ---------------------------------------------------------------- QR codes
def qr_matrix(data, ec):
    q = qrcode.QRCode(error_correction=ec, border=0, box_size=1)
    q.add_data(data)
    q.make(fit=True)
    return [[1 if v else 0 for v in row] for row in q.get_matrix()]


def qr_svg_path(m):
    d = []
    for y, row in enumerate(m):
        x = 0
        while x < len(row):
            if row[x]:
                x0 = x
                while x < len(row) and row[x]:
                    x += 1
                d.append("M%d %dh%dv1h-%dz" % (x0, y, x - x0, x - x0))
            else:
                x += 1
    return "".join(d)


def finder(m, x, y):
    n = len(m)
    for fx, fy in ((0, 0), (n - 7, 0), (0, n - 7)):
        if fx <= x < fx + 7 and fy <= y < fy + 7:
            return True
    return False


def styled_qr_svg(m):
    """Dots for data modules, rounded finder eyes, clear centre for the mark."""
    n = len(m)
    c0, c1 = n * 0.36, n * 0.64
    dots = []
    for y, row in enumerate(m):
        for x, v in enumerate(row):
            if not v or finder(m, x, y):
                continue
            if c0 <= x + 0.5 <= c1 and c0 <= y + 0.5 <= c1:
                continue
            dots.append('<circle cx="%.1f" cy="%.1f" r=".43"/>' % (x + 0.5, y + 0.5))
    eyes = []
    for fx, fy in ((0, 0), (n - 7, 0), (0, n - 7)):
        eyes.append('<rect x="%.1f" y="%.1f" width="6" height="6" rx="1.7" fill="none" stroke="currentColor" stroke-width="1"/>'
                    % (fx + 0.5, fy + 0.5))
        eyes.append('<rect x="%d" y="%d" width="3" height="3" rx=".9"/>' % (fx + 2, fy + 2))
    cs = (c1 - c0)
    mark = ('<g transform="translate(%.2f %.2f)">'
            '<rect width="%.2f" height="%.2f" rx="1.2" fill="#fff"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx=".3" fill="#ff3448"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx=".3" fill="#1fd36a"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx=".3" fill="#2f6dff"/></g>'
            % (c0, c0, cs, cs,
               cs * .22, cs * .2, cs * .14, cs * .6,
               cs * .43, cs * .2, cs * .14, cs * .6,
               cs * .64, cs * .2, cs * .14, cs * .6))
    return ('<svg class="qr-styled" viewBox="-2 -2 %d %d" role="img" aria-label="QR code that opens pixelabs.tech">'
            '<rect x="-2" y="-2" width="%d" height="%d" rx="2.4" fill="#fff"/>'
            '<g fill="currentColor">%s%s</g>%s</svg>' % (n + 4, n + 4, n + 4, n + 4, "".join(dots), "".join(eyes), mark))


# ---------------------------------------------------------------- pixel icons
ICONS = {
    "web": """
############
#.#.#......#
############
#..........#
#.#####....#
#..........#
#.########.#
#.########.#
#..........#
############""",
    "app": """
.######.
#......#
#.####.#
#.####.#
#.####.#
#.####.#
#.####.#
#.####.#
#......#
#..##..#
#......#
.######.""",
    "social": """
.###...###.
#####.#####
###########
###########
###########
.#########.
..#######..
...#####...
....###....
.....#.....""",
    "print": """
###.#.#.###
#.#..#..#.#
###.#.#.###
.....#.....
#.##.#..#.#
.#..###.#..
#.#..#.##.#
.....#.....
###..#.#.#.
#.#.#..#..#
###.#.###.#""",
    "data": """
############
#.##.......#
############
............
############
#.##.......#
############
............
############
#.##.......#
############""",
    "ext": """
..######
......##
.....#.#
....#..#
...#...#
..#.....
.#......
#.......""",
}


def pixel_svg(name, cls="px-icon"):
    rows = [r for r in ICONS[name].strip("\n").split("\n")]
    h, w = len(rows), max(len(r) for r in rows)
    d = []
    for y, r in enumerate(rows):
        x = 0
        while x < len(r):
            if r[x] == "#":
                x0 = x
                while x < len(r) and r[x] == "#":
                    x += 1
                d.append("M%d %dh%dv1h-%dz" % (x0, y, x - x0, x - x0))
            else:
                x += 1
    return ('<svg class="%s" viewBox="0 0 %d %d" aria-hidden="true" focusable="false" shape-rendering="crispEdges">'
            '<path d="%s"/></svg>' % (cls, w, h, "".join(d)))


# ---------------------------------------------------------------- assemble
def build():
    jk = jeetak_assets()
    page = (SRC / "page.html").read_text(encoding="utf-8")
    css = (SRC / "style.css").read_text(encoding="utf-8")
    js = (SRC / "main.js").read_text(encoding="utf-8")

    wa_qr = qr_matrix("https://wa.me/%s" % PHONE_WA, qrcode.constants.ERROR_CORRECT_M)
    px_qr = qr_matrix("https://pixelabs.tech", qrcode.constants.ERROR_CORRECT_H)
    n = len(wa_qr)

    villages = jk["villages"]
    vill_json = html.escape(json.dumps(villages, ensure_ascii=False), quote=True)
    map_dots = "".join('<circle cx="%.1f" cy="%.1f" r="7"/>' % (v[2] * 1000, v[3] * 670) for v in villages)

    repl = {
        "{{JK_WORD}}": jk["jk-word"],
        "{{JK_SLOGAN}}": jk["jk-slogan"],
        "{{JK_PIN}}": jk["jk-pin"],
        "{{SCOOTER}}": jk["scooter"],
        "{{FOOD_MANOUSHE}}": jk["food"]["manoushe"],
        "{{FOOD_COFFEE}}": jk["food"]["coffee"],
        "{{FOOD_KAAK}}": jk["food"]["kaak"],
        "{{FOOD_WATERMELON}}": jk["food"]["watermelon"],
        "{{FOOD_GROCERIES}}": jk["food"].get("groceries", ""),
        "{{VILLAGES_JSON}}": vill_json,
        "{{VILLAGE_DOTS}}": map_dots,
        "{{QR_N}}": str(n),
        "{{QR_N4}}": str(n + 8),
        "{{QR_PATH}}": qr_svg_path(wa_qr),
        "{{QR_JSON}}": html.escape(json.dumps(["".join(map(str, r)) for r in wa_qr]), quote=True),
        "{{QR_STYLED}}": styled_qr_svg(px_qr),
        "{{ICON_WEB}}": pixel_svg("web"),
        "{{ICON_APP}}": pixel_svg("app"),
        "{{ICON_SOCIAL}}": pixel_svg("social"),
        "{{ICON_PRINT}}": pixel_svg("print"),
        "{{ICON_DATA}}": pixel_svg("data"),
        "{{ICON_EXT}}": pixel_svg("ext", "ext"),
        "{{PHONE}}": PHONE_DISPLAY,
        "{{PHONE_WA}}": PHONE_WA,
        "{{EMAIL}}": EMAIL,
    }
    for k, v in repl.items():
        page = page.replace(k, v)
    left = re.findall(r"\{\{[A-Z_0-9]+\}\}", page)
    if left:
        raise SystemExit("unfilled placeholders: %s" % sorted(set(left)))

    fonts = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
             '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
             '<link rel="stylesheet" href="%s">' % FONTS)

    # artifact preview: content only, the host adds the document skeleton
    artifact = ("<title>Pixelabs Portfolio</title>\n%s\n<style>\n%s</style>\n%s\n<script>\n%s</script>\n"
                % (fonts, css, page, js))
    OUT.mkdir(exist_ok=True)
    (OUT / "pixelabs.html").write_text(artifact, encoding="utf-8")

    # deployable page
    desc = ("Cesar Aboul Hosn designs, builds and markets websites, apps and brands. "
            "Web and app developer in Lebanon, founder and developer of Jeetak.")
    favicon = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
               "%3Crect width='32' height='32' rx='6' fill='%23000'/%3E"
               "%3Crect x='7' y='7' width='4.5' height='18' rx='1' fill='%23ff3448'/%3E"
               "%3Crect x='13.75' y='7' width='4.5' height='18' rx='1' fill='%2328ff7c'/%3E"
               "%3Crect x='20.5' y='7' width='4.5' height='18' rx='1' fill='%232f6dff'/%3E%3C/svg%3E")
    site = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Cesar Aboul Hosn | Web &amp; App Developer | pixelabs</title>
<meta name="description" content="{desc}">
<meta name="theme-color" content="#000000">
<link rel="canonical" href="https://pixelabs.tech/">
<link rel="icon" href="{fav}">
<meta property="og:type" content="website">
<meta property="og:url" content="https://pixelabs.tech/">
<meta property="og:site_name" content="pixelabs">
<meta property="og:title" content="Cesar Aboul Hosn | Web &amp; App Developer">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="https://pixelabs.tech/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
{fonts}
<style>
:root{{padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}}
*,*::before,*::after{{box-sizing:border-box}}
body{{margin:0}}
img{{max-width:100%}}
[hidden]{{display:none!important}}
{css}</style>
</head>
<body>
{page}
<script>
{js}</script>
</body>
</html>
""".format(desc=html.escape(desc), fav=favicon, fonts=fonts, css=css, page=page, js=js)
    (OUT / "site").mkdir(parents=True, exist_ok=True)
    (OUT / "site" / "index.html").write_text(site, encoding="utf-8")
    print("built: artifact %d KB, site %d KB, QR %dx%d, villages %d"
          % (len(artifact.encode()) // 1024, len(site.encode()) // 1024, n, n, len(villages)))


def make_og(path):
    """1200x630 share image: the word drawn in red, green and blue subpixels, like the hero."""
    from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops
    W, H, cell = 1200, 630, 14
    bold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    reg = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    cols, rows = W // cell, 30
    S = 6
    mask = Image.new("L", (cols * S, rows * S), 0)
    md = ImageDraw.Draw(mask)
    fs = 400
    font = ImageFont.truetype(bold, fs)
    bx = md.textbbox((0, 0), "pixelabs", font=font)
    scale = min(cols * S * 0.86 / (bx[2] - bx[0]), rows * S * 0.8 / (bx[3] - bx[1]))
    font = ImageFont.truetype(bold, int(fs * scale))
    bx = md.textbbox((0, 0), "pixelabs", font=font)
    md.text(((cols * S - (bx[2] - bx[0])) / 2 - bx[0], (rows * S - (bx[3] - bx[1])) / 2 - bx[1]), "pixelabs", font=font, fill=255)
    small = mask.resize((cols, rows), Image.BOX)
    img = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(img)
    ox, oy = (W - cols * cell) // 2, 70
    sub = [(255, 42, 64), (43, 255, 114), (47, 107, 255)]
    third, bw, bh = cell / 3, cell / 3 * 0.72, cell * 0.84
    pad = (third - bw) / 2
    for r in range(rows):
        for c in range(cols):
            on = small.getpixel((c, r)) > 255 * 0.42
            for k in range(3):
                x0 = ox + c * cell + k * third + pad
                y0 = oy + r * cell + (cell - bh) / 2
                col = sub[k] if on else tuple(int(v * 0.12) for v in sub[k])
                d.rectangle([x0, y0, x0 + bw, y0 + bh], fill=col)
    glow = img.filter(ImageFilter.GaussianBlur(14))
    img = ImageChops.add(img, ImageChops.multiply(glow, Image.new("RGB", (W, H), (200, 200, 200))))
    d = ImageDraw.Draw(img)
    f1, f2 = ImageFont.truetype(bold, 40), ImageFont.truetype(reg, 28)
    d.text((80, 500), "Cesar Aboul Hosn", font=f1, fill=(243, 245, 244))
    d.text((80, 552), "Web and app developer. Founder and developer of Jeetak.", font=f2, fill=(145, 152, 161))
    for k, col in enumerate(sub):
        d.rounded_rectangle([1040 + k * 16, 510, 1050 + k * 16, 548], radius=3, fill=col)
    img.save(path, optimize=True)


if __name__ == "__main__":
    build()
    make_og(OUT / "site" / "og-image.png")
    print("og-image written")
