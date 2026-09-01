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
body_start = html.index('<div id="splashScreen"')
body_end = html.index('<script src="scene.js">')
body_content = html[body_start:body_end].strip()

title = "목양타이쿤"
description_meta = '<meta name="description" content="교회를 세우고 성도를 섬기며 함께 성장시키는 목회 경영 시뮬레이션 게임">'

sprite_json = json.dumps(sprite_data, ensure_ascii=False)

# app.js/index.html render dozens of plain <img src="assets/xxx.png"> tags via innerHTML
# (topbar logo, stat icons, every card icon, modal icons, ...). scene.js's canvas loader was
# the only thing ever patched to use SPRITE_DATA — every one of those plain <img> tags was
# still pointing at a relative assets/ path that doesn't exist in a single-file artifact, so
# they all rendered as broken-image boxes (오너가 실제로 발견, 2026-09-01). A MutationObserver
# catches every <img> added anywhere (however app.js created it) without touching app.js itself.
img_fix_script = """
(function(){
  function fix(img) {
    var src = img.getAttribute('src');
    if (src && src.indexOf('assets/') === 0) {
      var key = src.slice('assets/'.length);
      if (window.SPRITE_DATA && window.SPRITE_DATA[key]) img.src = window.SPRITE_DATA[key];
    }
  }
  function scan(root) {
    if (root.tagName === 'IMG') fix(root);
    if (root.querySelectorAll) root.querySelectorAll('img').forEach(fix);
  }
  scan(document);
  new MutationObserver(function(muts){
    muts.forEach(function(m){
      m.addedNodes.forEach(function(n){ if (n.nodeType === 1) scan(n); });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
"""

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
{img_fix_script}
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
