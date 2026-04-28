# ধারা — Dhara Streaming Platform

[![Node.js CI](https://github.com/Priyash/Dhara/actions/workflows/node-ci.yml/badge.svg?branch=development)](https://github.com/Priyash/Dhara/actions/workflows/node-ci.yml)

বাংলার গল্প, সারা বিশ্বের পর্দায় — For every Bengali heart, wherever the world has carried you.

---

## Tech Stack

| Layer        | Choice                          |
|--------------|---------------------------------|
| Frontend     | React + Vite                    |
| State        | Client-side state management    |
| Backend      | Node.js + Express               |
| Database     | MongoDB                         |
| Auth         | Firebase Auth                   |
| Payments     | Razorpay                        |
| Video        | Adaptive bitrate streaming      |
| Media CDN    | Cloud-based CDN for video & images |

---

## Repository Layout

```text
dhara-streaming/
├── frontend/                         # React + Vite client
│   └── src/
│       ├── pages/                    # Home, Browse, Watch, Profile, Admin, NotFound
│       ├── components/               # Navbar, Hero, ContentRow, PosterCard,
│       │                             #   VideoPlayer, SearchOverlay, PaywallModal,
│       │                             #   ContentDetailModal, AuthModal,
│       │                             #   VerifyEmailModal, ScreenTransition
│       ├── store/useStore.js          # Zustand global store (auth + UI state)
│       ├── services/api.js            # Axios wrapper for backend API calls
│       ├── services/cloudinary.js     # Cloudinary upload helpers
│       ├── hooks/                    # useWatchlist, useUploadNotifier,
│       │                             #   useKeyPress, useScrolled
│       └── lib/firebase.js           # Firebase app init
│
├── backend/
│   ├── server.js                     # Express app entry, middleware mount
│   └── src/
│       ├── routes/
│       │   ├── auth.js               # POST /api/auth/login (Firebase token → MongoDB upsert)
│       │   ├── content.js            # Public & authenticated content + stream endpoints
│       │   ├── payments.js           # Razorpay order creation + webhook handler
│       │   ├── user.js               # Watchlist & profile management
│       │   ├── admin.js              # Admin-only: content CRUD, Bunny upload pipeline
│       │   └── search.js             # Full-text + prefix search
│       ├── models/
│       │   ├── User.js               # User schema (subscription state, watchlist)
│       │   ├── Content.js            # Content schema (Film/Series, Bunny/Cloudinary refs)
│       │   ├── StreamCollection.js   # Bunny Stream collection mapping
│       │   └── UploadJob.js          # Async upload job tracker
│       ├── middleware/
│       │   ├── auth.js               # requireAuth, requireAdmin, requireSubscription
│       │   └── errorHandler.js       # Centralised error responses
│       └── config/
│           ├── firebase.js           # Firebase Admin SDK init
│           ├── mongodb.js            # Mongoose connection
│           ├── razorpay.js           # Razorpay client init
│           ├── cloudinary.js         # Cloudinary SDK init
│           ├── env.js                # Profile-based env loader
│           └── adminSync.js         # Firebase custom-claim helper
│
├── config/secrets/                   # Profile-based env files (never commit)
│   ├── dev/
│   ├── staging/
│   └── prod/
└── package.json                      # Root helper scripts
```

---

## Quick Start

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Configure environment

Secrets are profile-scoped and placed in `config/secrets/<profile>/`. See the internal setup guide for the full variable reference — these files are excluded from git and should never be committed.

### 3. Run locally

```bash
npm run dev
```

Starts:
- Backend on `http://localhost:4000`
- Frontend on Vite default dev port (`http://localhost:5173`)

---

## Root Scripts

| Script              | What it does                                |
|---------------------|---------------------------------------------|
| `npm run dev`       | Backend + frontend in parallel (dev profile)|
| `npm run install:all` | `npm install` in root, frontend, backend  |
| `npm run seed`      | Seeds sample content into MongoDB           |

---

## What's Implemented

### Authentication
- Firebase Auth (email/password) with email-verification gate
- On sign-in/sign-up, frontend sends Firebase ID token to `POST /api/auth/login`; backend verifies with Firebase Admin SDK and upserts the user in MongoDB
- Password reset via Firebase email link
- Verification status synced on browser tab focus / visibility change
- `isAdmin` custom claim in Firebase maps to admin-only routes on the backend

### Content Catalogue
- `Content` model supports Films and Series (with episode sub-documents)
- Fields: `title`, `type`, `genre`, `rating`, `isPremium`, `isFeatured`, `badge`, `posterUrl` (Cloudinary 2:3), `backdropUrl` (Cloudinary 16:9), `bunnyVideoId`, `cast`, `director`, `releaseYear`, `certification`, `contentLanguage`
- Text index on `title + desc + genre` for search
- `GET /api/content` — public catalogue (type / filter / sort query params)
- `GET /api/content/featured` — hero banner content
- `GET /api/content/:id` — full metadata (video GUIDs never exposed publicly)
- `GET /api/content/:id/stream` — returns HLS URL; signs URL with HMAC token for premium titles

### Subscription & Payments
- Three plans: **Monthly** (₹99 / 30 days), **Annual** (₹599 / 365 days), **Family** (₹999 / 365 days)
- `POST /api/payments/create-order` — creates a Razorpay order; frontend opens Razorpay checkout modal
- `POST /api/payments/webhook` — verifies Razorpay HMAC signature, sets `isSubscribed + subscriptionPlan + subscriptionExpiresAt` on the user document after `payment.captured`; handles `subscription.cancelled`
- `User.isSubscriptionActive` virtual checks expiry at query time
- Paywall modal and verify-email gate in the frontend guard premium content

### Video Playback
- `VideoPlayer` component uses HLS.js for adaptive bitrate streaming
- Backend returns a signed Bunny CDN HLS URL (`/playlist.m3u8?token=…&expires=…`) for premium content; unsigned URL for free content
- Bunny Token Auth (SHA-256 HMAC, 1-hour window) prevents direct URL sharing

### Search
- `GET /api/search?q=` — two-stage: prefix regex for short queries (< 4 chars), MongoDB `$text` search with relevance ranking for longer queries, regex fallback if text index is still building

### Admin Studio (`/admin`)
- Protected by `requireAdmin` middleware
- Content list with inline metadata editing (title, desc, genre, cast, ratings, posters, badges, `isPremium`, `isFeatured`)
- Bunny Stream collection sync — pulls collections from Bunny API and upserts into `StreamCollection`
- Import-from-CDN — bulk-creates `Content` documents from all Bunny videos not yet in MongoDB
- Map existing Bunny video to a content document
- Async upload pipeline: create upload job → PUT raw binary to `/api/admin/upload-jobs/:id/file` → server streams to Bunny → polls encode progress
- `useUploadNotifier` hook surfaces job status in the UI without polling

### Watchlist
- `POST /api/user/watchlist/:contentId` / `DELETE /api/user/watchlist/:contentId`
- Persisted in MongoDB `User.watchlist` (array of content ID strings)
- `useWatchlist` hook for optimistic UI updates

### Image Management
- Cloudinary used for poster and backdrop uploads
- `services/cloudinary.js` on the frontend handles direct browser-to-Cloudinary uploads
- `posterUrl` / `backdropUrl` stored on `Content` document and referenced in `PosterCard` and `Hero`

---

## Core Request Flow

```
User → Firebase Auth → ID Token
  → POST /api/auth/login
    → Firebase Admin verifyIdToken
    → MongoDB User upsert
    → { user, isSubscribed, isAdmin }

User clicks premium title
  → openPaywall()
    → email verified? → PaywallModal
    → POST /api/payments/create-order
    → Razorpay checkout modal (frontend)
    → payment.captured webhook → User.isSubscribed = true

User plays video
  → GET /api/content/:id/stream (auth + subscription check)
  → signed Bunny CDN HLS URL
  → HLS.js fetches .m3u8 directly from Bunny CDN
```

---

## Roadmap

### Phase 1 — Subscription Engine *(in progress on `feature/dhara-subscription-engine`)*
- [ ] Subscription management page (current plan, expiry date, cancel)
- [ ] Razorpay subscription object support (auto-renewal, not just one-time orders)
- [ ] Webhook for `subscription.halted` and `subscription.completed` events
- [ ] Grace-period logic (e.g. 3-day buffer after expiry before locking content)
- [ ] Family plan seat management (invite / remove family members)

### Phase 2 — Watch Experience
- [ ] Continue watching — persist and resume playback position
- [ ] Episode selector UI for Series content
- [ ] Trailer auto-play on content detail modal (using `trailerVideoId`)
- [ ] Download for offline (Bunny DRM / Widevine)
- [ ] Picture-in-picture support

### Phase 3 — Discovery & Personalisation
- [ ] Recommendation engine (collaborative filtering or content-based)
- [ ] "Because you watched…" content rows
- [ ] Personalised home feed order per user
- [ ] Content ratings & reviews (user-submitted, `reviewCount` field ready)

### Phase 4 — Platform & Growth
- [ ] Push notifications via Firebase Cloud Messaging
- [ ] Social sharing & referral codes
- [ ] Series season management in Admin Studio
- [ ] Subtitle / caption track support (WebVTT via Bunny)
- [ ] iOS & Android apps (React Native)
- [ ] Monitoring dashboard (upload job health, subscription churn, DAU)

---

## Security Notes

- Video GUIDs (`bunnyVideoId`) are never sent to unauthenticated or non-subscribing clients
- Bunny Token Auth signs HLS URLs with SHA-256 HMAC; tokens expire after 1 hour
- Razorpay webhook signature verified with HMAC before any DB write
- `helmet` + `express-rate-limit` applied globally on the backend
- Secrets are profile-scoped and excluded from git via `.gitignore`
