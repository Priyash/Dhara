import mongoose from 'mongoose'

const episodeSchema = new mongoose.Schema({
  number:       { type: Number, required: true },
  title:        { type: String, required: true },
  duration:     String,
  bunnyVideoId: String,  // Bunny Stream video GUID for this episode
})

const contentSchema = new mongoose.Schema(
  {
    title:        { type: String, required: true },
    subtitle:     String,
    type:         { type: String, enum: ['Film', 'Series'], required: true },
    genre:        [String],
    rating:       { type: Number, min: 0, max: 5, default: 0 },
    isPremium:    { type: Boolean, default: false },
    isFeatured:   { type: Boolean, default: false },
    badge:        { type: String, default: null },   // e.g. 'NEW'
    desc:         String,
    palette:      String,                            // CSS gradient fallback when no poster
    bunnyVideoId: String,                            // Bunny Stream video GUID
    posterUrl:    String,                            // Cloudinary image URL
    trailerVideoId: String,                          // optional Bunny trailer GUID
    episodes:     [episodeSchema],
    cast:         [String],
    director:     String,
    releaseYear:  Number,
  },
  { timestamps: true }
)

contentSchema.index({ title: 'text', desc: 'text', genre: 'text' })

export const Content = mongoose.model('Content', contentSchema)
