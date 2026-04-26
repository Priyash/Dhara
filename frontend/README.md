# ধারা — Dhara Streaming Platform

A production-ready MVP for a Bengali OTT streaming platform, similar to Hoichoi. Built with React 18 + Vite + CSS Modules.

## Tech Stack

| Layer      | Choice                  | Why                                             |
|------------|-------------------------|-------------------------------------------------|
| Framework  | React 18                | Component model, hooks, ecosystem               |
| Bundler    | Vite 5                  | Fast HMR, ESM-native                            |
| Routing    | React Router v6         | File-based routing with nested layouts          |
| State      | Zustand                 | Minimal boilerplate, no provider hell           |
| Styling    | CSS Modules             | Scoped styles, no runtime cost                  |
| Icons      | Lucide React            | Consistent, tree-shakeable                      |
| Fonts      | Playfair Display + DM Sans | Cinematic display + clean UI body font       |

## Project Structure

```
dhara-streaming/
├── index.html                   # Entry HTML with Google Fonts
├── vite.config.js               # Vite + React plugin + path alias
├── package.json
│
└── src/
    ├── main.jsx                 # ReactDOM entry, BrowserRouter
    ├── App.jsx                  # Root: routes + global overlays
    │
    ├── styles/
    │   └── globals.css          # CSS variables, resets, utilities
    │
    ├── data/
    │   └── content.js           # All mock content, plans, constants
    │
    ├── store/
    │   └── useStore.js          # Zustand global store (UI + auth state)
    │
    ├── components/
    │   ├── Navbar.jsx / .module.css
    │   ├── Hero.jsx / .module.css
    │   ├── ContentRow.jsx / .module.css
    │   ├── PosterCard.jsx / .module.css
    │   ├── SearchOverlay.jsx / .module.css
    │   ├── PaywallModal.jsx / .module.css
    │   └── ContentDetailModal.jsx / .module.css
    │
    └── pages/
        └── Home.jsx / .module.css
```

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Features (MVP)

- [x] Cinematic hero banner with mute/unmute toggle
- [x] Horizontally scrollable content rows with arrow navigation
- [x] Poster cards with hover-to-play overlay, PRO & NEW badges
- [x] Full-screen search overlay with popular tags + live filter
- [x] Content detail modal (free vs premium CTA)
- [x] Subscription/paywall modal with 3 pricing tiers
- [x] Responsive navbar (transparent → opaque on scroll)
- [x] Global state management via Zustand
- [x] CSS Modules for scoped, maintainable styles

## Roadmap

### Phase 1 — Auth & Payments
- [ ] Firebase Auth (email/password + Google OAuth)
- [ ] Razorpay integration for ₹ subscriptions
- [ ] User profile & watchlist persistence (Firestore)

### Phase 2 — Video Streaming
- [ ] HLS.js player with adaptive bitrate
- [ ] Cloudflare Stream or AWS IVS for video delivery
- [ ] Continue watching (resume position)
- [ ] Episode selector for series

### Phase 3 — Content Backend
- [ ] Sanity CMS for content management
- [ ] REST API (Node/Express or Next.js API routes)
- [ ] CDN-backed thumbnails (Cloudinary)
- [ ] Full-text search (Algolia or Typesense)

### Phase 4 — Growth Features
- [ ] Personalized recommendations (collaborative filtering)
- [ ] Push notifications (FCM)
- [ ] Social sharing & referral system
- [ ] iOS & Android apps (React Native)

## Design System

CSS variables defined in `globals.css`:

| Variable           | Value          | Usage                    |
|--------------------|----------------|--------------------------|
| `--color-bg`       | `#09090b`      | Page background          |
| `--color-surface`  | `#111115`      | Cards, modals            |
| `--color-accent`   | `#f59e0b`      | CTA, highlights          |
| `--font-display`   | Playfair Display | Headings, logo         |
| `--font-body`      | DM Sans        | All UI text              |
| `--nav-height`     | `64px`         | Layout offset            |

## Environment Variables

Create a `.env` file for secrets (never commit this):

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_PROJECT_ID=...
VITE_RAZORPAY_KEY_ID=...
VITE_ALGOLIA_APP_ID=...
```

## License

MIT
