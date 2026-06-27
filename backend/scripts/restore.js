#!/usr/bin/env node
/**
 * restore.js — imports a backup produced by backup.js back into MongoDB.
 *
 * Usage:
 *   node scripts/restore.js --file ./backups/dhara-backup-2026-05-12-120000.json
 *   node scripts/restore.js --file ./backups/dhara-backup-2026-05-12-120000.json --merge
 *
 * Modes:
 *   default  — clears each collection before inserting (full restore)
 *   --merge  — upserts by _id without clearing (safe for partial restores)
 *
 * Safety:
 *   The script asks for confirmation before clearing any collection in default mode.
 *   Pass --yes to skip the prompt (for automated pipelines).
 */

import '../src/config/env.js'
import fs       from 'fs'
import path     from 'path'
import readline from 'readline'
import { connectMongoDB } from '../src/config/mongodb.js'
import mongoose from 'mongoose'

import { Content }          from '../src/models/Content.js'
import { User }             from '../src/models/User.js'
import { Transaction }      from '../src/models/Transaction.js'
import { UploadJob }        from '../src/models/UploadJob.js'
import { StreamCollection } from '../src/models/StreamCollection.js'
import { PaymentConfig }    from '../src/models/PaymentConfig.js'
import { CuratedShelf }     from '../src/models/CuratedShelf.js'
import { CreatorEarning }   from '../src/models/CreatorEarning.js'
import { CreatorPayout }    from '../src/models/CreatorPayout.js'
import { ViewRateConfig }   from '../src/models/ViewRateConfig.js'
import { CurrencyConfig }   from '../src/models/CurrencyConfig.js'
import { ThumbnailVariant } from '../src/models/ThumbnailVariant.js'

const MODEL_MAP = {
  content:           Content,
  users:             User,
  transactions:      Transaction,
  uploadJobs:        UploadJob,
  streamCollections: StreamCollection,
  paymentConfig:     PaymentConfig,
  curatedShelves:    CuratedShelf,
  creatorEarnings:   CreatorEarning,
  creatorPayouts:    CreatorPayout,
  viewRateConfig:    ViewRateConfig,
  currencyConfig:    CurrencyConfig,
  thumbnailVariants: ThumbnailVariant,
}

const args    = process.argv.slice(2)
const fileIdx = args.indexOf('--file')
const merge   = args.includes('--merge')
const skipConfirm = args.includes('--yes')

if (fileIdx === -1 || !args[fileIdx + 1]) {
  console.error('Usage: node scripts/restore.js --file <backup.json> [--merge] [--yes]')
  process.exit(1)
}

const filePath = path.resolve(args[fileIdx + 1])
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`)
  process.exit(1)
}

const backup = JSON.parse(fs.readFileSync(filePath, 'utf8'))
const keys   = Object.keys(backup.collections)

console.log(`\nBackup created: ${backup.createdAt}`)
console.log(`Collections:    ${keys.join(', ')}`)
console.log(`Mode:           ${merge ? 'MERGE (upsert by _id)' : 'REPLACE (clear + insert)'}`)
console.log()

if (!merge && !skipConfirm) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  await new Promise((resolve) => {
    rl.question('⚠ This will CLEAR and replace the listed collections. Type "yes" to continue: ', (ans) => {
      rl.close()
      if (ans.trim().toLowerCase() !== 'yes') {
        console.log('Aborted.')
        process.exit(0)
      }
      resolve()
    })
  })
}

await connectMongoDB()

let totalRestored = 0

for (const key of keys) {
  const Model = MODEL_MAP[key]
  if (!Model) { console.warn(`[restore] No model for "${key}" — skipped`); continue }

  const docs = backup.collections[key]
  if (!docs?.length) { console.log(`  – ${key}: 0 documents (skipped)`); continue }

  if (merge) {
    // Upsert each document by _id without clearing
    const ops = docs.map((doc) => ({
      replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
    }))
    await Model.bulkWrite(ops, { ordered: false })
  } else {
    await Model.deleteMany({})
    await Model.insertMany(docs, { ordered: false })
  }

  totalRestored += docs.length
  console.log(`  ✓ ${key}: ${docs.length} documents restored`)
}

console.log(`\nRestore complete — ${totalRestored} documents across ${keys.length} collections`)
await mongoose.disconnect()
