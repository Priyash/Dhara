# Thumbnail & Trailer Pipeline — Build Design

Status: **Proposed** · Owner: TBD · Last updated: 2026-06-27 (increments 1–5 implemented + hardening review — see §9)

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

> ### ⚠️ v1 scope discipline — read this first
>
> The valuable, right-sized spine of this design is:
> **extraction → human-approved grid → variant serving → `variantId`
> attribution.** Build *that* and nothing more for v1.
>
> The over-engineering all lives in the **optional intelligence layers**. In v1
> the **creator is the scorer** (they approve from the grid), so none of the ML
> is load-bearing yet. Do **NOT** build these until real CTR data proves they're
> needed:
>
> - ❌ Face detection / CLIP aesthetic scoring (§3.3) — sharpness + timeline
>   spread is enough to avoid garbage.
> - ❌ Epsilon-greedy bandit (§3.6) — with zero impressions it *is* random;
>   round-robin is the whole v1.
> - ❌ Subject cutout + color grade (§3.4) — frame + scrim + shaped text + logo
>   is the v1 composite.
>
> Keep these as v2 notes, not v1 tasks. Each section below carries a **v1 scope**
> line restating where the floor is.

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

> **v1 scope.** Trim two things: start the status enum at **3 states**
> (`candidate` / `live` / `rejected`) — add `approved`/`archived` only when a
> workflow needs them; and compute `ctr`/`cvr` **on read** instead of
> precomputing the `stats` rollup until volume makes that slow. The separate
> `ArtworkJob` queue is optional — reuse the `UploadJob` pattern first.

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

> **v1 scope — biggest over-engineering trap.** Build **only Laplacian sharpness
> + spread picks across the timeline** (avoid near-black/near-duplicate frames).
> That's ~20 lines and enough, because the **creator is the scorer** — they pick
> from the grid in §3.5. **Do NOT** build face detection (ONNX/OpenCV) or the
> CLIP aesthetic score for v1; they drag a model-serving dependency in for
> marginal lift. Revisit only if CTR data shows the candidate frames are weak.

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

> **v1 scope.** Keep **all** the Bengali text-shaping rigor — that's the moat,
> not over-engineering. But the v1 composite is just **frame → bottom gradient
> scrim → shaped title text → logo.** **Do NOT** build the subject cutout
> ("push a face forward" = background removal, another ML/API dependency) or the
> color-grade/vignette layer until the basic composite is proven to convert.

### 3.5 Creator approval UI

Slots into `frontend/src/pages/CreatorStudio.jsx`: a grid of candidate variants
per title with approve / reject. Approving flips `candidate → approved`;
promoting one or more to `live` makes them eligible to serve. Backend routes
hang off `backend/src/routes/creator.js`.

### 3.6 Serving + attribution (the half that mostly already exists)

- **Selection.** When a rail renders a card, pick among that title's `live`
  variants. **v1: random / round-robin only.** v2: epsilon-greedy bandit keyed on
  the per-variant `stats.ctr`/`cvr`. Selection can be server-side (decided when
  the rail payload is built in `content.js` / `recommendations.js`) so the same
  user sees a stable variant within a session.

> **v1 scope.** Round-robin is the *whole* selection story for v1 — **do NOT**
> build the bandit. With zero impressions a bandit is just random with extra
> code; it only earns its keep once variants have accumulated real per-variant
> volume. The genuinely valuable, near-free part of this section is the
> `variantId` wiring below — that's the spine, build that.
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

> **Implementation status.**
> - ✅ **Increment 1 (foundation, dormant)** — `ThumbnailVariant` model,
>   `variantId` on `InteractionEvent` (+ ingest whitelist), admin CRUD +
>   read-time stats, backup/restore registration.
> - ✅ **Increment 2 (activation, CTR loop)** — `live` variants attached to the
>   `GET /api/content` rails (one cached batch query, dormant when none);
>   `PosterCard` picks one stably per session (`chooseThumbnailVariant`),
>   overrides the poster, and attributes the **impression** and a new **`click`**
>   event by `variantId`. Admin stats now report CTR = clicks / impressions.
>   Downstream `play`/`completion` attribution (needs the variant threaded
>   across navigation) is intentionally deferred.
> - ✅ **Increment 3 (admin review grid)** — a per-title "Artwork" modal in the
>   admin Content Library (`ThumbnailVariantModal`) to seed variants by URL,
>   promote to `live` / reject / delete, and watch per-variant
>   impressions / clicks / CTR.
> - ✅ **Increment 4 (creator review grid)** — the same modal, reused on the
>   creator's own approved titles in `CreatorStudio` ("Artwork" action), backed
>   by ownership-scoped `/api/creator/.../thumbnail-variants` routes. The modal
>   is now backend-agnostic (takes an `api` prop), and the read-time stats
>   aggregation is shared by both surfaces via `utils/variantStats.js`.
> - ✅ **Increment 5 (frame extraction — gated/dormant)** — `services/frameExtraction.js`
>   grabs evenly-spaced frames from a title's Bunny MP4 (input-seek, no full
>   download), uploads them to Cloudinary, and writes them as `candidate`
>   variants. Admin "Generate from video" button → `POST /api/admin/thumbnail-variants/extract`.
>   **Hard-gated and off by default** (see §7 config) — returns
>   `{ configured: false }` and spawns nothing unless explicitly enabled with
>   ffmpeg present. NOT wired into the upload pipeline. v1 is deliberately dumb:
>   even spacing, no scene detection, no ML scoring (the human is the scorer).


1. **Attribution slice (lowest risk, highest leverage).** `ThumbnailVariant`
   model + `variantId` on `InteractionEvent`/ingest/`PosterCard` + round-robin
   serving among manually-seeded variants. Proves the measurement loop end-to-end
   before investing in production workers.
2. **Extraction skeleton.** Bunny MP4 re-pull + ffmpeg scene cuts +
   **sharpness-only** scoring → candidate stills (no ML scoring, no compositing).
3. **Compositing.** node-canvas templates + the Bengali shaping gate-test +
   Cloudinary upload → `candidate` variants. **Basic composite only** (frame +
   scrim + text + logo).
4. **Creator approval UI.**
5. **Phase 2 trailer assembly.**

Everything explicitly deferred to "v2 / once data justifies it" — ML scoring
(face/CLIP), the epsilon-greedy bandit, subject cutout + color grade, and a
per-variant analytics dashboard — sits **after** step 5 and is gated on real CTR
volume, not on a calendar.

---

## 7. Open questions / risks

- **Enabling frame extraction (increment 5).** It is dormant until **both**:
  - `ARTWORK_EXTRACTION_ENABLED=true` is set, and
  - an `ffmpeg` binary is present on the host (probed once, lazily, and only if
    the flag is on — with the flag off, ffmpeg is never invoked).

  Optional: `BUNNY_STREAM_MP4_RESOLUTION` (default `720p`) selects which Bunny
  MP4-fallback rendition to seek frames from. None of these are secrets, so they
  are not added to the secret `.env` templates — set them on the host when you
  want to switch the feature on.
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

---

## 8. Bengali-retention innovation roadmap

The thumbnail/trailer pipeline is one expression of a broader thesis: **Dhara's
moat is doing the Bengali-specific things horizontal platforms (Netflix,
YouTube, Prime) won't bother to do.** The compositing discipline — shaping
Indic conjuncts correctly — is the same instinct applied to artwork. This
section captures four further bets in that vein. Build order is deliberately
*not* fixed here; the recommendation is to lead with Banglish search.

### 8.1 Banglish (transliteration-aware) search — *recommended wedge*

**Problem.** Search today is a plain regex / `$text` match on the title
(`backend/src/routes/search.js:44,65` over `title`/`desc`/`genre`), so the query
script must match the stored script. But Bengali users overwhelmingly type
**Romanized Bengali ("Banglish")** on phones — `bhalobashar bari`,
`premer golpo` — because Bengali keyboards are painful. A title stored as
ভালোবাসার বাড়ি then returns **nothing**, and the user bounces at the front door.

**Why it's defensible.** Horizontal platforms do Bengali transliteration poorly;
this is the search-bar equivalent of the per-script compositing moat.

**It's measurable before building.** `SearchLog` already records `query`, `lang`,
and `resultCount` (`search.js:75`). A one-off audit of zero-result Romanized
queries sizes the lost traffic today — do this first to justify the work.

**Build.** A transliteration normalizer (ITRANS/Avro-style) that maps Bengali
script, Romanized Bengali, and English onto a single phonetic `searchKey` per
`Content`, indexed and backfilled once. Queries get normalized the same way
before matching, with fuzzy tolerance for spelling drift. **No new infra, no
model training.**

> **v1 scope.** Don't build a *perfect* bidirectional transliterator — that's the
> trap here. A rule-based phonetic folding (lookup table + loose vowel/consonant
> collapsing) captures most of the value; favour recall over precision and let
> the unit tests pin the known pairs. A full Avro-grade engine is a v2 concern.

- Gating test: a set of known Banglish ↔ Bengali ↔ English title pairs that must
  all resolve to the same result.
- Risk: transliteration is many-to-many; keep the normalizer rule-based and
  unit-tested, and prefer recall (show more) over precision in search.

### 8.2 "Utsab" festival-aware auto-curation

**Problem.** `CuratedShelf` (`backend/src/models/CuratedShelf.js`) is static —
`isActive` + `displayOrder`, no time awareness. Bengali engagement is strongly
seasonal (Durga Puja, Poila Boishakh, Saraswati Puja, Pohela Falgun).

**Build.** Add `activeFrom` / `activeTo` and a `festivalTag` to `CuratedShelf`;
a small scheduled check (reuse the `withJobLock` pattern) flips shelves live and
retires them on the Bengali calendar. Festival title-cards are composited in
Bengali via the Phase-1 thumbnail pipeline, so this reuses §3.4 directly.

**Effort:** low–medium. **Signal:** high cultural relevance, recurring.

### 8.3 AI Bengali recaps — "এখনো পর্যন্ত" (the story so far)

**Problem.** Bengali serial dramas are a **daily ritual**; lapsed viewers lose
the thread and churn.

**Build.** Generate a short Bengali-language "story so far" recap per
series/season from episode metadata and subtitles (`subtitleUrl` already exists
on episodes and root content) via a hosted LLM, surfaced on the title page and
as a catch-up rail. Drives daily return.

**Effort:** medium. **Dependency:** subtitle/synopsis coverage; gate generation
on availability and always allow human edit before publish (same
approve-before-publish discipline as artwork).

> **Reality-check before committing a build slot.** Run a one-query audit of how
> many titles actually have `subtitleUrl` populated. If coverage is sparse this
> is low-value until subtitles exist — don't build the recap pipeline ahead of
> the data it feeds on.

### 8.4 "Adda" (আড্ডা) social watch layer

**Problem.** Adda — leisurely shared conversation — is core Bengali culture, and
serial-drama audiences are highly social. Solo watching leaves session length
and return on the table.

**Build.** A lightweight live-reaction / group-watch layer on serial dramas,
building on the existing `Comment` model and `ActiveStream`. Start async
(threaded reactions pinned to timestamps) before committing to real-time, which
is the largest infra bet of the four.

**Effort:** high (real-time). **Bet size:** largest; sequence last.

### 8.5 Suggested sequencing

1. Banglish search — front door, measurable, no new infra.
2. Utsab festival rails — reuses the thumbnail pipeline; recurring seasonal lift.
3. AI Bengali recaps — daily-return driver once subtitle coverage is adequate.
4. Adda social layer — highest effort; sequence after the measurement loop and
   the above are in place.

---

## 9. Hardening review (post-increment-5)

A correctness/security pass over increments 1–5. Fixes applied:

- **Public browse rails can't be broken by the artwork layer.** `attachLiveVariants`
  in `content.js` is now fully self-contained in a try/catch — any failure
  (DB hiccup on the variant collection, etc.) logs and degrades to the default
  posters instead of 500-ing the homepage/Browse content listing. The
  enhancement is strictly non-essential to the core path.
- **Attribution index made truly small.** The `InteractionEvent.variantId` index
  was changed from a compound *sparse* index to a *partial* index
  (`partialFilterExpression: { variantId: { $type: 'objectId' } }`). A compound
  sparse index would still index every event (because `eventType` is always
  present), defeating the goal; the partial filter indexes only the tiny subset
  of events that actually carried a served variant.
- **Broken variant art never hides the original.** `PosterCard` now has a
  resilience chain — variant image → original poster → palette. A dead variant
  URL falls back to the title's real poster instead of a blank card. Covered by
  new tests.

### Known gaps / recommendations

1. ✅ **RESOLVED — Creator-set-live moderation + arbitrary external image URLs.**
   `utils/variantImage.js` now restricts variant `imageUrl`s to https + an
   allowlist (`res.cloudinary.com`, the Bunny pull zone, and
   `ARTWORK_IMAGE_HOST_ALLOWLIST` extras), enforced on both the admin and creator
   create routes. The shared modal gained a Cloudinary **Upload** button so users
   produce an allowed URL directly — closing the tracking-pixel / moderation
   bypass.
2. ✅ **RESOLVED — `extract` ran synchronously.** The endpoint now returns `202`
   immediately and runs `generateFrameVariants` in the background with logging;
   candidates appear in the grid on the next refresh. (A durable job queue is
   still the right call before *high-volume* use, but the gateway-timeout risk is
   gone.)
3. ✅ **RESOLVED — Reel variants accepted but never served.** The admin variant
   routes now reject `itemType: 'reel'` (creator routes were already
   content-only). The model enum keeps `reel` for when reel serving is built.
4. ✅ **RESOLVED — Downstream play/completion attribution.** `PosterCard`
   remembers the served variant per content id (`rememberShownVariant`), and
   `Watch.jsx` attaches it to `play`/`view_*`/`completion` events via
   `getShownVariant` — closing the impression → click → play → completion funnel.
   The review grid now shows **CVR** alongside CTR.
5. **CTR/CVR are sampled only from the popular/Browse rail** (the only rail that
   attaches variants), so it's a biased-but-consistent sample for v1. *(By design;
   not a defect.)*
