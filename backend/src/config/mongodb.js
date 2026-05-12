import mongoose from 'mongoose'

export async function connectMongoDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize:             20,   // max concurrent DB connections per process
      minPoolSize:              2,   // keep 2 warm at idle
      serverSelectionTimeoutMS: 5_000,
      socketTimeoutMS:         45_000,
      heartbeatFrequencyMS:    10_000,
    })
    console.log('MongoDB connected')
  } catch (err) {
    console.error('MongoDB connection error:', err.message)
    process.exit(1)
  }
}
