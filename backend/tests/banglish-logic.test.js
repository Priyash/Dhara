/**
 * Banglish phonetic-key tests. The gating requirement (docs §8.1): Bengali
 * script, Romanized Bengali, and English spellings of a title must collapse to
 * the same key, while distinct titles stay distinct. Pure function — no DB.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { phoneticKey } from '../src/utils/banglish.js'

describe('phoneticKey — cross-script collapse (recall)', () => {
  const groups = [
    ['ভালোবাসা', 'bhalobasha', 'valobasha'],
    ['প্রেমের গল্প', 'premer golpo'],
    ['ফেলুদা', 'feluda', 'pheluda'],
    ['ব্যোমকেশ', 'byomkesh'],
    ['সত্যজিৎ', 'satyajit', 'sotyojit'],
    ['বাড়ি', 'bari', 'baari'],
    ['গোয়েন্দা', 'goyenda', 'goenda'],
    ['রবীন্দ্রনাথ', 'rabindranath', 'robindronath'],
  ]
  for (const variants of groups) {
    it(`collapses ${JSON.stringify(variants)} to one key`, () => {
      const keys = variants.map(phoneticKey)
      assert.equal(new Set(keys).size, 1, `got ${JSON.stringify(keys)}`)
      assert.ok(keys[0].length > 0)
    })
  }
})

describe('phoneticKey — distinctness (precision floor)', () => {
  it('keeps clearly different titles apart', () => {
    const keys = ['feluda', 'golpo', 'bari', 'premer', 'rabindranath'].map(phoneticKey)
    assert.equal(new Set(keys).size, keys.length)
  })
})

describe('phoneticKey — edges', () => {
  it('is stable (idempotent on its own output style)', () => {
    assert.equal(phoneticKey('Bhalobasha'), phoneticKey('bhalobasha'))
  })
  it('handles empty / nullish input', () => {
    assert.equal(phoneticKey(''), '')
    assert.equal(phoneticKey(null), '')
    assert.equal(phoneticKey(undefined), '')
  })
  it('strips punctuation and whitespace', () => {
    assert.equal(phoneticKey('Premer  Golpo!'), phoneticKey('premergolpo'))
  })
})
