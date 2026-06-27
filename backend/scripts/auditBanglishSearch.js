#!/usr/bin/env node
/**
 * auditBanglishSearch.js — sizes the Banglish-search gap from real logs.
 *
 * Scans SearchLog for zero-result queries that look like Romanized Bengali
 * (Latin letters, length >= 4) and reports how many would now resolve to a
 * title via the phonetic key — i.e. how much traffic the front door was losing.
 *
 * Usage: node scripts/auditBanglishSearch.js
 */
import '../src/config/env.js'
import mongoose from 'mongoose'
import { connectMongoDB } from '../src/config/mongodb.js'
import { SearchLog } from '../src/models/SearchLog.js'
import { Content } from '../src/models/Content.js'
import { phoneticKey } from '../src/utils/banglish.js'

await connectMongoDB()

const zeroResult = await SearchLog.find({ resultCount: 0 }).select('query').lean()
const romanized  = zeroResult.filter((l) => /^[a-z][a-z\s]{3,}$/i.test((l.query || '').trim()))

let recoverable = 0
const examples = []
for (const log of romanized) {
  const pk = phoneticKey(log.query)
  if (pk.length < 3) continue
  const hit = await Content.findOne({
    isPublished: true, isDeleted: { $ne: true }, submissionStatus: { $nin: ['pending', 'rejected'] },
    searchKey: { $regex: pk },
  }).select('title').lean()
  if (hit) {
    recoverable++
    if (examples.length < 20) examples.push(`"${log.query}" → ${hit.title}`)
  }
}

console.log('── Banglish search audit ──────────────────────────────')
console.log(`Zero-result queries:                 ${zeroResult.length}`)
console.log(`  …that look Romanized (len >= 4):   ${romanized.length}`)
console.log(`  …now recoverable via phonetic key: ${recoverable}`)
if (romanized.length) {
  console.log(`  recovery rate of Romanized misses: ${((recoverable / romanized.length) * 100).toFixed(1)}%`)
}
if (examples.length) {
  console.log('\nExamples now matched:')
  examples.forEach((e) => console.log('  ' + e))
}
console.log('\nNote: depends on searchKey being backfilled (scripts/backfillSearchKeys.js).')

await mongoose.disconnect()
