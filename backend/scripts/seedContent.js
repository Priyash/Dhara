#!/usr/bin/env node
/**
 * Seeds the static mock content from the original frontend into MongoDB.
 * Run once after setting up MongoDB Atlas to populate your Content collection.
 *
 * Usage: node scripts/seedContent.js
 */
import '../src/config/env.js'
import mongoose from 'mongoose'
import { connectMongoDB } from '../src/config/mongodb.js'
import { Content } from '../src/models/Content.js'

const PALETTES = [
  'linear-gradient(135deg,#1a0533 0%,#4a0e8f 100%)',
  'linear-gradient(135deg,#0d1f3c 0%,#1a4a8a 100%)',
  'linear-gradient(135deg,#2d0a0a 0%,#8b1a1a 100%)',
  'linear-gradient(135deg,#0a2d1a 0%,#1a6b3a 100%)',
  'linear-gradient(135deg,#2d1a00 0%,#8b5e00 100%)',
  'linear-gradient(135deg,#1a0a2d 0%,#5e008b 100%)',
  'linear-gradient(135deg,#001a2d 0%,#006b8b 100%)',
  'linear-gradient(135deg,#2d0a1a 0%,#8b004a 100%)',
]

const SEED_DATA = [
  {
    title: 'Tandav', subtitle: 'Web Series · 2024',
    desc: 'A gripping political drama set in the corridors of power.',
    genre: ['Drama', 'Thriller'], type: 'Series', rating: 4.5,
    isPremium: false, isFeatured: true, palette: PALETTES[0],
    episodes: [
      { number: 1, title: 'The Rise',     duration: '48m' },
      { number: 2, title: 'The Fall',     duration: '52m' },
      { number: 3, title: 'The Betrayal', duration: '45m' },
    ],
  },
  { title: 'Mahanagar',          type: 'Series', rating: 4.7, isPremium: true,  palette: PALETTES[1], genre: ['Drama'] },
  { title: 'Bibaho Diaries',     type: 'Film',   rating: 4.3, isPremium: false, palette: PALETTES[2], genre: ['Romantic', 'Comedy'] },
  { title: 'Byomkesh',           type: 'Series', rating: 4.8, isPremium: true,  palette: PALETTES[3], genre: ['Thriller', 'Mystery'] },
  { title: 'Dui Prithibi',       type: 'Film',   rating: 4.1, isPremium: false, palette: PALETTES[4], genre: ['Drama'] },
  { title: 'Eken Babu',          type: 'Series', rating: 4.6, isPremium: true,  palette: PALETTES[5], genre: ['Comedy', 'Mystery'] },
  { title: 'Neel Rong',          type: 'Film',   rating: 4.4, isPremium: false, palette: PALETTES[6], genre: ['Romance'] },
  { title: 'Paraspathar',        type: 'Series', rating: 4.5, isPremium: true,  palette: PALETTES[7], genre: ['Thriller'] },
  { title: 'Abar Bibaho',        type: 'Film',   rating: 4.2, isPremium: false, palette: PALETTES[2], badge: 'NEW', genre: ['Comedy'] },
  { title: 'Kaktarua',           type: 'Series', rating: 4.7, isPremium: true,  palette: PALETTES[0], badge: 'NEW', genre: ['Drama'] },
  { title: 'Raktabeej',          type: 'Film',   rating: 4.0, isPremium: false, palette: PALETTES[3], badge: 'NEW', genre: ['Action'] },
  { title: 'Shesh Uttor',        type: 'Series', rating: 4.8, isPremium: true,  palette: PALETTES[1], badge: 'NEW', genre: ['Drama'] },
  { title: 'Chuti',              type: 'Film',   rating: 4.3, isPremium: false, palette: PALETTES[5], badge: 'NEW', genre: ['Family'] },
  { title: 'Boli',               type: 'Series', rating: 4.6, isPremium: true,  palette: PALETTES[7], badge: 'NEW', genre: ['Thriller'] },
  { title: 'Ghawre Bairey Aaj',  type: 'Film',   rating: 4.9, isPremium: true,  palette: PALETTES[4], genre: ['Drama'] },
  { title: 'Maayaa',             type: 'Series', rating: 4.7, isPremium: false, palette: PALETTES[6], genre: ['Romance'] },
  { title: 'Uchan Chithi',       type: 'Film',   rating: 4.5, isPremium: false, palette: PALETTES[2], genre: ['Drama'] },
  { title: 'Aranyer Din Ratri',  type: 'Film',   rating: 4.8, isPremium: true,  palette: PALETTES[0], genre: ['Drama', 'Classic'] },
  { title: 'Sobhyotar Shesh Raat', type: 'Series', rating: 4.6, isPremium: true, palette: PALETTES[3], genre: ['Thriller'] },
  { title: 'Teen Kanya',         type: 'Film',   rating: 4.4, isPremium: false, palette: PALETTES[1], genre: ['Drama', 'Classic'] },
]

await connectMongoDB()

const existing = await Content.countDocuments()
if (existing > 0) {
  console.log(`Skipping seed — ${existing} documents already exist.`)
  await mongoose.disconnect()
  process.exit(0)
}

await Content.insertMany(SEED_DATA)
console.log(`✓ Seeded ${SEED_DATA.length} content documents.`)
await mongoose.disconnect()
