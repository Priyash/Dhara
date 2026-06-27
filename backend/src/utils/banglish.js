/**
 * banglish.js — transliteration-aware ("Banglish") search normalisation.
 *
 * Bengali users overwhelmingly type Romanized Bengali on phones ("bhalobashar
 * bari", "premer golpo"), so an exact-script match misses them at the front
 * door (see docs/thumbnail-trailer-pipeline.md §8.1). `phoneticKey()` folds a
 * string — whether Bengali script, Romanized Bengali, or English — onto ONE
 * canonical phonetic key, so all three spellings of a title collapse together.
 *
 * Per the v1 scope this is deliberately a rule-based folder (no ML, no perfect
 * Avro engine) that favours recall over precision: search re-ranks results
 * afterwards, so over-matching is cheaper than missing.
 *
 * Pipeline: Bengali → Latin transliteration (with inherent vowels) → aspirate/
 * digraph folding → vowel normalisation → de-dupe → strip trailing vowels.
 */

const HASANTA = '্' // virama — suppresses the inherent vowel (conjunct join)

// Bengali consonants → Latin (carry an inherent 'o' unless a matra/hasanta follows)
const CONSONANTS = {
  'ক': 'k',  'খ': 'kh', 'গ': 'g',  'ঘ': 'gh', 'ঙ': 'ng',
  'চ': 'ch', 'ছ': 'ch', 'জ': 'j',  'ঝ': 'jh', 'ঞ': 'n',
  'ট': 't',  'ঠ': 'th', 'ড': 'd',  'ঢ': 'dh', 'ণ': 'n',
  'ত': 't',  'থ': 'th', 'দ': 'd',  'ধ': 'dh', 'ন': 'n',
  'প': 'p',  'ফ': 'ph', 'ব': 'b',  'ভ': 'bh', 'ম': 'm',
  'য': 'j',  'র': 'r',  'ল': 'l',  'শ': 'sh', 'ষ': 'sh',
  'স': 's',  'হ': 'h',  'ড়': 'r',  'ঢ়': 'rh', 'য়': 'y',
  'ৎ': 't',
}

// Vowel signs (matras) → Latin
const MATRAS = {
  'া': 'a', 'ি': 'i', 'ী': 'i', 'ু': 'u', 'ূ': 'u',
  'ৃ': 'ri', 'ে': 'e', 'ৈ': 'oi', 'ো': 'o', 'ৌ': 'ou',
}

// Independent vowels → Latin
const VOWELS = {
  'অ': 'a', 'আ': 'a', 'ই': 'i', 'ঈ': 'i', 'উ': 'u',
  'ঊ': 'u', 'ঋ': 'ri', 'এ': 'e', 'ঐ': 'oi', 'ও': 'o',
  'ঔ': 'ou',
}

// Other marks
const OTHERS = {
  'ং': 'ng', // anusvara
  'ঃ': 'h',  // visarga
  'ঁ': '',   // chandrabindu (nasal) — drop
  '়': '',   // nukta — drop (handled in precomposed forms)
}

const NUKTA = '়' // U+09BC — combines with a base consonant (ড়, ঢ়, য়)

// A nukta'd consonant's sound, by its base letter.
const NUKTA_FORMS = { 'ড': 'r', 'ঢ': 'rh', 'য': 'y' }

/** Transliterates Bengali script to a rough Latin form; Latin input passes through. */
export function transliterateBengali(str) {
  // NFC normalises matra/word forms. Note Bengali ড়/ঢ়/য় are composition
  // exclusions, so NFC leaves them as base + nukta — handled explicitly below.
  // Drop the য-phala glide (্য, e.g. ব্য "bya"), which Romanization adds/drops freely.
  const chars = [...String(str || '').normalize('NFC').replace(/্য/g, '')]
  let out = ''
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (CONSONANTS[c] != null) {
      let cons = CONSONANTS[c]
      // A following nukta changes the consonant's sound (ড় = r, য় = y, …).
      if (chars[i + 1] === NUKTA) {
        if (NUKTA_FORMS[c] != null) cons = NUKTA_FORMS[c]
        i++
      }
      out += cons
      const next = chars[i + 1]
      if (next === HASANTA) {
        i++                                  // conjunct — skip the virama
      } else if (MATRAS[next] != null) {
        out += MATRAS[next]; i++             // explicit vowel sign
      }
      // bare consonants keep no inherent vowel — vowels are dropped below anyway,
      // which sidesteps the Bengali inherent-vowel ambiguity (golpo vs byomkesh).
    } else if (CONSONANTS[c] == null && (c === 'ড়' || c === 'ঢ়' || c === 'য়')) {
      // Defensive: handle a precomposed nukta letter if NFC ever leaves one.
      out += ({ 'ড়': 'r', 'ঢ়': 'rh', 'য়': 'y' })[c]
    } else if (VOWELS[c] != null) {
      out += VOWELS[c]
    } else if (OTHERS[c] != null) {
      out += OTHERS[c]
    } else if (/[a-z0-9]/i.test(c)) {
      out += c.toLowerCase()                 // already-Latin (Romanized / English) input
    }
    // everything else (spaces, punctuation, danda) is a separator → dropped
  }
  return out
}

/**
 * Collapses a string to a canonical phonetic key — a folded consonant skeleton.
 * Safe to call on Bengali script, Romanized Bengali, or English: they fold to
 * the same key when they sound alike. Vowels are dropped (their spelling is the
 * least reliable signal across the three writing styles), which is recall-first
 * by design — search re-ranks afterwards, so over-matching is the cheap error.
 */
export function phoneticKey(str) {
  let s = transliterateBengali(str).toLowerCase()

  // Aspirate / digraph folding (multi-char first) — Banglish drops/adds the 'h'.
  s = s
    .replace(/bh/g, 'b').replace(/gh/g, 'g').replace(/jh/g, 'j').replace(/dh/g, 'd')
    .replace(/th/g, 't').replace(/kh/g, 'k').replace(/ph/g, 'p').replace(/ch/g, 'c')
    .replace(/sh/g, 's').replace(/rh/g, 'r')

  // Single-letter equivalences (Bengali has no v/w/z/f; spellings vary). 'y' is
  // a glide that Romanization adds/drops freely (byomkesh, satyajit) → drop it.
  s = s
    .replace(/f/g, 'p').replace(/v/g, 'b').replace(/w/g, 'b').replace(/z/g, 'j')
    .replace(/q/g, 'k').replace(/x/g, 'ks').replace(/c/g, 'k').replace(/y/g, '')

  s = s.replace(/[aeiou]/g, '')    // drop vowels → consonant skeleton
  s = s.replace(/(.)\1+/g, '$1')   // collapse doubled letters
  s = s.replace(/[^a-z]/g, '')     // keep only a–z

  return s
}
