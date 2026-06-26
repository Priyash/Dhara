import { Schema, model } from 'mongoose'

const viewEventSchema = new Schema({
  contentId:     { type: Schema.Types.ObjectId, ref: 'Content', required: true },
  seasonNumber:  { type: Number,  default: null },
  episodeNumber: { type: Number,  default: null },
  creatorId:     { type: Schema.Types.ObjectId, ref: 'User',    default: null },
  userId:        { type: Schema.Types.ObjectId, ref: 'User',    default: null },  // authenticated viewer
  viewedAt:      { type: Date,    default: Date.now },
  hour:          { type: Number,  min: 0, max: 23 },
  dayOfWeek:     { type: Number,  min: 0, max: 6 },
  state:         { type: String,  default: 'Unknown' },
  city:          { type: String,  default: 'Unknown' },
  country:       { type: String,  default: 'Unknown' },
  device:        { type: String,  enum: ['mobile', 'desktop', 'tv', 'unknown'], default: 'unknown' },
}, { timestamps: false })

viewEventSchema.index({ creatorId: 1, viewedAt: -1 })
viewEventSchema.index({ contentId: 1, viewedAt: -1 })
// Deduplication index: one counted view per user per content per season/episode per day
viewEventSchema.index({ userId: 1, contentId: 1, seasonNumber: 1, episodeNumber: 1, viewedAt: -1 })
// Analytics range queries: creatorId/contentId filters with date range
viewEventSchema.index({ viewedAt: 1, contentId: 1 })
// 1-year TTL — auto-purges old events so the collection stays bounded
viewEventSchema.index({ viewedAt: 1 }, { expireAfterSeconds: 31_536_000 })

export const ViewEvent = model('ViewEvent', viewEventSchema)
