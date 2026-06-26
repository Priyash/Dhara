# Thumbnail & Trailer Pipeline — Build Design

Status: **Proposed** · Owner: TBD · Last updated: 2026-06-26

This document specifies a two-phase system for generating, approving, serving,
and A/B-attributing artwork for Dhara titles:

- **Phase 1 — Frame-first thumbnails.** Extract candidate stills from the
  creator's own footage, score them, composite a few into branded variants
  (with correctly-shaped Bengali title text), let the creator approve, serve
  the approved variants on browse rails, and attribute plays/completions back
  to whichever variant was shown.
- **Phase 2 — Trailer generation.** Reuse Phase 1's scored scene cuts to
  assemble a short trailer per title, hosted on Bunny Stream via the
  already-existing `Content.trailerVideoId` slot.

The guiding principle is **frame-first, not gen-first**: the primary visual
source is the creator's real footage (rights-clean, near-free, higher-converting
for episodic content). AI image generation is a *secondary, swappable* path
reserved for stylized key-art where no raw frame works. **We train nothing in
Phase 1.**

---

## 1. Why this fits Dhara today

A large fraction of the loop already exists. This design is mostly *wiring
together* existing infrastructure plus two new workers.

| Loop stage | Existing infrastructure | File |
| --- | --- | --- |
| Upload → transcode | Bunny Stream upload + encode-status polling | `backend/src/services/bunnyUpload.js` |
| Image store / transform / CDN | Cloudinary (configured both ends); posters already served via `cloudinaryTransform(..., 'g_auto,f_auto,q_auto')` | `backend/src/config/cloudinary.js`, `frontend/src/services/cloudinary.js` |
| Poster / thumbnail slots | `Content.posterUrl` / `backdropUrl`, `Reel.thumbnailUrl` | `backend/src/models/Content.js`, `backend/src/models/Reel.js` |
| Trailer slot (Phase 2) | `Content.trailerVideoId` already defined | `backend/src/models/Content.js:38` |
| Impression logging | `PosterCard` fires `impression` at ≥50% viewport via `IntersectionObserver` | `frontend/src/components/PosterCard.jsx:29` |
| Play / completion attribution | `InteractionEvent` already has `impression`/`play`/`view_3s`/`view_50`/`completion` with dedup, `source`, `sessionId` | `backend/src/models/InteractionEvent.js` |
| Event ingest | `POST /api/recommendations/events` validates + dedups + persists | `backend/src/routes/recommendations.js:105` |
| Background-job pattern | `withJobLock(...)` + worker loops (`archiveImportWorker`, `payoutJob`) | `backend/src/config/jobLock.js` |

**The entire "serve a variant → log impression → attribute play/completion"
half of the loop is effectively one field away** (`variantId` on
`InteractionEvent`). The net-new work is concentrated on the *production* half:
extraction, scoring, and compositing.

---

## 2. The one real architectural gap — raw source is not retained

Uploads stream to a **temporary disk file → Bunny Stream → the temp file is
deleted** (`backend/src/routes/reels.js:434`, `backend/src/routes/admin.js:974`).
After upload completes, **only Bunny holds the footage.** So the
frame-extraction worker cannot assume a local source file exists.

### Decision: re-pull Bunny's encoded MP4 (Option A)

The extraction worker downloads the transcoded MP4 from Bunny Stream (requires
enabling Bunny's **MP4 fallback** rendition on the library), runs scene
detection against that copy, and discards it. This decouples extraction from the
upload request entirely — it can run minutes or hours later, retry safely, and
never races the temp-file cleanup.

Alternatives considered:

- **Option B — tee the temp file during upload.** Avoids a re-download but
  couples extraction to the upload request lifecycle and risks the 30-min
  cleanup window. Rejected for v1; revisit only if Bunny egress cost matters.
- **Bunny thumbnail-at-timestamp API (no ffmpeg).** Bunny can mint a thumbnail
  at any timestamp natively. This gives **interval sampling, not scene detection
  or scoring** — acceptable as a day-0 stub to unblock the serving/attribution
  slice, but not the real extraction path.

ffmpeg is therefore the **only genuinely new infra dependency** introduced by
this design.

---

## 3. Phase 1 architecture

```
 creator upload (existing)
        │
        ▼
 [extract-worker]  ── pulls Bunny MP4 ── scene cuts (PySceneDetect/ffmpeg)
        │                                 ~30 candidate frames
        ▼
   score each frame (face present · Laplacian sharpness · aesthetic/CLIP)
        │   keep top 3–4
        ▼
 [composite-worker] ── 2–3 layout templates × top frames
        │              node-canvas: base → subject cutout → grade → TEXT → logo
        ▼
   ~8 candidate variants  (status: candidate)  → Cloudinary
        │
        ▼
 creator approval grid (CreatorStudio)  → approve subset (status: approved→live)
        │
        ▼
 browse rails serve a chosen variant + log impression (variantId)
        │
        ▼
 play & completion attributed to the served variant  (InteractionEvent.variantId)
        │
        ▼
 per-variant CTR / completion rollup  → dashboard, bandit input
```

### 3.1 Data model — `ThumbnailVariant`

New collection. One document per generated variant.

```
ThumbnailVariant {
  _id
  itemType        'content' | 'reel'
  itemId          ObjectId            // -> Content or Reel
  seasonNumber    Number | null       // episode-level art, optional
  episodeNumber   Number | null

  source          'frame' | 'ai-genart'
  sourceFrameTs   Number | null       // seconds into footage (frame source)
  templateId      String              // which layout template produced it

  imageUrl        String              // Cloudinary URL of the final composite
  width / height  Number

  status          'candidate' | 'approved' | 'live' | 'archived' | 'rejected'
  scores {                            // from the scoring stage
    sharpness     Number
    faceCount     Number
    aesthetic     Number
    composite     Number              // weighted total used for ranking
  }

  // attribution rollup (denormalized; recomputed periodically)
  stats {
    impressions   Number
    plays         Number
    completions   Number
    ctr           Number              // plays / impressions
    cvr           Number              // completions / impressions
    updatedAt     Date
  }

  createdBy       ObjectId | null
  approvedBy      ObjectId | null
  timestamps
}
```

Indexes: `{ itemType, itemId, status }`, `{ status, 'scores.composite': -1 }`.

The **live** poster a title actually ships is still `Content.posterUrl` /
`Reel.thumbnailUrl`; a `live` ThumbnailVariant overrides it at serve time. This
keeps the existing fields authoritative for anything that doesn't go through the
variant path (search, share cards, etc.).

### 3.2 Extraction worker

- Trigger: a title transitions to `ready` in `syncProcessingJob`
  (`bunnyUpload.js`) → enqueue an extraction job (reuse the `UploadJob`-style
  pattern or a new `ArtworkJob` collection).
- Pull Bunny MP4 fallback → run PySceneDetect (content-aware) **or** ffmpeg
  `select='gt(scene,0.4)'` to get scene-cut timestamps → sample ~30 frames.
- Discard the MP4 when done.
- **ffmpeg is invoked via a child process or `fluent-ffmpeg`; no Python sidecar
  required if we stay with ffmpeg scene detection.** PySceneDetect is the
  upgrade path if ffmpeg's scene filter proves too noisy.

### 3.3 Scoring

Per candidate frame, cheap heuristics combined into one `composite` score:

- **Face present** — lightweight detector (e.g. a small ONNX face model run in
  Node, or OpenCV in a worker). Faces convert; weight them up.
- **Sharpness** — variance of the Laplacian (reject motion-blur frames).
- **Aesthetic** — off-the-shelf aesthetic/CLIP score (hosted or local small
  model), optional for v1.

Keep the top 3–4. Tuning the weights is an iteration target once real CTR data
exists.

### 3.4 Compositing worker — and the Bengali text rule

Build the thumbnail in layers:

1. base visual (frame or, secondarily, AI key-art)
2. optional subject cutout to push a face forward
3. color grade / vignette for contrast
4. **text layer composited programmatically**
5. logo / badge

**Non-negotiable: no model ever renders the Bengali title.** Title text is
always composited by us.

**Engine decision: node-canvas (Cairo + Pango + HarfBuzz).** The stack is
already all-Node, and node-canvas shapes Indic conjuncts correctly through
Pango/HarfBuzz out of the box — this sidesteps the Pillow + libraqm trap (Pillow
silently mis-orders conjuncts like `ক্ষ`, `ত্র`, `জ্ঞ` unless built against
libraqm) *and* avoids introducing a Python service purely for text rendering.

- Fonts: **Noto Sans Bengali** for body-safe text, a proper display face for
  the title.
- **First test case, before anything else ships:** render `ক্ষ`, `ত্র`, `জ্ঞ`
  plus a juktakkhor-heavy title and eyeball the glyph order. This is a gating
  acceptance test, not a nice-to-have.

Outputs (~8 = top frames × templates) are uploaded to Cloudinary and written as
`candidate` ThumbnailVariant docs.

### 3.5 Creator approval UI

Slots into `frontend/src/pages/CreatorStudio.jsx`: a grid of candidate variants
per title with approve / reject. Approving flips `candidate → approved`;
promoting one or more to `live` makes them eligible to serve. Backend routes
hang off `backend/src/routes/creator.js`.

### 3.6 Serving + attribution (the half that mostly already exists)

- **Selection.** When a rail renders a card, pick among that title's `live`
  variants. v1: random / round-robin. v2: epsilon-greedy bandit keyed on the
  per-variant `stats.ctr`/`cvr`. Selection can be server-side (decided when the
  rail payload is built in `content.js` / `recommendations.js`) so the same user
  sees a stable variant within a session.
- **Impression.** `PosterCard.jsx:29` already fires `impression`. Add the chosen
  `variantId` to that call.
- **Play / completion.** Already logged as `InteractionEvent`. Add `variantId`
  so the play/completion is attributed to whatever variant the user saw.

Concrete wiring (small, well-bounded):

1. `InteractionEvent` — add `variantId: ObjectId | null` + index.
2. `normalizeEventPayload` (`recommendations.js:86`) — whitelist `variantId`.
3. `recordInteractionEvent` call sites — pass the served `variantId`.
4. Rollup job — periodically aggregate `InteractionEvent` by `variantId` into
   `ThumbnailVariant.stats` (reuse the `withJobLock` scheduled-job pattern).

---

## 4. Phase 2 — Trailer generation

Phase 2 is **not** a separate pipeline. The scored scene cuts produced in Phase
1 are exactly the candidate trailer segments. Assembly:

- Select the top-N highest-scoring scene segments (with shot-length and spacing
  constraints) → concatenate via ffmpeg → optional title card / music bed →
  encode → upload to Bunny Stream → write the GUID to the already-existing
  `Content.trailerVideoId`.
- Same approve-before-publish discipline as thumbnails.

No diffusion/video-gen model in Phase 2 either — it's an editorial assembly of
real footage. The Phase 1 scene-detection investment is what makes this cheap.

---

## 5. Net-new components summary

| Component | New? | Notes |
| --- | --- | --- |
| `ThumbnailVariant` model | New | + optional `ArtworkJob` queue model |
| Extraction worker | New | Bunny MP4 re-pull + ffmpeg/PySceneDetect — **brings ffmpeg into the stack** |
| Frame scoring | New | face / Laplacian / aesthetic heuristics |
| Compositing worker | New | node-canvas templates + Bengali shaping |
| Creator approval grid | New | extends `CreatorStudio.jsx` + `creator.js` routes |
| Variant selection on rails | New | random → epsilon-greedy bandit |
| `variantId` attribution | **Tiny** | one field across `InteractionEvent` + ingest + `PosterCard` |
| Per-variant rollup job | New | aggregate into `ThumbnailVariant.stats` |
| Trailer assembly (Phase 2) | New | reuses Phase 1 scene cuts → `trailerVideoId` |

---

## 6. Suggested rollout order

1. **Attribution slice (lowest risk, highest leverage).** `ThumbnailVariant`
   model + `variantId` on `InteractionEvent`/ingest/`PosterCard` + round-robin
   serving among manually-seeded variants. Proves the measurement loop end-to-end
   before investing in production workers.
2. **Extraction skeleton.** Bunny MP4 re-pull + ffmpeg scene cuts + scoring →
   scored candidate stills (no compositing yet).
3. **Compositing.** node-canvas templates + the Bengali shaping gate-test +
   Cloudinary upload → `candidate` variants.
4. **Creator approval UI.**
5. **Bandit selection + per-variant dashboard.**
6. **Phase 2 trailer assembly.**

---

## 7. Open questions / risks

- **Bunny MP4 fallback** must be enabled on the library, and egress cost of
  re-pulling encoded video per title should be sized.
- **ffmpeg in the runtime** — confirm the host image (Render) ships ffmpeg or
  add it; decide child-process vs `fluent-ffmpeg`.
- **Face/aesthetic models** — pick run-in-Node (ONNX) vs a hosted call; keep the
  scorer swappable behind one interface.
- **Per-session variant stability** — ensure a user sees a consistent variant
  within a session so attribution isn't muddied by mid-session swaps.
- **Bengali display font licensing** — confirm the display face (beyond Noto) is
  licensed for compositing/redistribution.
- **AI key-art path** — wrap a hosted image model behind a swappable interface;
  it is secondary and out of scope for the first three milestones.
