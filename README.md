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
│   ├── pages/       # Home, Browse, Watch, Reels, Profile, Admin, CreatorStudio
│   ├── components/  # Navbar, VideoPlayer, PaywallModal, PosterCard, …
│   ├── store/       # Zustand (auth + UI state)
│   ├── services/    # api.js, cloudinary.js
│   └── hooks/       # useScrolled, useUploadNotifier, useWatchlist
├── backend/src/
│   ├── routes/      # auth, content, user, payments, admin, creator, reels, search
│   ├── models/      # User, Content, UploadJob, Reel, Transaction, ViewEvent, …
│   ├── middleware/  # requireAuth, requireAdmin, requireSubscription, errorHandler
│   └── config/      # firebase, mongodb, cache, env
└── package.json     # Root scripts (dev, test, lint)
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
# Optional — without Redis, caching is in-memory (single instance only)
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

> **`ADMIN_EMAILS`** controls who can access `/admin`. Set it before running — without it, no one gets admin access in production.

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

## Key features

**Watching**
- HLS adaptive bitrate playback via HLS.js
- Continue watching — position saved and resumed cross-device
- Series episode selector with per-episode progress tracking
- Premium content locked behind subscription (token-signed CDN URLs)
- WebVTT subtitle support per title and per episode

**Reels**
- Short-form vertical video feed (≤ 30 s)
- Swipe navigation, like/comment, hashtags, view tracking

**Subscriptions**
- Plans: Monthly ₹99 · Annual ₹599 · Family ₹999
- Razorpay checkout with full webhook verification
- Grace period and lapsed-state handling on each user

**Creator Studio** (`/creator-studio`)
- Apply to become a creator → admin approves
- Upload films, series, or reels for admin review before publishing
- Analytics: views, likes, geography, episode retention, revenue share
- Earnings dashboard with payout history

**Admin Studio** (`/admin`)
- Content library: create, edit, filter, publish/unpublish, soft-delete + restore
- Video upload pipeline with live job queue and per-job progress
- Archive.org import — search and pull public-domain titles directly into the catalog
- Creator application review and submission approval
- Reels moderation with preview playback
- Revenue dashboard: subscription charts, plan breakdown, creator payouts
- Dynamic payment config (provider toggle, test ↔ live mode)
- Search analytics and full audit log

---

## Deployment

The backend is deployed on **Render** (see `backend/render.yaml`). The frontend is a static build deployable to **Vercel** or any CDN.

After deploying:
1. Set all backend env vars in the Render dashboard
2. Set `FRONTEND_URL` to your Vercel URL (needed for CORS)
3. Point `VITE_API_URL` in your frontend build to the Render service URL

---

## Security notes

- Firebase ID tokens verified server-side on every protected request
- CDN token auth (SHA-256 HMAC, 1-hour expiry) prevents direct video URL sharing
- Razorpay webhook signature verified before any DB write
- All admin actions logged to `AdminAction` (actor, type, target, timestamp)
- `helmet` + per-route rate limiting on all backend routes
