// The art preview page: the preview's items as one self-contained HTML
// page, ready to publish as an Artifact. Each picture is a set of SVG rects,
// drawn once and shown at 1x and 4x, so every pixel stays a crisp square.
// The page script (client.js) adds the keep / redo / notes verdicts.

import type { Pixels } from '../../src/raster'
import { verdictDocId } from './items'
import type { PreviewItem, Section } from './items'

export type PageOptions = {
  /** When the page was generated, shown in its header. */
  generatedAt: Date
  seed: number
  /** The page script, client.js, inlined at the end of the page. */
  script: string
}

const SECTIONS: readonly { section: Section; heading: string; about: string }[] = [
  { section: 'body', heading: 'Bodies', about: 'Each body alone, with no face or accessory, in the first palette.' },
  { section: 'face', heading: 'Faces', about: 'Each face on the first body, in the first palette.' },
  { section: 'palette', heading: 'Palettes', about: 'Each palette on the first body and face, plain and shiny.' },
  { section: 'accessory', heading: 'Accessories', about: 'Each accessory on the first body and face, in the first palette.' },
  { section: 'sample', heading: 'Sample squishys', about: 'Squishys rolled at the standard odds from a fixed seed, as agents would get them.' },
  { section: 'legendary', heading: 'Legendaries', about: 'Each legendary, drawn whole, plain and shiny.' },
  { section: 'starter', heading: 'Starters', about: 'The species a new user picks a partner from, in the first palette.' },
]

export function previewPage(items: readonly PreviewItem[], { generatedAt, seed, script }: PageOptions): string {
  const symbols: string[] = []
  const pictureOf = (pixels: Pixels): number => {
    symbols.push(`<symbol id="p${symbols.length}" viewBox="0 0 16 16">${rects(pixels)}</symbol>`)
    return symbols.length - 1
  }
  const sections = SECTIONS.map(({ section, heading, about }) => {
    const members = items.filter(item => item.section === section)
    if (members.length === 0) return ''
    return `<section class="section" id="${section}" aria-labelledby="${section}-h">
<header class="section-head"><h2 id="${section}-h">${heading} <span class="count">${members.length}</span></h2><p>${about}</p></header>
<div class="cards">${members.map(item => card(item, pictureOf)).join('\n')}</div>
</section>`
  }).join('\n')
  const nav = SECTIONS.map(({ section, heading }) => {
    const count = items.filter(item => item.section === section).length
    return count === 0 ? '' : `<a href="#${section}">${heading} <span class="count">${count}</span></a>`
  }).join('')

  return `<title>Squishys Art Preview</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&amp;family=JetBrains+Mono:wght@400;600&amp;family=Pixelify+Sans:wght@500;700&amp;display=swap">
<style>${STYLE}</style>
<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>${symbols.join('')}</defs></svg>
<div class="page">
<header class="masthead">
  <div class="title">
    <h1>Squishys art preview</h1>
    <p class="meta">Generated ${escaped(generatedAt.toISOString().replace('T', ' ').slice(0, 16))} UTC from the kit in <code>src/kit.ts</code>, through the mod&rsquo;s own composer. Samples use seed ${seed}.</p>
  </div>
  <div class="board" aria-live="polite">
    <p class="tally"><span class="pill keep"><b id="t-keep">0</b> keep</span><span class="pill redo"><b id="t-redo">0</b> redo</span><span class="pill open"><b id="t-open">${items.length}</b> undecided</span></p>
    <p class="status" id="status" data-mode="connecting">Connecting to the shared verdicts&hellip;</p>
  </div>
</header>
<div class="toolbar">
  <nav class="jump" aria-label="Sections">${nav}</nav>
  <fieldset class="filter"><legend>Show</legend>
    <input type="radio" name="filter" id="f-all" value="all" checked><label for="f-all">All</label>
    <input type="radio" name="filter" id="f-undecided" value="undecided"><label for="f-undecided">Undecided</label>
    <input type="radio" name="filter" id="f-redo" value="redo"><label for="f-redo">Redo</label>
    <input type="radio" name="filter" id="f-keep" value="keep"><label for="f-keep">Keep</label>
  </fieldset>
</div>
<main id="sheet" data-filter="all">
${sections}
</main>
<details class="export">
  <summary>Verdicts as JSON</summary>
  <p>Every item with a verdict or a note. Copy this when the page can&rsquo;t save to the shared verdicts, and paste it to Claude.</p>
  <div class="export-row"><button type="button" id="copy">Copy JSON</button><span id="copy-status" role="status"></span></div>
  <label class="sr" for="json">Verdicts as JSON</label>
  <textarea id="json" rows="8" readonly>[]</textarea>
</details>
</div>
<script>${safeScript(script)}</script>
`
}

function card(item: PreviewItem, pictureOf: (pixels: Pixels) => number): string {
  const doc = verdictDocId(item.id)
  const figures = item.pictures
    .map(({ caption, pixels }) => {
      const symbol = pictureOf(pixels)
      const use = `<use href="#p${symbol}"/>`
      return `<figure><div class="x4"><svg width="64" height="64" viewBox="0 0 16 16" role="img" aria-label="${escaped(`${item.title}, ${caption}, 4x`)}">${use}</svg></div><div class="x1"><svg width="16" height="16" viewBox="0 0 16 16" role="img" aria-label="${escaped(`${item.title}, ${caption}, 1x`)}">${use}</svg><span>1&times;</span></div><figcaption>${escaped(caption)}</figcaption></figure>`
    })
    .join('')
  return `<article class="card" data-item="${escaped(item.id)}" data-doc="${escaped(doc)}" data-verdict="">
<div class="pics">${figures}</div>
<div class="about"><h3>${escaped(item.title)}</h3><p class="id">${escaped(item.id)}</p><p class="detail">${escaped(item.detail)}</p></div>
<div class="verdict" role="group" aria-label="${escaped(`Verdict on ${item.id}`)}"><button type="button" class="keep" data-verdict="keep" aria-pressed="false">Keep</button><button type="button" class="redo" data-verdict="redo" aria-pressed="false">Redo</button></div>
<label class="sr" for="n-${escaped(doc)}">${escaped(`Notes on ${item.id}`)}</label>
<textarea id="n-${escaped(doc)}" rows="2" placeholder="Notes for the redraw"></textarea>
</article>`
}

/** A picture as SVG rects, one per run of same-colored pixels in a row. */
function rects(pixels: Pixels): string {
  const out: string[] = []
  pixels.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const color = row[x] ?? null
      let end = x + 1
      while (end < row.length && (row[end] ?? null) === color) end += 1
      if (color !== null) {
        const fill = '#' + color.toString(16).padStart(6, '0')
        out.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${fill}"/>`)
      }
      x = end
    }
  })
  return out.join('')
}

/** Text made safe for HTML, with anything outside ASCII as a character reference. */
function escaped(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[^\x20-\x7e]/gu, char => `&#x${(char.codePointAt(0) ?? 0).toString(16)};`)
}

/** The page script, safe to inline: no closing tag inside, and ASCII only. */
function safeScript(script: string): string {
  return script
    .replace(/<\/script/gi, '<\\/script')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, char => `\\u${(char.charCodeAt(0)).toString(16).padStart(4, '0')}`)
}

const STYLE = `
/* A contact sheet on a light table: sections of cards, each card a
   4x picture on a checkerboard with its 1x beside it, verdicts underneath. */
:root {
  --bg: #e9ecf2;
  --surface: #ffffff;
  --ink: #1d2233;
  --muted: #5b6377;
  --line: #d3d8e3;
  --accent: #3555d0;
  --keep: #17773f;
  --keep-soft: #dcf2e4;
  --redo: #b4400f;
  --redo-soft: #fbe5d8;
  --check-a: #dfe3eb;
  --check-b: #f4f6f9;
  --display: "Pixelify Sans", "Atkinson Hyperlegible", system-ui, sans-serif;
  --body: "Atkinson Hyperlegible", system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #131620; --surface: #1c2030; --ink: #e5e8f1; --muted: #99a0b4; --line: #2d3346;
    --accent: #8fa3ff; --keep: #52c784; --keep-soft: #173626; --redo: #ff9159; --redo-soft: #3f2418;
    --check-a: #262b3b; --check-b: #2f3548; color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #131620; --surface: #1c2030; --ink: #e5e8f1; --muted: #99a0b4; --line: #2d3346;
  --accent: #8fa3ff; --keep: #52c784; --keep-soft: #173626; --redo: #ff9159; --redo-soft: #3f2418;
  --check-a: #262b3b; --check-b: #2f3548; color-scheme: dark;
}
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 var(--body); }
.page { max-width: 78rem; margin: 0 auto; padding: 1.5rem 16px 3rem; display: grid; gap: 1.5rem; }
.page > *, .toolbar > *, .masthead > * { min-width: 0; }
.filter { min-inline-size: 0; }
h1, h2, h3 { font-family: var(--display); font-weight: 700; margin: 0; text-wrap: balance; }
h1 { font-size: 2rem; line-height: 1.1; letter-spacing: 0.01em; }
h2 { font-size: 1.35rem; display: flex; align-items: baseline; gap: 0.5rem; }
h3 { font-size: 1.05rem; font-weight: 500; }
p { margin: 0; }
code { font-family: var(--mono); font-size: 0.9em; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.defs { position: absolute; width: 0; height: 0; overflow: hidden; }
svg { shape-rendering: crispEdges; image-rendering: pixelated; display: block; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.masthead { display: flex; flex-wrap: wrap; gap: 1rem 2rem; align-items: end; justify-content: space-between; }
.title { display: grid; gap: 0.4rem; max-width: 40rem; min-width: 0; }
.meta { color: var(--muted); }
.board { display: grid; gap: 0.4rem; justify-items: end; }
.tally { display: flex; flex-wrap: wrap; gap: 0.4rem; font-variant-numeric: tabular-nums; }
.pill { border: 1px solid var(--line); border-radius: 999px; padding: 0.1rem 0.7rem; background: var(--surface); font-size: 0.9rem; }
.pill b { font-weight: 700; }
.pill.keep b { color: var(--keep); }
.pill.redo b { color: var(--redo); }
.status { font-size: 0.85rem; color: var(--muted); }
.status[data-mode="shared"]::before, .status[data-mode="local"]::before, .status[data-mode="readonly"]::before, .status[data-mode="error"]::before {
  content: ""; display: inline-block; width: 0.5rem; height: 0.5rem; margin-right: 0.4rem; vertical-align: 0.05rem; background: var(--muted);
}
.status[data-mode="shared"]::before { background: var(--keep); }
.status[data-mode="error"]::before, .status[data-mode="readonly"]::before { background: var(--redo); }

.toolbar { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 2; display: flex; flex-wrap: wrap; gap: 0.6rem 1.5rem; align-items: center; justify-content: space-between; padding-block: 0.6rem; background: var(--bg); border-bottom: 1px solid var(--line); }
.jump { display: flex; flex-wrap: wrap; gap: 0.3rem 1rem; }
.jump a { color: var(--ink); text-decoration: none; font-size: 0.9rem; }
.jump a:hover { color: var(--accent); }
.count { font-family: var(--mono); font-size: 0.75rem; color: var(--muted); font-weight: 400; }
.filter { border: 0; margin: 0; padding: 0; display: flex; align-items: center; gap: 0.25rem; flex-wrap: wrap; }
.filter legend { float: left; margin-right: 0.4rem; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.filter input { position: absolute; opacity: 0; pointer-events: none; }
.filter label { border: 1px solid var(--line); border-radius: 999px; padding: 0.1rem 0.7rem; font-size: 0.85rem; cursor: pointer; background: var(--surface); }
.filter input:checked + label { border-color: var(--accent); color: var(--accent); font-weight: 700; }
.filter input:focus-visible + label { outline: 2px solid var(--accent); outline-offset: 2px; }

main { display: grid; gap: 2.5rem; }
.section { display: grid; gap: 1rem; scroll-margin-top: 4.5rem; }
.section-head { display: grid; gap: 0.2rem; }
.section-head p { color: var(--muted); max-width: 65ch; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 15.5rem), 1fr)); gap: 0.9rem; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 0.9rem; display: grid; gap: 0.7rem; align-content: start; min-width: 0; }
.card[data-verdict="keep"] { border-color: var(--keep); box-shadow: inset 0 3px 0 var(--keep); }
.card[data-verdict="redo"] { border-color: var(--redo); box-shadow: inset 0 3px 0 var(--redo); }
#sheet[data-filter="undecided"] .card:not([data-verdict=""]),
#sheet[data-filter="redo"] .card:not([data-verdict="redo"]),
#sheet[data-filter="keep"] .card:not([data-verdict="keep"]) { display: none; }
.pics { display: flex; flex-wrap: wrap; gap: 0.9rem; }
figure { margin: 0; display: grid; grid-template-columns: auto auto; grid-template-rows: auto auto; gap: 0.3rem 0.5rem; align-items: end; }
.x4 { padding: 4px; border-radius: 3px; background: repeating-conic-gradient(var(--check-a) 0% 25%, var(--check-b) 0% 50%) 0 0 / 16px 16px; }
.x1 { display: grid; justify-items: center; gap: 0.2rem; padding: 4px; border-radius: 3px; background: repeating-conic-gradient(var(--check-a) 0% 25%, var(--check-b) 0% 50%) 0 0 / 4px 4px; }
.x1 span, figcaption { font-family: var(--mono); font-size: 0.7rem; color: var(--muted); }
figcaption { grid-column: 1 / -1; }
.about { display: grid; gap: 0.1rem; min-width: 0; }
.id { font-family: var(--mono); font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
.detail { font-size: 0.85rem; color: var(--muted); }
.verdict { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; }
button { font: inherit; cursor: pointer; }
.verdict button { border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 4px; padding: 0.3rem 0.5rem; font-weight: 700; font-size: 0.9rem; }
.verdict button.keep:hover, .verdict button.keep[aria-pressed="true"] { border-color: var(--keep); color: var(--keep); }
.verdict button.redo:hover, .verdict button.redo[aria-pressed="true"] { border-color: var(--redo); color: var(--redo); }
.verdict button.keep[aria-pressed="true"] { background: var(--keep-soft); }
.verdict button.redo[aria-pressed="true"] { background: var(--redo-soft); }
button:disabled, textarea:disabled { cursor: not-allowed; opacity: 0.6; }
textarea { width: 100%; font: 0.9rem/1.4 var(--body); color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: 0.4rem 0.5rem; resize: vertical; }

.export { border-top: 1px solid var(--line); padding-top: 1rem; display: grid; gap: 0.6rem; }
.export summary { cursor: pointer; font-family: var(--display); font-size: 1.1rem; }
.export p { color: var(--muted); margin-block: 0.5rem; max-width: 65ch; }
.export-row { display: flex; align-items: center; gap: 0.8rem; margin-bottom: 0.5rem; }
#copy { border: 1px solid var(--accent); color: var(--accent); background: var(--surface); border-radius: 4px; padding: 0.3rem 0.8rem; font-weight: 700; }
#copy-status { font-size: 0.85rem; color: var(--muted); }
#json { font-family: var(--mono); font-size: 0.8rem; }
@media (max-width: 40rem) { .board { justify-items: start; } h1 { font-size: 1.6rem; } }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
`
