#!/usr/bin/env node
/**
 * Seeds content into MongoDB.
 *
 * Usage:
 *   node scripts/seedContent.js           # skips if documents already exist
 *   node scripts/seedContent.js --force   # clears existing content and re-seeds
 */
import '../src/config/env.js'
import mongoose from 'mongoose'
import { connectMongoDB } from '../src/config/mongodb.js'
import { Content } from '../src/models/Content.js'

const force = process.argv.includes('--force')

const SEED_DATA = []

await connectMongoDB()

if (force) {
  const deleted = await Content.deleteMany({})
  console.log(`[seed] Cleared ${deleted.deletedCount} existing documents.`)
} else {
  const existing = await Content.countDocuments()
  if (existing > 0) {
    console.log(`[seed] Skipping — ${existing} documents already exist. Use --force to overwrite.`)
    await mongoose.disconnect()
    process.exit(0)
  }
}

await Content.insertMany(SEED_DATA)
console.log(`✓ Seeded ${SEED_DATA.length} content documents.`)
await mongoose.disconnect()
