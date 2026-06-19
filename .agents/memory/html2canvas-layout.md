---
name: html2canvas 1.4.1 layout quirks
description: How to build share-image cards that html2canvas 1.4.1 renders correctly (Ismael Cell extrato/peça share cards)
---

# html2canvas 1.4.1 renders flexbox crooked — use table layout instead

When generating share IMAGES from off-screen DOM via html2canvas `^1.4.1` (e.g. the
"EXTRATO DE DÉBITO" and peça share cards in `catalogo-modal.tsx`):

**Symptom:** with `display:flex; align-items:center` the captured PNG comes out
"torto e feio" — stacked text overlaps, icons land on top of adjacent text, columns
mis-position. Looks fine in the live DOM, broken only in the canvas output.

**Why:** html2canvas 1.4.1 has poor flexbox support, especially vertical centering
(`align-items:center`) and flex column stacking — it miscomputes child positions.

**How to apply (reliable recipe):**
- Use `display:table` + `display:table-cell; vertical-align:middle` for icon+text rows
  (NOT flex). Two-column layouts: a `table` with two `table-cell width:50%`.
- Center an icon inside a circle with `text-align:center` + `line-height:<circleSize>px`
  on the circle and `vertical-align:middle` on the `<svg>` (NOT flex centering).
- Give EVERY text node an explicit `line-height` (px) so nothing overlaps.
- Use a guaranteed font (`Arial, Helvetica, sans-serif`) and `await document.fonts.ready`
  before capture, so measurement doesn't shift when a web font loads late.
- Prefer a solid `background` color over `linear-gradient` (gradients can render off).
- Still wait ~2 `requestAnimationFrame` after mounting the hidden card before capture.
