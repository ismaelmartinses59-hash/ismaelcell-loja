---
name: Android local-DB direction (Caminho B)
description: User's decision to build an offline Android version of Ismael Cell to avoid hosting costs
---

# Android local-DB version (Caminho B)

The owner wants to avoid recurring hosting costs. We discussed that hosting cost
comes from the server + database, not from "being a website" — an Android client
alone would not remove it. The user correctly noted an Android app can embed its
own on-device database (SQLite), which *would* remove the need for hosting.

**Decision (chosen path = Caminho B):** Build an offline Android app with the
database stored on the device, no server hosting.

Agreed scope:
- On-device DB; all existing features (create/list/filter/search orders, edit,
  status change, reactivate OS, Cliente/Lojista modes, phone lines with auto-fill).
- Replace the public status link (`/status/:codigo`, which requires a server) with
  a button that generates a **ready-made WhatsApp message** containing the repair
  status and opens WhatsApp directly.
- **No** receipt/PDF (user declined).
- **Migrate existing data** from the current app into the new Android app.

**Why:** The status link is the single feature that forces hosting; the user
prioritized zero hosting cost over a live auto-updating status page.

**Blocker / how to apply:** Mobile/Android apps CANNOT be created from the iOS
Replit app. The user must open this project on replit.com (preferably desktop)
before this can be built. Plan is locked; just execute when on web.
