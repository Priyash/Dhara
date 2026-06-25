# ধারা — Dhara Streaming

[![CI](https://github.com/Priyash/Dhara/actions/workflows/node-ci.yml/badge.svg?branch=development)](https://github.com/Priyash/Dhara/actions/workflows/node-ci.yml)

Bengali OTT platform — films, series, documentaries, and short-form reels.  
Viewers subscribe and watch. Creators upload and earn. Admins manage everything from a built-in studio.

---

## Stack

| Layer    | Tech                                              |
|----------|---------------------------------------------------|
| Frontend | React 18 · Vite · Zustand · CSS Modules           |
| Backend  | Node.js 20 · Express · ES Modules                 |
| Database | MongoDB + Mongoose                                |
| Auth     | Firebase Auth (email/password)                    |
| Video    | Bunny Stream (HLS, CDN token auth)                |
| Images   | Cloudinary                                        |
| Payments | Razorpay (one-time + subscriptions)               |
| Email    | Resend                                            |
| Cache    | Redis (optional — falls back to in-memory)        |

---

## Project layout

```
dhara-streaming/
├── frontend/src/
│   ├── pages/          # Home, Browse, Watch, Reels, Profile, Admin, CreatorStudio
│   ├── components/     # Navbar, VideoPlayer, PaywallModal, PosterCard, ReelUploadModal, …
│   ├── store/          # Zustand (auth + UI state)
│   ├── services/       # api.js, cloudinary.js
│   └── hooks/          # useScrolled, useUploadNotifier, useWatchlist
├── backend/src/
│   ├── routes/         # auth, content, user, payments, admin, creator, reels,
│   │                   # search, recommendations
│   ├── models/         # User, Content, UploadJob, Reel, Transaction, ViewEvent,
│   │                   # UserRating, Comment, CuratedShelf, SearchLog,
│   │                   # InteractionEvent, ContentRankSnapshot, AdminAction, …
│   ├── middleware/     # requireAuth, requireAdmin, requireSubscription, errorHandler
│   └── config/         # firebase, mongodb, cache, env
└── package.json        # Root scripts (dev, test, lint)
```

---

## Local setup

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Configure environment variables

Create two files — one for the backend, one for the frontend.

**`backend/.env`**
```
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/dhara
FIREBASE_SERVICE_ACCOUNT_BASE64=<base64 of your Firebase service account JSON>
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
BUNNY_STREAM_LIBRARY_ID=...
BUNNY_STREAM_API_KEY=...
BUNNY_CDN_PULL_ZONE=...
BUNNY_CDN_TOKEN_AUTH_KEY=...
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
ADMIN_EMAILS=you@example.com
RESEND_API_KEY=re_...
RESEND_FROM=ধারা <noreply@yourdomain.com>
FRONTEND_URL=http://localhost:5173
# Optional — without Redis, caching is in-memory (only safe with a single instance)
# REDIS_URL=rediss://default:<password>@<host>:<port>
```

**`frontend/.env`**
```
VITE_API_URL=http://localhost:4000
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_CLOUDINARY_CLOUD_NAME=...
VITE_CLOUDINARY_UPLOAD_PRESET=...
VITE_BUNNY_STREAM_LIBRARY_ID=...
```

> **How to get `FIREBASE_SERVICE_ACCOUNT_BASE64`:**  
> Firebase console → Project Settings → Service Accounts → Generate new private key.  
> Then run: `base64 -i serviceAccountKey.json | tr -d '\n'`

> **`ADMIN_EMAILS`** is a comma-separated list of email addresses that get admin access.  
> Without it, nobody can access `/admin` in production.

### 3. Run

```bash
npm run dev        # backend :4000  +  frontend :5173
```

---

## Scripts

| Command               | What it does                                  |
|-----------------------|-----------------------------------------------|
| `npm run dev`         | Backend + frontend together (development)     |
| `npm run install:all` | Install deps in both packages                 |
| `npm run lint`        | ESLint on frontend source                     |
| `npm test`            | Backend (node:test) + frontend (vitest) tests |
| `npm run seed`        | Seed sample content into MongoDB              |

---

## Features

### Viewing & Streaming

- **HLS adaptive bitrate** playback via HLS.js — quality adjusts to the viewer's connection
- **Token-signed CDN URLs** — premium video links are signed with a SHA-256 HMAC and expire after 1 hour, preventing direct URL sharing
- **Continue watching** — playback position is saved to the DB every few seconds and resumes cross-device automatically
- **Series support** — episode selector with per-episode view tracking and progress indicators
- **Trailers** — each title can have a separate trailer video that autoplays on poster card hover
- **WebVTT subtitles** — subtitle tracks can be attached per title and per individual episode
- **Stream session management** — heartbeat endpoint and active session tracking prevent abuse

### Discovery & Search

- **Curated shelves** — admin-managed content rows on the homepage (e.g. "New Releases", "Trending")
- **Genre browsing** — deduplicated genre list with filtered content views
- **Featured content** — admin can set a `featuredOrder` on titles for hero placement
- **Two-stage search** — short queries use fast prefix regex; longer queries use MongoDB `$text` for ranked full-text results
- **Popular searches** — `GET /api/search/popular` returns top queries from `SearchLog`
- **Personalised recommendations** — `GET /api/recommendations` scores content using `InteractionEvent` signals (plays, likes, searches); works for guests too

### Reels (`/reels`)

- Short-form vertical video feed (≤ 30 seconds)
- TikTok-style swipe navigation with HLS.js playback and mute toggle
- Like / unlike with optimistic counter
- Comment thread per reel with nested replies
- Hashtag display and deep-link to a single reel via `/reels/:id`
- Search reels by title and hashtag
- View event recorded after a 5-second watch threshold

### Community

- **Star ratings (1–5)** — stored per user in `UserRating`, aggregated live onto `Content`
- **Likes / dislikes** — per-user on content items with optimistic UI
- **Content rank snapshots** — daily `ContentRankSnapshot` documents power the ▲▼ delta badges admins and creators see in analytics
- **Comments** — threaded comment model on Reels with moderation hooks

### Subscriptions & Payments

- Plans: **Monthly ₹99 · Annual ₹599 · Family ₹999**
- Razorpay checkout with 4-step backend verification (HMAC + order fetch + amount check + user ownership)
- Webhook handlers: `payment.captured`, `subscription.charged`, `subscription.halted/cancelled`
- Grace period, trial, and lapsed states tracked on the `User` document
- Dynamic payment config — admin can toggle provider, switch test ↔ live mode, and enable live mode with a confirmation guard

### User Account (`/profile`)

- View and edit display name
- See active subscription plan, status, and renewal date
- Watchlist — add/remove titles, persisted to DB and synced across devices
- Continue-watching list with a "Remove" option per title

### Creator Studio (`/creator-studio`)

1. **Apply** to become a creator — fills in a profile with content types and bio
2. **Admin approves** the application
3. **Submit content** — Film, Series, or Documentary — goes into admin review before it's published
4. **Upload reels** — create, upload, edit metadata, resubmit after rejection, soft-delete
5. **Analytics**
   - *Content*: 7-day view trend, hour histogram, audience geography (GeoIP), episode retention, health scores, rank deltas
   - *Reels*: total views / likes / comments + 7-day view chart per reel
6. **Revenue dashboard** — tier-based share (60–75%), monthly earnings breakdown, payout history

### Admin Studio (`/admin`)

**Content**
- Full CRUD with type/status/genre filter chips and inline status badges (Live · Draft · Transcoding · No video)
- Poster and backdrop upload via Cloudinary
- Soft-delete with a "Deleted" view and one-click restore
- Publish guard — backend rejects publish if no video is linked
- Job-queue view with per-job progress bars; cancels in-flight jobs automatically when content is deleted

**Uploads**
- Async upload pipeline — file goes to Bunny Stream, transcoding tracked via polling
- Manual video mapping — link a pre-existing Bunny GUID to any content item or episode
- When a new video is mapped over an old one, the old Bunny video is deleted automatically (no CDN orphans)

**Archive.org Import**
- Search archive.org for public-domain or openly licensed titles by language and keyword
- Import selected titles directly into the catalog — Bunny fetches the video from archive.org's CDN, no local download needed
- Per-title import progress panel (Queued → Fetching → CDN queued → Skipped/Failed)
- Deduplication — already-imported titles are shown as disabled in search results

**Moderation & Review**
- Creator application review (approve / reject with reason)
- Content submission approval queue
- Reels moderation — list all reels with status filter, preview playback, approve / reject / delete

**Revenue & Creators**
- Subscription revenue charts: monthly bars, plan breakdown donut, subscriber health
- Creator section: top-creator earnings bars, tier badges, earnings table, batch payout processing
- Creator earnings calculated monthly based on view share and tier

**Analytics**
- Search analytics — top queries, zero-result rate, query volume over time
- Full audit log — every admin action stored in `AdminAction` with actor, action type, target, and metadata

**System Monitor**
- Live health snapshot: DB response time, memory usage, uptime, active upload jobs
- Error rate and request throughput charts (last 60 min)
- Per-route p95 latency breakdown

---

## Data models (quick reference)

| Model | Purpose |
|---|---|
| `User` | Auth, subscription state, watchlist, creator profile |
| `Content` | Films, Series, Documentaries — seasons/episodes nested |
| `Reel` | Short-form videos with creator, hashtags, stats |
| `UploadJob` | Tracks each Bunny Stream upload/transcode job |
| `Transaction` | Razorpay payment records |
| `ViewEvent` | Per-play events (hour, state, device) — 1-year TTL |
| `UserRating` | Per-user star rating; aggregated onto Content |
| `InteractionEvent` | Plays, likes, searches — feed the recommendation engine |
| `ContentRankSnapshot` | Daily rank snapshots for ▲▼ delta badges |
| `CuratedShelf` | Admin-managed homepage content rows |
| `SearchLog` | Every search query for analytics |
| `AdminAction` | Immutable audit trail for every admin mutation |
| `ArchiveImportTask` | Queue of archive.org import jobs |
| `Comment` | Threaded comments on Reels |

---

## Deployment

The backend deploys on **Render** (see `backend/render.yaml`). The frontend is a static Vite build deployable to **Vercel** or any CDN.

After deploying:
1. Set all backend env vars in the Render dashboard
2. Set `FRONTEND_URL` to your Vercel deployment URL (required for CORS)
3. Set `VITE_API_URL` in your Vercel project environment to the Render service URL
4. Add your email to `ADMIN_EMAILS` — without this you cannot access `/admin` in production

> **Redis:** Not required, but strongly recommended before scaling to 2+ backend instances. Without it, the in-memory response cache and rate-limiter state are not shared between instances.

---

## Security notes

- Firebase ID tokens verified server-side on every protected request (`checkRevoked: true`)
- CDN token auth (SHA-256 HMAC, 1-hour expiry) prevents direct video URL sharing
- Razorpay webhook signature verified before any DB write; `subscription.charged` is idempotent
- Video GUIDs are never exposed to unauthenticated endpoints
- All admin mutations written to `AdminAction` (actor, action type, target, timestamp)
- `helmet` + per-route `express-rate-limit` on all backend routes

---

## What's still to do

- Razorpay recurring subscription object (auto-renewal without manual re-checkout)
- Family plan seat management (invite and manage up to N members)
- iOS and Android apps

---

## License

MIT
