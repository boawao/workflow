"""Build docs/admin-workflow.html (artifact page) from docs/admin-workflow.md.

Usage: python3 tools/build_html.py
Requires: pip install markdown
"""
import html
import re
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "admin-workflow.md"
OUT = ROOT / "docs" / "admin-workflow.html"

STYLE = """
<title>行政秘書工作流程圖</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@600;900&family=JetBrains+Mono:wght@400&display=swap">
<style>
/* Layout: sticky table of contents on the left, one readable column of
   prose with full-width diagram and table panels; stacks on phones. */
:root {
  --bg: #f5f6f8;
  --panel: #ffffff;
  --fg: #18212c;
  --muted: #5b6676;
  --line: #d9dee5;
  --accent: #b9380f;      /* fire-safety signal red-orange */
  --ai: #0b6e66;          /* marks AI / automated steps */
  --ai-bg: #e3f2ef;
  --font-display: "Noto Serif TC", "Songti TC", serif;
  --font-body: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #12171d; --panel: #1a2129; --fg: #e5e9ee; --muted: #9aa6b4;
    --line: #2d3742; --accent: #f08a5d; --ai: #5fd0c3; --ai-bg: #163330;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #12171d; --panel: #1a2129; --fg: #e5e9ee; --muted: #9aa6b4;
  --line: #2d3742; --accent: #f08a5d; --ai: #5fd0c3; --ai-bg: #163330;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body {
  background: var(--bg); color: var(--fg);
  font-family: var(--font-body); font-size: 15px; line-height: 1.75;
}
.wrap {
  display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 48px;
  max-width: 1240px; margin: 0 auto;
  padding-block: 40px 80px;
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
}
nav.toc {
  position: sticky; top: calc(env(safe-area-inset-top, 0px) + 24px);
  align-self: start; max-height: calc(100vh - 48px); overflow-y: auto;
  font-size: 13px; line-height: 1.5;
}
nav.toc .label {
  font-size: 11px; letter-spacing: .12em; color: var(--muted);
  text-transform: uppercase; margin-bottom: 10px;
}
nav.toc ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
nav.toc a {
  color: var(--muted); text-decoration: none; display: block;
  padding: 4px 10px; border-left: 2px solid var(--line);
}
nav.toc a:hover, nav.toc a:focus-visible { color: var(--fg); border-left-color: var(--accent); outline: none; }
nav.toc li.sub a { padding-left: 22px; font-size: 12px; }
main { min-width: 0; }
main > * { max-width: 760px; }
main > .diagram, main > .table { max-width: none; }
h1 {
  font-family: var(--font-display); font-weight: 900; font-size: 34px;
  line-height: 1.3; margin: 0 0 12px; text-wrap: balance;
}
h2 {
  font-family: var(--font-display); font-weight: 600; font-size: 24px;
  margin: 64px 0 16px; padding-top: 18px; border-top: 1px solid var(--line);
  text-wrap: balance; scroll-margin-top: 24px;
}
h2 .num { color: var(--accent); margin-right: 10px; font-variant-numeric: tabular-nums; }
h3 { font-size: 17px; font-weight: 700; margin: 40px 0 12px; scroll-margin-top: 24px; }
p, li { margin: 0 0 10px; }
a { color: var(--accent); }
blockquote {
  margin: 16px 0; padding: 10px 16px; border-left: 3px solid var(--line);
  color: var(--muted); font-size: 14px;
}
blockquote p { margin: 0 0 4px; }
code { font-family: var(--font-mono); font-size: .9em; }
hr { display: none; }
.diagram {
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
  padding: 20px; margin: 16px 0 24px; overflow-x: auto;
}
.diagram pre.mermaid { margin: 0; text-align: center; background: transparent; }
.table { overflow-x: auto; margin: 16px 0 24px; }
table {
  border-collapse: collapse; width: 100%; font-size: 14px; line-height: 1.55;
  background: var(--panel);
}
th, td { border: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; }
th { font-weight: 700; background: var(--bg); white-space: nowrap; }
td { font-variant-numeric: tabular-nums; }
.ai { color: var(--ai); background: var(--ai-bg); padding: 0 4px; border-radius: 3px; font-weight: 500; }
.lede { color: var(--muted); font-size: 14px; }
@media (max-width: 860px) {
  .wrap { grid-template-columns: minmax(0, 1fr); gap: 24px; padding-block: 24px 60px; }
  nav.toc { position: static; max-height: none; }
  nav.toc li.sub { display: none; }
  h1 { font-size: 27px; }
}
</style>
"""


def main():
    text = SRC.read_text(encoding="utf-8")

    diagrams = []

    def stash(m):
        diagrams.append(m.group(1))
        return f"\n\nMERMAIDBLOCK{len(diagrams) - 1}\n\n"

    text = re.sub(r"```mermaid\n(.*?)```", stash, text, flags=re.S)
    body = markdown.markdown(text, extensions=["tables", "sane_lists"])

    for i, src in enumerate(diagrams):
        block = f'<div class="diagram"><pre class="mermaid">{html.escape(src)}</pre></div>'
        body = body.replace(f"<p>MERMAIDBLOCK{i}</p>", block)

    body = body.replace("<table>", '<div class="table"><table>').replace("</table>", "</table></div>")
    body = body.replace("🤖", '<span class="ai">AI</span>')

    toc = []
    counter = {"h2": 0, "h3": 0}

    def anchor(m):
        level, title = m.group(1), m.group(2)
        counter[level] += 1
        aid = f"{level}-{counter[level]}"
        plain = re.sub(r"<[^>]+>", "", title)
        toc.append((level, aid, plain))
        if level == "h2":
            num = re.match(r"(\d+)\.\s*(.*)", title)
            if num:
                title = f'<span class="num">{num.group(1)}</span>{num.group(2)}'
        return f'<{level} id="{aid}">{title}</{level}>'

    body = re.sub(r"<(h2|h3)>(.*?)</\1>", anchor, body)
    body = body.replace("<blockquote>", '<blockquote class="lede">', 1)

    items = "".join(
        f'<li class="{"sub" if lvl == "h3" else ""}"><a href="#{aid}">{html.escape(t)}</a></li>'
        for lvl, aid, t in toc
    )
    page = (
        STYLE
        + '<div class="wrap"><nav class="toc" aria-label="目錄"><div class="label">目錄</div>'
        + f"<ol>{items}</ol></nav><main>{body}</main></div>\n"
    )
    OUT.write_text(page, encoding="utf-8")
    print(f"wrote {OUT} ({len(diagrams)} diagrams)")


if __name__ == "__main__":
    main()
