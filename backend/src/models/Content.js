import mongoose from 'mongoose'

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
// Browsing queries: type + premium filter + sort
contentSchema.index({ isPublished: 1, submissionStatus: 1, type: 1, isPremium: 1, rating: -1 })
contentSchema.index({ isPublished: 1, submissionStatus: 1, type: 1, isPremium: 1, releaseYear: -1 })
contentSchema.index({ isPublished: 1, submissionStatus: 1, type: 1, isPremium: 1, title: 1 })
// Genre facet aggregation
contentSchema.index({ isPublished: 1, submissionStatus: 1, genre: 1 })
contentSchema.index({ creatorId: 1, submissionStatus: 1 })
contentSchema.index({ isPublished: 1, isFeatured: 1, featuredOrder: 1 })
contentSchema.index({ isDeleted: 1, isPublished: 1, submissionStatus: 1 })
contentSchema.index({ isPublished: 1, badge: 1 })

export const Content = mongoose.model('Content', contentSchema)
