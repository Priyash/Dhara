import mongoose from 'mongoose'

export const REEL_MAX_DURATION_SECS = 30
export const REEL_ASPECT_RATIOS     = ['9:16', '16:9', '1:1']

const reelSchema = new mongoose.Schema(
  {
    // Ownership
    creatorId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    archiveId:   { type: String, default: null, index: true },  // archive.org identifier, set when sourced from an import

    // Human-readable metadata — creator-writable
    title:       { type: String, default: '' },
    description: { type: String, default: '' },
    hashtags:    { type: [String], default: [] },   // normalised to lowercase, no '#'
    aspectRatio: { type: String, enum: REEL_ASPECT_RATIOS, default: '9:16' },
    thumbnailUrl: { type: String, default: '' },    // Cloudinary poster frame

    // Video — assigned by upload-job only, never creator-writable
    bunnyVideoId: { type: String, default: '' },
    durationSecs: { type: Number, min: 0, max: REEL_MAX_DURATION_SECS, default: 0 },

    // State machine — mirrors Content
    isPublished:      { type: Boolean, default: false },
    isDeleted:        { type: Boolean, default: false },     // soft-delete — excluded from all public queries
    submissionStatus: {
      type:    String,
      enum:    ['pending', 'approved', 'rejected'],
      default: 'pending',
      index:   true,
    },
    rejectionReason: { type: String, default: '' },
    revisionCount:   { type: Number, default: 0 },

    // Analytics
    viewCount:            { type: Number, default: 0, min: 0 },
    viewCountSnapshot:    { type: Number, default: 0, min: 0 },  // earnings delta baseline
    likeCount:            { type: Number, default: 0, min: 0 },
    commentCount:         { type: Number, default: 0, min: 0 },
    communityRating:      { type: Number, default: 0, min: 0, max: 5 },
    communityRatingCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
)

reelSchema.index({ isPublished: 1, isDeleted: 1, submissionStatus: 1, createdAt: -1 })
reelSchema.index({ hashtags: 1 })
reelSchema.index({ creatorId: 1, submissionStatus: 1 })
reelSchema.index({ isPublished: 1, isDeleted: 1, submissionStatus: 1, viewCount: -1 })
reelSchema.index({ bunnyVideoId: 1 }, { unique: true, sparse: true })

export const Reel = mongoose.model('Reel', reelSchema)
