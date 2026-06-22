import mongoose from 'mongoose'

// Backs a Mongo-based distributed lock (see config/jobLock.js) so scheduled
// jobs run on only one instance at a time when multiple backend replicas
// are deployed.
const jobLockSchema = new mongoose.Schema({
  key:       { type: String, required: true, unique: true },
  lockedAt:  { type: Date,   required: true },
  expiresAt: { type: Date,   required: true },
})

export const JobLock = mongoose.model('JobLock', jobLockSchema)
