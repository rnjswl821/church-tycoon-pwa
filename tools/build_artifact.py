import base64, os, re, json

D = "/Users/a01/Library/CloudStorage/OneDrive-개인/04 지원/00 자비스/08 게임제작/church-tycoon-pwa"
ASSETS = os.path.join(D, "assets")

sprite_data = {}
for fn in sorted(os.listdir(ASSETS)):
    if fn.endswith(".png"):
        with open(os.path.join(ASSETS, fn), "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
        sprite_data[fn] = f"data:image/png;base64,{b64}"

print("embedded sprites:", len(sprite_data))

with open(os.path.join(D, "style.css"), encoding="utf-8") as f:
    css = f.read()
with open(os.path.join(D, "app.js"), encoding="utf-8") as f:
    app_js = f.read()
with open(os.path.join(D, "scene.js"), encoding="utf-8") as f:
    scene_js = f.read()

# Point scene.js's image loader at the embedded data-URI map instead of fetching assets/*.png
scene_js_patched = scene_js.replace(
    "im.src = ASSET_BASE + src;",
    "im.src = (window.SPRITE_DATA && window.SPRITE_DATA[src]) || '';"
)
assert "SPRITE_DATA" in scene_js_patched

with open(os.path.join(D, "index.html"), encoding="utf-8") as f:
    html = f.read()

body_match = re.search(r'<div id="app">.*?</div>\s*</div>\s*<div id="eventModal".*?</div>\s*</div>\s*<div id="milestoneModal".*?</div>\s*</div>', html, re.S)
# Simpler: grab everything between <body> and the first <script
body_start = html.index('<div id="app">')
body_end = html.index('<script src="scene.js">')
body_content = html[body_start:body_end].strip()

title = "교회 경영 시뮬레이션"
description_meta = '<meta name="description" content="교회를 세우고 성도를 섬기며 함께 성장시키는 픽셀아트 경영 시뮬레이션 게임">'

sprite_json = json.dumps(sprite_data, ensure_ascii=False)

out = f"""<meta charset="UTF-8">
<title>{title}</title>
{description_meta}
<meta name="theme-color" content="#3a5a96">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet">
<style>
{css}
</style>

{body_content}

<script>
window.SPRITE_DATA = {sprite_json};
</script>
<script>
{scene_js_patched}
</script>
<script>
{app_js}
</script>
"""

out_path = "/private/tmp/claude-501/-Users-a01/e14247d8-1b19-4562-b9ed-4cb03d69adce/scratchpad/church_tycoon_artifact.html"
with open(out_path, "w", encoding="utf-8") as f:
    f.write(out)

size_kb = os.path.getsize(out_path) / 1024
print(f"wrote {out_path} ({size_kb:.1f} KB)")
