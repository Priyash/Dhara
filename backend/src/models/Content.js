import mongoose from 'mongoose'
import { phoneticKey } from '../utils/banglish.js'

const episodeSchema = new mongoose.Schema({
  number:       { type: Number, required: true },
  title:        { type: String, default: '' },
  desc:         { type: String, default: '' },
  duration:     { type: String, default: '' },
  bunnyVideoId: String,  // Bunny Stream video GUID for this episode
  subtitleUrl:  { type: String, default: '' },  // WebVTT (.vtt) URL for this episode
  viewCount:    { type: Number, default: 0, min: 0 },
})

const seasonSchema = new mongoose.Schema({
  number:   { type: Number, required: true },
  title:    { type: String, default: '' },  // optional subtitle e.g. "The Beginning"
  episodes: [episodeSchema],
})

const contentSchema = new mongoose.Schema(
  {
    title:        { type: String, required: true },
    // Phonetic skeleton of the title for transliteration-aware ("Banglish")
    // search — kept in sync by the hooks below. See utils/banglish.js.
    searchKey:    { type: String, default: '' },
    subtitle:     String,
    archiveId:    { type: String, default: null, index: true },  // archive.org identifier, set when sourced from an import
    type:         { type: String, enum: ['Film', 'Series', 'Serial Drama', 'Documentary', 'Live'], required: true },
    duration:     { type: String, default: '' },  // Film/Documentary runtime e.g. "1h 45m"; Series/Serial Drama use episode durations
    genre:        [String],
    rating:       { type: Number, min: 0, max: 5, default: 0 },
    communityRating:      { type: Number, min: 0, max: 5, default: 0 },
    communityRatingCount: { type: Number, min: 0, default: 0 },
    isPremium:    { type: Boolean, default: false },
    isFeatured:   { type: Boolean, default: false },
    badge:        { type: String, default: null },   // e.g. 'NEW'
    desc:         String,
    palette:      String,                            // CSS gradient fallback when no poster
    bunnyVideoId: String,                            // Bunny Stream video GUID
    posterUrl:    String,                            // Cloudinary portrait image (2:3)
    backdropUrl:  String,                            // Cloudinary landscape image (16:9) for hero
    trailerVideoId: String,                          // optional Bunny trailer GUID
    subtitleUrl:    { type: String, default: '' },   // WebVTT (.vtt) URL — Film/Documentary root video only
    seasons:      [seasonSchema],
    cast:         [String],
    director:     String,
    releaseYear:  Number,
    contentLanguage:   { type: String, default: 'Bengali' },
    certification:     { type: String, enum: ['U', 'UA', 'A', null], default: null },
    contentWarnings:   { type: String, default: '' },   // e.g. "violence, language"
    moodTags:          { type: [String], default: [] },  // e.g. ["Quirky", "Romantic"]
    viewCount:         { type: Number, default: 0, min: 0 },
    reviewCount:       { type: Number, default: 0 },
    likeCount:         { type: Number, default: 0, min: 0 },
    dislikeCount:      { type: Number, default: 0, min: 0 },

    isPublished:  { type: Boolean, default: false },
    isDeleted:    { type: Boolean, default: false },     // soft-delete — excluded from all public queries
    featuredOrder: { type: Number, default: 0 },          // admin-defined sort for featured row

    // Creator Studio
    creatorId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    submissionStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
    rejectionReason:  { type: String, default: '' },
    revisionCount:    { type: Number, default: 0 },
  },
  { timestamps: true }
)

contentSchema.index({ title: 'text', desc: 'text', genre: 'text' })
// Transliteration-aware search lookups (utils/banglish.js).
contentSchema.index({ searchKey: 1 })

// ── Keep searchKey in sync with the title ────────────────────────────────────
contentSchema.pre('save', function (next) {
  if (this.isModified('title')) this.searchKey = phoneticKey(this.title || '')
  next()
})

function syncSearchKeyOnUpdate(next) {
  const update = this.getUpdate() || {}
  const title = update.title ?? update.$set?.title
  if (title != null) {
    if (!update.$set) update.$set = {}
    update.$set.searchKey = phoneticKey(title)
    this.setUpdate(update)
  }
  next()
}
contentSchema.pre('findOneAndUpdate', syncSearchKeyOnUpdate)
contentSchema.pre('updateOne',        syncSearchKeyOnUpdate)
contentSchema.pre('updateMany',       syncSearchKeyOnUpdate)
// Covering indexes for the hot browse path — include isDeleted so MongoDB doesn't
// have to fetch the full doc to check the soft-delete flag.
contentSchema.index({ isPublished: 1, isDeleted: 1, submissionStatus: 1, type: 1, isPremium: 1, rating: -1 })
contentSchema.index({ isPublished: 1, isDeleted: 1, submissionStatus: 1, type: 1, isPremium: 1, releaseYear: -1 })
contentSchema.index({ isPublished: 1, isDeleted: 1, submissionStatus: 1, type: 1, isPremium: 1, title: 1 })
// Popular-sort path: browse by viewCount
contentSchema.index({ isPublished: 1, isDeleted: 1, submissionStatus: 1, viewCount: -1 })
// Genre facet aggregation
contentSchema.index({ isPublished: 1, isDeleted: 1, submissionStatus: 1, genre: 1 })
contentSchema.index({ creatorId: 1, submissionStatus: 1 })
contentSchema.index({ isPublished: 1, isFeatured: 1, featuredOrder: 1 })
contentSchema.index({ isPublished: 1, badge: 1 })
// Enforce uniqueness of Bunny video GUID — sparse so null/missing GUIDs don't conflict
contentSchema.index({ bunnyVideoId: 1 }, { unique: true, sparse: true })

export const Content = mongoose.model('Content', contentSchema)
