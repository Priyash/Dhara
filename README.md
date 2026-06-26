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
| `ViewEvent` | Per-play events (hour, state, device) — 90-day TTL |
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

> **Redis:** Not required for a single instance, but **required before adding a second instance**. Without it, the in-memory response cache and rate-limiter state are not shared between instances — each instance gets its own disconnected copy.

---

## Scaling

### Capacity at current configuration

| Metric | Value |
|--------|-------|
| Concurrent users (peak) | ~6,650 |
| Daily active users | ~320K |
| Hard ceiling | MongoDB connection pool (100 connections) |
| Single-instance? | Yes — Redis required before running 2+ instances |

Bottleneck math: 100 pool connections × (1,000 ms ÷ 35 ms avg query latency) = 2,857 queries/sec. An authenticated session costs ~7.3 queries weighted across cached and uncached endpoints → ~6,650 concurrent users max on one instance.

---

### Tier 1 — up to 50K DAU ✅ Ready now

No infrastructure changes needed. The current single-instance setup handles this comfortably with headroom.

---

### Tier 2 — up to 500K DAU ✅ Implemented

All code changes are already in the codebase. The only remaining step is **adding Redis** — one environment variable in the Render dashboard.

**What's already done in code:**
| Change | File | Impact |
|--------|------|--------|
| Per-user cache for `/shelves` | `recommendations.js` | 11 DB queries → 0 for returning users (60 s TTL per user ID) |
| Singleflight on cache misses | `cache.js` | Concurrent cache misses collapse to one DB call instead of N |
| LRU eviction + 5K entry cap | `cache.js` | In-memory cache can't grow unbounded and crash the process |
| `GET /api/content/:id` cached | `content.js` | Detail page load: 0 DB queries on cache hit (5 min TTL) |
| MongoDB pool 100 → was 20 | `mongodb.js` | 5× more concurrent connections |
| JobLock TTL index | `JobLock.js` | Crashed instances auto-release their lock; no stuck jobs |
| Reel upload concurrency cap (3) | `reels.js` | 100 simultaneous uploads can't exhaust the connection pool |
| Archive import concurrency cap (3) + timeout | `archiveImportWorker.js` | Background imports can't starve user requests |
| InteractionEvent TTL 180 d → 30 d | `InteractionEvent.js` | Caps collection at ~75M docs instead of 900M at 500K users |
| ViewEvent TTL 1 yr → 90 d | `ViewEvent.js` | Caps collection at ~225M docs instead of 1.8B |
| Renewal reminder pagination + rate limit | `subscriptionExpiry.js` | Reminder job processes 100 users/batch at 1 email/sec |
| Payment activation in DB transaction | `payments.js` | No more "charged but not subscribed" on network failure |
| Covering indexes with `isDeleted` | `Content.js` | Hot browse path no longer fetches full docs to check soft-delete |

**The one thing left to do — add Redis:**

1. Create a free Redis instance at [Upstash](https://upstash.com) (free tier: 10K commands/day; paid: ~$0.20 per 100K commands)
2. Copy the `REDIS_URL` (use the `rediss://` TLS URL)
3. Add it to the Render dashboard under **Environment** → `REDIS_URL`
4. Redeploy — the backend auto-detects it on startup

Once Redis is set:
- Rate limiting is shared across all instances (brute-force protection works correctly)
- Response cache is shared across all instances (no thundering herd per instance)
- You can safely add a second Render instance

**Cost to run Tier 2 on Render:**

| Item | Cost |
|------|------|
| Render Starter instance (current) | $7/mo |
| Upstash Redis (free tier covers ~500K DAU) | $0–5/mo |
| Second Render instance (optional, only if CPU-bound) | +$7/mo |
| **Total** | **$7–19/mo** |

A second Render instance is only needed if CPU becomes the bottleneck (unlikely before 500K DAU — the DB pool is the real ceiling). Add Redis first and monitor before adding compute.

---

### Tier 3 — up to 1M DAU 🗺 Roadmap

These are the remaining engineering items once you're past 500K DAU:

**Database**
- [ ] MongoDB Atlas upgrade to M30+ tier with replica set reads offloaded to secondaries
- [ ] Shard `ViewEvent` on `{ viewedAt: 1, contentId: 1 }` — collection hits ~225M docs at 500K users; 1M users doubles it
- [ ] Shard `InteractionEvent` on `{ userId: 1, createdAt: -1 }`
- [ ] Pre-compute hourly analytics aggregates into a `MaterializedAnalytics` collection so `/admin/monitor` reads rows instead of scanning millions of ViewEvents live

**Caching**
- [ ] CDN-level caching for anonymous `/shelves` and `/api/content` — set `public, s-maxage=60` and let Vercel/Cloudflare cache at the edge; backend only handles authenticated traffic
- [ ] Cache `/api/content/:id/stream` validation per user+content (5 min TTL) — eliminates the DB hit on every video play

**Recommendations**
- [ ] Replace the 5-query `buildGenreRows` + `buildBecauseYouWatched` with a single `$lookup` aggregation pipeline (11 queries → 4)
- [ ] Move `buildTop10ThisWeek` to a pre-computed job (runs every 15 min, writes to Redis) — Top 10 doesn't need to be live

**Jobs**
- [ ] Replace `setInterval` job scheduler with BullMQ for reliable queuing, retries, and a job dashboard
- [ ] Add job health endpoint (`GET /api/admin/jobs/health`) that alerts if a job hasn't run in 2× its expected interval

**Frontend**
- [ ] Add a Service Worker (Workbox) to cache the JS/CSS bundle — saves ~100 GB/day of repeat downloads at 1M DAU
- [ ] Virtual scrolling on Browse page (`react-window`) — 500+ DOM nodes with HLS.js attached currently causes scroll jank
- [ ] Batch the 3 parallel home page API calls into a single `GET /api/home` endpoint

**Infrastructure**
- [ ] Horizontal scaling: 2–5 Render instances behind a load balancer (enabled by Redis already being in place)
- [ ] Elasticsearch (or MongoDB Atlas Search) for full-text search — MongoDB `$text` index scans linearly at 10M+ content docs
- [ ] Dedicated MongoDB connection pooler (e.g. pgBouncer equivalent via Atlas proxy) to handle connection spike from 5 instances

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

For infrastructure and scalability items see the [Scaling → Tier 3 roadmap](#tier-3----up-to-1m-dau--roadmap) above.

---

## License

MIT
