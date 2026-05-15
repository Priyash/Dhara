# ধারা — Dhara Streaming

[![CI](https://github.com/Priyash/Dhara/actions/workflows/node-ci.yml/badge.svg?branch=development)](https://github.com/Priyash/Dhara/actions/workflows/node-ci.yml)

Bengali OTT streaming platform — films, series, and documentaries.

---

## Stack

| Layer      | Tech                                          |
|------------|-----------------------------------------------|
| Frontend   | React 18 · Vite · Zustand · CSS Modules       |
| Backend    | Node.js 20+ · Express · ES Modules            |
| Database   | MongoDB + Mongoose                            |
| Auth       | Firebase Auth (email/password + Admin SDK)    |
| Payments   | Razorpay (one-time orders + subscription webhooks) |
| Video      | Stream +  CDN (HLS, token-signed)  |
| Images     | Cloudinary                                    |
| Email      | Resend                                        |

---

## Project Layout

```
dhara-streaming/
├── frontend/src/
│   ├── pages/          # Home, Browse, Watch, Profile, Admin, CreatorStudio
│   ├── components/     # Navbar, VideoPlayer, PaywallModal, AuthModal, PosterCard, …
│   ├── store/          # Zustand (auth, UI, creator state)
│   ├── services/       # api.js, cloudinary.js
│   └── hooks/          # useScrolled, useUploadNotifier, useWatchlist
├── backend/
│   ├── server.js
│   └── src/
│       ├── routes/     # auth, content, user, payments, search, admin, creator
│       ├── models/     # User, Content, Transaction, CreatorEarning, CreatorPayout,
│       │               # ViewEvent, ContentRankSnapshot, UploadJob, …
│       ├── middleware/ # requireAuth, requireAdmin, requireSubscription, errorHandler
│       └── config/     # firebase, mongodb, razorpay, cloudinary, env, cache
├── config/secrets/     # Profile-scoped env files — never committed
└── package.json        # Root helper scripts
```

---

## Setup

```bash
# 1. Install
npm run install:all

# 2. Add secrets
# Place .env.<profile> files in config/secrets/{dev|staging|prod}/
# See render.yaml for the full variable list

# 3. Run
npm run dev             # backend :4000 · frontend :5173
```

---

## Scripts

| Command               | Does                                           |
|-----------------------|------------------------------------------------|
| `npm run dev`         | Backend + frontend concurrently (dev profile)  |
| `npm run install:all` | Install deps in both packages                  |
| `npm run lint`        | ESLint on frontend src                         |
| `npm test`            | Backend (node:test) + frontend (vitest) suites |
| `npm run seed`        | Seed sample content into MongoDB               |

---

## Features

**Auth**
- Firebase email/password with verification gate
- Password reset, tab-focus verification sync
- `isAdmin` custom claim → admin-only routes
- Optimistic localStorage hint eliminates sign-in flash on page load

**Streaming**
- HLS.js adaptive bitrate playback
- CDN Token Auth (SHA-256 HMAC, 1-hour expiry) for premium URLs
- Continue watching — position synced to DB, resumes cross-device
- Series episode selector with per-episode view tracking
- Trailer autoplay on poster card hover

**Subscription & Payments**
- Plans: Monthly ₹99 · Annual ₹599 · Family ₹999
- Razorpay order flow with 4-step backend verification (HMAC + order fetch + amount + user ownership)
- Webhook handlers: `payment.captured`, `subscription.charged`, `subscription.halted/cancelled`
- Grace period, trial, and lapsed states on `User`

**Content & Search**
- Films, Series (episodic), Documentaries
- Community star ratings (1–5), stored per-user in `UserRating`, aggregated on `Content`
- Two-stage search: prefix regex (short) → `$text` ranked (long)
- Curated shelves managed from Admin Studio

**Creator Studio** (`/creator-studio`)
- Application → approval workflow
- Content submission (Film/Series/Documentary) with admin review
- Analytics: 7-day view trend, hour histogram, audience geography (geoip), episode retention, health scores, rank deltas
- Revenue dashboard: tier-based share (60–75%), monthly earnings, payout history

**Admin Studio** (`/admin`)
- Content CRUD, poster/backdrop upload via Cloudinary
- CDN Stream collection sync + bulk video import
- Async upload pipeline with live job queue
- Creator application review and submission approval
- **Revenue dashboard**: platform subscription charts (monthly bars, plan donut, subscriber health) + creator payout section (top-creator bars, tier badges, earnings table, payout processing)
- Creator earnings calculation (monthly, view-based, tier-aware) and batch payout processing

**Analytics (DB-backed)**
- `ViewEvent` — per-play events with hour, day-of-week, Indian state, device, 1-year TTL
- `ContentRankSnapshot` — daily rank snapshots for ▲▼ delta badges
- `GET /api/admin/revenue` — subscription totals, plan breakdown, 12-month trend, subscriber health, creator summary — all from DB aggregations

---

## Security

- Video GUIDs never exposed to public or unauthenticated endpoints
- CDN server Token Auth prevents direct URL sharing
- Razorpay webhook HMAC verified before any DB write; `subscription.charged` is idempotent
- `helmet` + per-route `express-rate-limit` on backend
- Firebase ID token verified server-side on every protected request (`checkRevoked: true`)

---

## What's Still To Do

- Razorpay recurring subscription object (auto-renewal wiring)
- Family plan seat management
- Recommendation engine
- Subtitle/caption track support (WebVTT)
- iOS & Android apps
