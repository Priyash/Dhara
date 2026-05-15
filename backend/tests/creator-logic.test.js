/**
 * Creator revenue logic — no DB required.
 * Tests tier calculation and earnings math mirrored from
 * routes/admin.js (tierFor) and routes/creator.js.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// ── Mirrors TIERS + tierFor from routes/admin.js ──────────────────────────────

const TIERS = [
  { name: 'Newcomer',    level: 1, minViews: 0,       maxViews: 999,      share: 60, nextMin: 1_000    },
  { name: 'Rising Star', level: 2, minViews: 1_000,   maxViews: 9_999,    share: 65, nextMin: 10_000   },
  { name: 'Established', level: 3, minViews: 10_000,  maxViews: 99_999,   share: 70, nextMin: 100_000  },
  { name: 'Featured',    level: 4, minViews: 100_000, maxViews: Infinity,  share: 75, nextMin: null     },
]

function tierFor(totalViews) {
  return TIERS.find(t => totalViews <= t.maxViews) ?? TIERS[TIERS.length - 1]
}

// ── Mirrors the earnings calculation from POST /api/admin/revenue/calculate ───

function calculateNet(viewCount, ratePerViewPaise, revenueSharePct) {
  const grossPaise = viewCount * ratePerViewPaise
  return Math.round(grossPaise * (revenueSharePct / 100))
}

// ── Tier assignment ───────────────────────────────────────────────────────────

describe('Creator tier — boundaries', () => {
  it('0 views → Newcomer',     () => assert.equal(tierFor(0).name,         'Newcomer'))
  it('1 view → Newcomer',      () => assert.equal(tierFor(1).name,         'Newcomer'))
  it('999 views → Newcomer',   () => assert.equal(tierFor(999).name,       'Newcomer'))
  it('1000 views → Rising Star',  () => assert.equal(tierFor(1_000).name,  'Rising Star'))
  it('9999 views → Rising Star',  () => assert.equal(tierFor(9_999).name,  'Rising Star'))
  it('10000 views → Established', () => assert.equal(tierFor(10_000).name, 'Established'))
  it('99999 views → Established', () => assert.equal(tierFor(99_999).name, 'Established'))
  it('100000 views → Featured',   () => assert.equal(tierFor(100_000).name,'Featured'))
  it('1M views → Featured',       () => assert.equal(tierFor(1_000_000).name, 'Featured'))
  it('very large view count → Featured', () => assert.equal(tierFor(Number.MAX_SAFE_INTEGER).name, 'Featured'))
})

describe('Creator tier — revenue share', () => {
  it('Newcomer gets 60% share',    () => assert.equal(tierFor(500).share,     60))
  it('Rising Star gets 65% share', () => assert.equal(tierFor(5_000).share,   65))
  it('Established gets 70% share', () => assert.equal(tierFor(50_000).share,  70))
  it('Featured gets 75% share',    () => assert.equal(tierFor(500_000).share, 75))
})

describe('Creator tier — level ordering', () => {
  it('tier levels increase monotonically', () => {
    for (let i = 1; i < TIERS.length; i++) {
      assert.ok(TIERS[i].level > TIERS[i - 1].level)
    }
  })

  it('minViews of each tier equals maxViews + 1 of previous', () => {
    for (let i = 1; i < TIERS.length; i++) {
      assert.equal(TIERS[i].minViews, TIERS[i - 1].maxViews + 1)
    }
  })
})

// ── Earnings calculation ──────────────────────────────────────────────────────

describe('Creator earnings calculation', () => {
  it('zero views → zero earnings', () => {
    assert.equal(calculateNet(0, 50, 70), 0)
  })

  it('1000 views × 50 paise rate × 100% share = 50000 paise (₹500)', () => {
    assert.equal(calculateNet(1_000, 50, 100), 50_000)
  })

  it('applies Newcomer 60% share correctly', () => {
    // 1000 views × 50p × 60% = 30000p = ₹300
    assert.equal(calculateNet(1_000, 50, 60), 30_000)
  })

  it('applies Established 70% share correctly', () => {
    // 1000 views × 50p × 70% = 35000p = ₹350
    assert.equal(calculateNet(1_000, 50, 70), 35_000)
  })

  it('applies Featured 75% share correctly', () => {
    // 100000 views × 50p × 75% = 3750000p = ₹37500
    assert.equal(calculateNet(100_000, 50, 75), 3_750_000)
  })

  it('default rate of 50 paise = ₹0.50 per view', () => {
    // 1 view × 50p × 100% = 50p
    assert.equal(calculateNet(1, 50, 100), 50)
  })

  it('rounds fractional paise to nearest integer', () => {
    // 1 view × 33p × 70% = 23.1p → rounds to 23
    assert.equal(calculateNet(1, 33, 70), 23)
  })

  it('scales linearly with view count', () => {
    const base = calculateNet(1_000, 50, 70)
    const doubled = calculateNet(2_000, 50, 70)
    assert.equal(doubled, base * 2)
  })
})

// ── Creator application validation ───────────────────────────────────────────

describe('Creator application — status transitions', () => {
  // Mirrors the guard logic in POST /api/creator/apply
  function canApply(creatorStatus) {
    if (creatorStatus === 'approved') return { ok: false, reason: 'Already approved' }
    if (creatorStatus === 'applied')  return { ok: false, reason: 'Already under review' }
    return { ok: true }
  }

  it('allows new users (status = none)', () => {
    assert.equal(canApply('none').ok, true)
  })

  it('allows re-application after rejection', () => {
    assert.equal(canApply('rejected').ok, true)
  })

  it('blocks already-approved creators', () => {
    const result = canApply('approved')
    assert.equal(result.ok, false)
    assert.ok(result.reason.toLowerCase().includes('approved'))
  })

  it('blocks re-submission while under review', () => {
    const result = canApply('applied')
    assert.equal(result.ok, false)
    assert.ok(result.reason.toLowerCase().includes('review'))
  })
})
