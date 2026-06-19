---
name: html2canvas 1.4.1 layout quirks
description: How to build share-image cards that html2canvas 1.4.1 renders correctly (Ismael Cell extrato/peça share cards)
---

# html2canvas 1.4.1 only renders ABSOLUTE positioning reliably

When generating share IMAGES from off-screen DOM via html2canvas `^1.4.1`
(the "EXTRATO DE DÉBITO" / peça share cards), the captured PNG comes out broken
even though the live DOM looks perfect.

**What FAILS in the canvas output (verified by repeated attempts):**
- `display:flex; align-items:center` — children overlap, text stacks on icons.
- `display:table / table-cell; vertical-align:middle` — ALSO breaks (icons overlap text).
- `inline-block` + `vertical-align:middle` — ALSO breaks the same way.
In short: any layout that relies on the inline/flex/table layout engine for
vertical centering is mis-computed by html2canvas 1.4.1.

**What WORKS (the only reliable recipe):**
- Build each "icon + text" unit with a `position:relative` parent and
  `position:absolute` children placed with explicit `left`/`top`/`width` (px).
  Icons get an absolute circle (`position:absolute`) with the `<svg>` absolutely
  positioned inside it (`left = (circle-icon)/2`). Text goes in block flow with
  `marginLeft` to clear the icon, or its own absolute `left/top/width`.
- Prefer explicit `left`+`width` over `right` for safety (the proven peça card uses
  only left/top). `right` mostly works but left/width removes all doubt.
- Center a single line of text vertically with `lineHeight` == container height
  (NOT vertical-align). Center horizontally with `textAlign`.
- Give EVERY text node an explicit `lineHeight` (px) so nothing overlaps.
- Use a guaranteed font (`Arial, Helvetica, sans-serif`) and `await document.fonts.ready`
  before capture; solid `background` color (not gradient); wait ~2 rAF after mount.

**How to verify without login/data:** add a TEMP wouter route (e.g. /extrato-preview)
that renders the card component with mock data, runs html2canvas in a useEffect, and
shows `canvas.toDataURL()` in an `<img>`. Screenshot it via app_preview, then remove
the temp route. This shows the ACTUAL canvas output, not the (always-fine) DOM.

**Where:** the card lives in `artifacts/ismael-cell/src/components/extrato-card.tsx`
(reusable `ExtratoCard`, forwardRef) — keep it as the single source; never reintroduce
flex/table-cell in capture-critical regions.
