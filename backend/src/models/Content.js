import mongoose from 'mongoose'

const episodeSchema = new mongoose.Schema({
  number:       { type: Number, required: true },
  title:        { type: String, required: true },
  duration:     String,
  bunnyVideoId: String,  // Bunny Stream video GUID for this episode
  viewCount:    { type: Number, default: 0, min: 0 },
})

const contentSchema = new mongoose.Schema(
  {
    title:        { type: String, required: true },
    subtitle:     String,
    type:         { type: String, enum: ['Film', 'Series', 'Serial Drama', 'Documentary'], required: true },
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
    episodes:     [episodeSchema],
    cast:         [String],
    director:     String,
    releaseYear:  Number,
    contentLanguage:   { type: String, default: 'Bengali' },
    certification:     { type: String, enum: ['U', 'UA', 'A', null], default: null },
    contentWarnings:   { type: String, default: '' },   // e.g. "violence, language"
    moodTags:          { type: [String], default: [] },  // e.g. ["Quirky", "Romantic"]
    viewCount:         { type: Number, default: 0, min: 0 },
    // Snapshot of viewCount at the time of the last earnings calculation.
    // Monthly delta = viewCount - viewCountSnapshot.
    viewCountSnapshot: { type: Number, default: 0, min: 0 },
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
