# Dhara Streaming

Dhara is a full-stack OTT streaming app for Bengali content.

- Frontend: `React + Vite + Zustand + CSS Modules`
- Backend: `Node.js + Express + MongoDB + Firebase Admin`
- Auth: `Firebase Auth` with backend profile upsert
- Payments: `Razorpay`

## Repository Layout

```text
dhara-streaming/
├── frontend/                 # React client
├── backend/                  # Express API
├── config/secrets/           # Profile-based env files (dev/staging/prod)
└── package.json              # Root helper scripts
```

## Quick Start

### 1) Install dependencies

```bash
npm run install:all
```

### 2) Configure environment

Set your profile secrets in:

- `config/secrets/dev/.env.dev`
- `config/secrets/staging/.env.staging`
- `config/secrets/prod/.env.prod`

Backend service account JSON should be placed under the matching profile folder in `config/secrets/...`.

### 3) Run locally

```bash
npm run dev
```

This starts:

- backend on `http://localhost:4000`
- frontend on Vite default dev port

## Root Scripts

- `npm run dev` : starts backend + frontend in parallel
- `npm run install:all` : installs dependencies for both apps
- `npm run seed` : seeds sample content into MongoDB

## Core Flows

- User logs in via Firebase
- Frontend sends Firebase ID token to `POST /api/auth/login`
- Backend verifies token and creates/updates user profile in MongoDB
- Protected routes (`/api/user/*`, `/api/payments/*`) require auth
- Profile page is available at `/profile` after login

## Notes

- Keep secrets out of git.
- `frontend/README.md` contains UI-specific notes and roadmap details.
