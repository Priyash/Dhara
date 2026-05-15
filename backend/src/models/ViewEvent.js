import { Schema, model } from 'mongoose'

const viewEventSchema = new Schema({
  contentId:     { type: Schema.Types.ObjectId, ref: 'Content', required: true },
  episodeNumber: { type: Number,  default: null },
  creatorId:     { type: Schema.Types.ObjectId, ref: 'User',    required: true },
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
// 1-year TTL — auto-purges old events so the collection stays bounded
viewEventSchema.index({ viewedAt: 1 }, { expireAfterSeconds: 31_536_000 })

export const ViewEvent = model('ViewEvent', viewEventSchema)
