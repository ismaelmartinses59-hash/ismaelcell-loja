---
name: Web push notifications (Ismael Cell)
description: Why VAPID keys live in the DB (not env vars), how the caixa reminder scheduler works, and the no-broadcast rule for the confirmation ping.
---

Web push (caixa abrir/fechar reminders) for the Ismael Cell app.

## VAPID keys are stored in the DB, not env vars
The key pair is generated once on first boot and persisted in `app_config`
(read/written by the push lib). The public-key endpoint serves it to the
frontend; the private key signs sends.

**Why:** production runs on Railway, which has its own env vars that the Replit
environment cannot set. Storing the pair in the DB means prod works with
zero config — no manual env var step after deploy. Generating it inside a single
DB transaction avoids mismatched pub/priv rows when multiple instances cold-start
concurrently.

**How to apply:** never move VAPID keys to env vars expecting prod to pick them
up — Railway won't have them. Keep generation atomic.

## Confirmation ping must target ONE device, never broadcast
The "notifications enabled ✅" ping sent right after a device subscribes targets
only that device's endpoint. The scheduled caixa reminders are the only
legitimate broadcast.

**Why:** an opt-in confirmation that broadcasts spams every already-subscribed
device. The whole API is unauthenticated (single-shop internal tool), so a
broadcast test route is also an abuse vector.

**How to apply:** keep `/api/push/test` (or any confirmation send) endpoint-scoped.
Don't reintroduce a broadcast-on-subscribe.

## iOS limitation (tell the user)
Web push on iPhone only works if the app is INSTALLED to the home screen as a
PWA (iOS 16.4+). In a regular Safari tab it will not fire. Android Chrome works
without install. The blocking overlay still works everywhere regardless.

## Notification click must refresh the PWA lifecycle on iOS
When a caixa notification is tapped, navigate an existing window client to the
target URL relative to the service-worker scope before focusing it. For closing,
update the session cache from the successful POST response immediately; do not
keep the blocking overlay dependent on a follow-up refetch.

**Why:** on iOS, focusing a suspended PWA window can preserve a stale network
lifecycle. A follow-up status request may then hang even though the close POST
succeeded, leaving the blocking screen visible until the app is restarted.

**How to apply:** notification-click handlers must use scope-relative navigation
plus focus. Blocking mutations triggered just after resume should have a timeout
and update local state from the mutation response before background invalidation.
