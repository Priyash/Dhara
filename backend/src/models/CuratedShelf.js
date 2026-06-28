import mongoose from 'mongoose'

const curatedShelfSchema = new mongoose.Schema(
  {
    name:         { type: String, required: true },
    tagline:      { type: String, default: '' },
    backdropUrl:  { type: String, default: '' },
    accentColor:  { type: String, default: '#f59e0b' },
    contentIds:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'Content' }],
    displayOrder: { type: Number, default: 0 },
    isActive:     { type: Boolean, default: true },

    // "Utsab" festival rails — a shelf with a date window auto-surfaces on the
    // Bengali calendar and retires after it, via the read-time filter the public
    // /shelves endpoint applies. null on either side = open-ended (always-on).
    activeFrom:   { type: Date,   default: null },
    activeTo:     { type: Date,   default: null },
    festivalTag:  { type: String, default: '', trim: true },   // e.g. 'durga-puja', 'poila-boishakh'
  },
  { timestamps: true }
)

curatedShelfSchema.index({ isActive: 1, displayOrder: 1 })
// Festival-window serving lookup.
curatedShelfSchema.index({ isActive: 1, activeFrom: 1, activeTo: 1 })

/** Mongo filter for shelves that should be live right now (open-ended OR within window). */
curatedShelfSchema.statics.liveFilter = function (now = new Date()) {
  return {
    isActive: true,
    $and: [
      { $or: [{ activeFrom: null }, { activeFrom: { $lte: now } }] },
      { $or: [{ activeTo: null },   { activeTo:   { $gte: now } }] },
    ],
  }
}

export const CuratedShelf = mongoose.model('CuratedShelf', curatedShelfSchema)
