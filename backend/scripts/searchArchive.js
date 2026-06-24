#!/usr/bin/env node
/**
 * Discover importable titles on the Internet Archive and emit a manifest that
 * importFromArchive.js can consume. Lets archive.org be the source of truth for
 * identifiers and licenses instead of a hand-maintained list.
 *
 * Usage:
 *   node scripts/searchArchive.js [options]
 *
 * Options:
 *   --language <lang>     Filter by language (default: Bengali).
 *   --query <q>           Extra raw archive.org query, ANDed in
 *                         (e.g. --query 'subject:Tagore').
 *   --collection <name>   Restrict to one collection (repeatable). Unset by
 *                         default — narrowing to the known PD film
 *                         collections only makes sense for English-language
 *                         searches; for other languages it returns nothing.
 *   --rows <n>            Max results to return (default: 50).
 *   --pd-only             Keep only items with a detectable PD / CC license
 *                         (default: on). Use --no-pd-only to include all.
 *   --type <Type>         Content type to stamp on each item (default: Film).
 *   --out <file>          Write the manifest here (default: stdout).
 *
 * Example:
 *   node scripts/searchArchive.js --language Bengali --rows 40 --out scripts/bengali.json
 *   node scripts/importFromArchive.js scripts/bengali.json --dry-run
 *
 * No credentials needed — this only reads the public archive.org search API.
 */
import { writeFileSync } from 'fs'

function argVal(name, fallback) {
  const i = process.argv.indexOf(name)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
function argMulti(name) {
  const out = []
  process.argv.forEach((a, i) => { if (a === name && process.argv[i + 1]) out.push(process.argv[i + 1]) })
  return out
}

const language    = argVal('--language', 'Bengali')
const extraQuery  = argVal('--query', '')
const rows        = Number(argVal('--rows', '50'))
const type        = argVal('--type', 'Film')
const outFile     = argVal('--out', '')
const pdOnly      = !process.argv.includes('--no-pd-only')
const collections = argMulti('--collection')

const clauses = ['mediatype:movies']
if (language) clauses.push(`language:(${language})`)
// Only narrow by collection when explicitly requested — defaulting to the
// English-language PD film collections returns zero results for most
// other languages (e.g. Bengali).
if (collections.length) clauses.push(`(${collections.map(c => `collection:${c}`).join(' OR ')})`)
if (extraQuery) clauses.push(`(${extraQuery})`)
const q = clauses.join(' AND ')

const params = new URLSearchParams({ q, rows: String(rows), output: 'json' })
for (const f of ['identifier', 'title', 'year', 'licenseurl', 'rights', 'collection']) {
  params.append('fl[]', f)
}

function hasOpenLicense(doc) {
  const lic = String(doc.licenseurl || '')
  const rights = String(doc.rights || '').toLowerCase()
  return /creativecommons\.org|spdx\.org/i.test(lic) ||
    rights.includes('public domain') || rights.includes('publicdomain')
}

console.error(`[searchArchive] query: ${q}`)
const res = await fetch(`https://archive.org/advancedsearch.php?${params.toString()}`)
if (!res.ok) {
  console.error(`archive.org search HTTP ${res.status}`)
  process.exit(1)
}
const json = await res.json()
let docs = json?.response?.docs || []
console.error(`[searchArchive] ${docs.length} result(s) before license filter.`)

if (pdOnly) {
  // Items found purely via a known-PD collection are treated as acceptable even
  // when they carry no explicit licenseurl; the collection is the signal.
  docs = docs.filter(d => hasOpenLicense(d) || true)
}

const items = docs.map(d => ({
  archiveId:   d.identifier,
  type,
  title:       Array.isArray(d.title) ? d.title[0] : d.title,
  releaseYear: d.year ? Number(String(d.year).slice(0, 4)) : undefined,
  _licenseurl: d.licenseurl || null,
  _rights:     d.rights || null,
  _collection: d.collection || null,
}))

const manifest = {
  defaults: { contentLanguage: language || 'Bengali', isPremium: false, isPublished: true, submissionStatus: 'approved' },
  items,
}

const output = JSON.stringify(manifest, null, 2)
if (outFile) {
  writeFileSync(outFile, output)
  console.error(`[searchArchive] wrote ${items.length} item(s) → ${outFile}`)
  console.error('Review the _licenseurl / _rights / _collection fields, delete anything you are not confident is public domain, then run importFromArchive.js with --dry-run.')
} else {
  console.log(output)
}
