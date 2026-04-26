#!/usr/bin/env node
/**
 * Upload a poster image to Cloudinary.
 *
 * Usage:
 *   node scripts/uploadPoster.js <path/to/poster.jpg> "<slug>"
 *
 * Example:
 *   node scripts/uploadPoster.js ./byomkesh.jpg byomkesh
 *
 * Output: prints the Cloudinary URL — save it as posterUrl in MongoDB.
 *
 * Requires env vars: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 */
import '../src/config/env.js'
import '../src/config/cloudinary.js'
import { v2 as cloudinary } from 'cloudinary'

const [,, filePath, slug] = process.argv

if (!filePath || !slug) {
  console.error('Usage: node scripts/uploadPoster.js <image.jpg> <slug>')
  process.exit(1)
}

console.log(`Uploading poster for "${slug}"…`)

const result = await cloudinary.uploader.upload(filePath, {
  folder:         'dhara/posters',
  public_id:      slug,
  overwrite:      true,
  // Auto-crop to a 2:3 poster ratio and optimise quality
  transformation: [
    { width: 800, height: 1200, crop: 'fill', gravity: 'auto', quality: 'auto', fetch_format: 'auto' },
  ],
})

console.log('\n✓ Upload complete')
console.log('  posterUrl :', result.secure_url)
console.log('\nSave posterUrl in your MongoDB Content document.')
