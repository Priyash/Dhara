#!/usr/bin/env node
/**
 * Upload a local MP4 to Bunny Stream.
 *
 * Usage:
 *   node scripts/uploadVideo.js <path/to/video.mp4> "<Title>"
 *
 * Output: prints the Bunny video GUID — save it as bunnyVideoId in MongoDB.
 *
 * Requires env vars: BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_API_KEY, BUNNY_CDN_PULL_ZONE
 */
import '../src/config/env.js'
import { readFileSync, statSync } from 'fs'
import path from 'path'

const [,, filePath, title] = process.argv

if (!filePath || !title) {
  console.error('Usage: node scripts/uploadVideo.js <file.mp4> "<Title>"')
  process.exit(1)
}

const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID
const apiKey    = process.env.BUNNY_STREAM_API_KEY
const pullZone  = process.env.BUNNY_CDN_PULL_ZONE

if (!libraryId || !apiKey) {
  console.error('Missing BUNNY_STREAM_LIBRARY_ID or BUNNY_STREAM_API_KEY in .env')
  process.exit(1)
}

const fileSize = statSync(filePath).size
console.log(`Uploading "${title}" (${(fileSize / 1024 / 1024).toFixed(1)} MB) to Bunny Stream…`)

// Step 1 — Create the video object and get back a GUID
const createRes = await fetch(
  `https://video.bunnycdn.com/library/${libraryId}/videos`,
  {
    method: 'POST',
    headers: { AccessKey: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  }
)

if (!createRes.ok) {
  console.error('Failed to create video:', await createRes.text())
  process.exit(1)
}

const { guid } = await createRes.json()
console.log(`  Video created — GUID: ${guid}`)

// Step 2 — Upload the raw file bytes
const fileBuffer  = readFileSync(filePath)
const uploadRes   = await fetch(
  `https://video.bunnycdn.com/library/${libraryId}/videos/${guid}`,
  {
    method: 'PUT',
    headers: { AccessKey: apiKey, 'Content-Type': 'application/octet-stream' },
    body: fileBuffer,
  }
)

if (!uploadRes.ok) {
  console.error('Upload failed:', await uploadRes.text())
  process.exit(1)
}

const hlsUrl = `https://${pullZone}/${guid}/playlist.m3u8`

console.log('\n✓ Upload complete — Bunny is transcoding to multiple bitrates (takes ~1–5 min)')
console.log('  bunnyVideoId :', guid)
console.log('  HLS URL      :', hlsUrl)
console.log('\nSave bunnyVideoId in your MongoDB Content document.')
console.log('Tip: Enable "Token Authentication" on the pull zone to protect premium streams.')
