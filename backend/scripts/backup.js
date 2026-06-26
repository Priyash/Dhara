#!/usr/bin/env node
/**
 * backup.js — exports all critical collections to a timestamped JSON file.
 *
 * Usage:
 *   node scripts/backup.js                        # backup to ./backups/
 *   node scripts/backup.js --out /path/to/dir     # custom output directory
 *   node scripts/backup.js --collections content,users  # specific collections only
 *
 * The output file is:
 *   dhara-backup-YYYY-MM-DD-HHmmss.json
 *
 * Restore with:
 *   node scripts/restore.js --file ./backups/dhara-backup-2026-05-12-120000.json
 */

import '../src/config/env.js'
import fs   from 'fs'
import path from 'path'
import { connectMongoDB } from '../src/config/mongodb.js'
import mongoose from 'mongoose'

// Import all models so their schemas are registered
import { Content }        from '../src/models/Content.js'
import { User }           from '../src/models/User.js'
import { Transaction }    from '../src/models/Transaction.js'
import { UploadJob }      from '../src/models/UploadJob.js'
import { StreamCollection } from '../src/models/StreamCollection.js'
import { PaymentConfig }  from '../src/models/PaymentConfig.js'
import { CuratedShelf }   from '../src/models/CuratedShelf.js'
import { CreatorEarning } from '../src/models/CreatorEarning.js'
import { CreatorPayout }  from '../src/models/CreatorPayout.js'
import { ViewRateConfig } from '../src/models/ViewRateConfig.js'
import { CurrencyConfig } from '../src/models/CurrencyConfig.js'

const COLLECTIONS = {
  content:         Content,
  users:           User,
  transactions:    Transaction,
  uploadJobs:      UploadJob,
  streamCollections: StreamCollection,
  paymentConfig:   PaymentConfig,
  curatedShelves:  CuratedShelf,
  creatorEarnings: CreatorEarning,
  creatorPayouts:  CreatorPayout,
  viewRateConfig:  ViewRateConfig,
  currencyConfig:  CurrencyConfig,
}

// Parse CLI args
const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const outDir = outIdx !== -1 ? args[outIdx + 1] : path.join(process.cwd(), 'backups')

const colIdx = args.indexOf('--collections')
const selectedCols = colIdx !== -1
  ? args[colIdx + 1].split(',').map((s) => s.trim())
  : Object.keys(COLLECTIONS)

await connectMongoDB()

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const filename  = `dhara-backup-${timestamp}.json`
const outPath   = path.join(outDir, filename)

fs.mkdirSync(outDir, { recursive: true })

const backup = {
  createdAt:   new Date().toISOString(),
  mongoUri:    (process.env.MONGODB_URI || '').replace(/\/\/[^:]+:[^@]+@/, '//<redacted>@'),
  collections: {},
}

let totalDocs = 0
for (const key of selectedCols) {
  const Model = COLLECTIONS[key]
  if (!Model) { console.warn(`[backup] Unknown collection: ${key} — skipped`); continue }
  const docs = await Model.find({}).lean()
  backup.collections[key] = docs
  totalDocs += docs.length
  console.log(`  ✓ ${key}: ${docs.length} documents`)
}

fs.writeFileSync(outPath, JSON.stringify(backup, null, 2))
const sizeMb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2)

console.log(`\nBackup complete → ${outPath}`)
console.log(`Total: ${totalDocs} documents across ${selectedCols.length} collections (${sizeMb} MB)`)

await mongoose.disconnect()
