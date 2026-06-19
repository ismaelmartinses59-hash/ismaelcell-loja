---
name: Share-image rendering (extrato / peça cards)
description: html2canvas mis-renders on iOS Safari; the debtor "extrato" is now drawn pixel-by-pixel on a Canvas 2D. How to verify share images.
---

# html2canvas is NOT reliable for the EXTRATO share image — use Canvas 2D

The Ismael Cell "A Receber → Compartilhar no WhatsApp" button must produce a
branded "EXTRATO DE DÉBITO" PNG. html2canvas `^1.4.1` was tried 3 ways
(flexbox, table-cell, and pure absolute-positioning with explicit left/top/width).
ALL three looked perfect on desktop Chrome but rendered TORTO on the user's
iPhone (Safari): icons overlapping text, labels clipped at the top, the client
name falling out of its box. **Desktop verification does NOT prove iOS works for
html2canvas** — its text/box layout differs per browser engine.

**Final solution that works everywhere:** draw the whole receipt pixel-by-pixel
on an HTMLCanvasElement (Canvas 2D `fillText`/`arc`/`rect`/`fillRect`). Canvas 2D
is deterministic across browsers, so desktop output == iPhone output.
- Lives in `artifacts/ismael-cell/src/lib/extrato-image.ts`
  (`generateExtratoBlob({nome, saldo, itens}) → Promise<Blob>`).
- `handleShareExtrato` in catalogo-modal.tsx calls it directly (no hidden DOM card,
  no html2canvas). The old `ExtratoCard` component was deleted.
- Icons are drawn as vector paths mapped from lucide viewBox(24) into a centered
  square via `strokeIcon`; long client/item names are ellipsized with `measureText`.
- Output is scaled 2x (`ctx.scale(2,2)`, canvas 1280px wide) for crispness.

**Peça share cards** (cliente/lojista) STILL use html2canvas (`handleShare`,
`shareRef`) and are fine — only the extrato moved to Canvas 2D.

**How to verify a share image without login/data:** add a TEMP wouter route
(e.g. /extrato-preview) that calls the generator with mock data and shows the
blob in an `<img>`, screenshot via app_preview, then remove the temp route.
With Canvas 2D this desktop check is now a valid proxy for the iPhone.
