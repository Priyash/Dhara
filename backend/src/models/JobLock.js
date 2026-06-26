import mongoose from 'mongoose'

// Backs a Mongo-based distributed lock (see config/jobLock.js) so scheduled
// jobs run on only one instance at a time when multiple backend replicas
// are deployed.
const jobLockSchema = new mongoose.Schema({
  key:       { type: String, required: true, unique: true },
  lockedAt:  { type: Date,   required: true },
  expiresAt: { type: Date,   required: true },
})

// TTL index: MongoDB auto-deletes expired lock docs so a crashed instance can't
// hold a lock forever. expireAfterSeconds:0 means delete when expiresAt < now.
jobLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const JobLock = mongoose.model('JobLock', jobLockSchema)
