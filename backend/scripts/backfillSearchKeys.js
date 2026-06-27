#!/usr/bin/env node
/**
 * backfillSearchKeys.js — populates Content.searchKey (the Banglish phonetic
 * skeleton) for existing documents. New/edited content stays in sync via the
 * model hooks; this is a one-time backfill for rows that predate the field.
 *
 * Usage:
 *   node scripts/backfillSearchKeys.js          # backfill rows missing a key
 *   node scripts/backfillSearchKeys.js --all    # recompute for every row
 */
import '../src/config/env.js'
import mongoose from 'mongoose'
import { connectMongoDB } from '../src/config/mongodb.js'
import { Content } from '../src/models/Content.js'
import { phoneticKey } from '../src/utils/banglish.js'

const recomputeAll = process.argv.includes('--all')

await connectMongoDB()

const filter = recomputeAll ? {} : { $or: [{ searchKey: { $exists: false } }, { searchKey: '' }] }
const cursor = Content.find(filter).select('title searchKey').lean().cursor()

let scanned = 0
let updated = 0
let ops = []

async function flush() {
  if (!ops.length) return
  await Content.bulkWrite(ops, { ordered: false })
  ops = []
}

for await (const doc of cursor) {
  scanned++
  const key = phoneticKey(doc.title || '')
  if (key !== doc.searchKey) {
    ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { searchKey: key } } } })
    updated++
  }
  if (ops.length >= 500) await flush()
}
await flush()

console.log(`[backfill] scanned ${scanned}, updated ${updated} searchKey(s)`)
await mongoose.disconnect()
