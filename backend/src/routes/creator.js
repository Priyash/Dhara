import { Router } from 'express'
import { User } from '../models/User.js'
import { Content } from '../models/Content.js'
import { CreatorEarning } from '../models/CreatorEarning.js'
import { CreatorPayout } from '../models/CreatorPayout.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// requireCreator inline (avoids circular import)
function requireCreator(req, res, next) {
  if (!req.user?.isCreator || req.user?.creatorStatus !== 'approved') {
    return res.status(403).json({ error: 'Creator access required' })
  }
  next()
}

/**
 * POST /api/creator/apply
 * Any authenticated user can submit a creator application.
 */
router.post('/apply', requireAuth, async (req, res, next) => {
  try {
    if (req.user.creatorStatus === 'approved') {
      return res.status(400).json({ error: 'You are already an approved creator' })
    }
    if (req.user.creatorStatus === 'applied') {
      return res.status(400).json({ error: 'Your application is already under review' })
    }

    const { studioName, bio, portfolioUrl, sampleWorkUrl, contentTypes } = req.body

    if (!studioName?.trim())
      return res.status(400).json({ error: 'Studio name is required' })
    if (!sampleWorkUrl?.trim())
      return res.status(400).json({ error: 'A link to your sample work is required' })
    if (!Array.isArray(contentTypes) || contentTypes.length === 0)
      return res.status(400).json({ error: 'Select at least one content type you plan to upload' })

    const VALID_TYPES = ['Film', 'Series', 'Documentary']
    const sanitizedTypes = contentTypes.filter((t) => VALID_TYPES.includes(t))
    if (sanitizedTypes.length === 0)
      return res.status(400).json({ error: 'Invalid content type selection' })

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          creatorStatus:                 'applied',
          'creatorProfile.studioName':   studioName.trim(),
          'creatorProfile.bio':          (bio || '').trim(),
          'creatorProfile.portfolioUrl': (portfolioUrl || '').trim(),
          'creatorProfile.sampleWorkUrl': sampleWorkUrl.trim(),
          'creatorProfile.contentTypes': sanitizedTypes,
          'creatorProfile.appliedAt':    new Date(),
          creatorRejectionReason:        '',
          creatorRejectedAt:             null,
        },
      },
      { new: true }
    )

    res.json({
      creatorStatus:  user.creatorStatus,
      creatorProfile: user.creatorProfile,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/creator/status
 * Any authenticated user — returns their creator application status.
 */
router.get('/status', requireAuth, async (req, res) => {
  res.json({
    creatorStatus:          req.user.creatorStatus,
    isCreator:              req.user.isCreator,
    creatorProfile:         req.user.creatorProfile,
    creatorRejectionReason: req.user.creatorRejectionReason,
    creatorRejectedAt:      req.user.creatorRejectedAt ?? null,
  })
})

/**
 * PATCH /api/creator/profile
 * Approved creators can update their studio profile.
 */
router.patch('/profile', requireAuth, requireCreator, async (req, res, next) => {
  try {
    const { studioName, bio, portfolioUrl, sampleWorkUrl, contentTypes } = req.body
    const updates = {}
    if (studioName    !== undefined) updates['creatorProfile.studioName']    = studioName.trim()
    if (bio           !== undefined) updates['creatorProfile.bio']            = bio.trim()
    if (portfolioUrl  !== undefined) updates['creatorProfile.portfolioUrl']   = portfolioUrl.trim()
    if (sampleWorkUrl !== undefined) updates['creatorProfile.sampleWorkUrl']  = sampleWorkUrl.trim()
    if (contentTypes  !== undefined && Array.isArray(contentTypes)) {
      const VALID = ['Film', 'Series', 'Documentary']
      updates['creatorProfile.contentTypes'] = contentTypes.filter((t) => VALID.includes(t))
    }

    const user = await User.findByIdAndUpdate(req.user._id, { $set: updates }, { new: true })
    res.json({ creatorProfile: user.creatorProfile })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/creator/me
 * Approved creators — dashboard stats + profile.
 */
router.get('/me', requireAuth, requireCreator, async (req, res, next) => {
  try {
    const [agg] = await Content.aggregate([
      { $match: { creatorId: req.user._id } },
      { $group: {
        _id: null,
        total:    { $sum: 1 },
        approved: { $sum: { $cond: [{ $eq: ['$submissionStatus', 'approved'] }, 1, 0] } },
        pending:  { $sum: { $cond: [{ $eq: ['$submissionStatus', 'pending']  }, 1, 0] } },
        rejected: { $sum: { $cond: [{ $eq: ['$submissionStatus', 'rejected'] }, 1, 0] } },
      }},
    ])
    const { total = 0, approved = 0, pending = 0, rejected = 0 } = agg || {}

    res.json({
      creatorProfile:         req.user.creatorProfile,
      creatorStatus:          req.user.creatorStatus,
      creatorRejectionReason: req.user.creatorRejectionReason,
      stats: { total, approved, pending, rejected },
    })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/creator/analytics
 * Approved creators — per-content views, likes, approval breakdown.
 */
router.get('/analytics', requireAuth, requireCreator, async (req, res, next) => {
  try {
    const items = await Content.find({ creatorId: req.user._id })
      .select('title type posterUrl submissionStatus viewCount likeCount revisionCount episodes createdAt')
      .lean()

    const approved = items.filter((i) => i.submissionStatus === 'approved')
    const pending  = items.filter((i) => i.submissionStatus === 'pending')
    const rejected = items.filter((i) => i.submissionStatus === 'rejected')

    const totalViews = approved.reduce((s, i) => s + (i.viewCount  || 0), 0)
    const totalLikes = approved.reduce((s, i) => s + (i.likeCount  || 0), 0)

    const totalEpisodes = approved
      .filter((i) => i.type === 'Series')
      .reduce((s, i) => s + (i.episodes?.length || 0), 0)

    // Approval rate excludes pending — only settled (approved + rejected) count
    const settled      = approved.length + rejected.length
    const approvalRate = settled > 0 ? Math.round((approved.length / settled) * 100) : 0

    const engagementRate = totalViews > 0
      ? Number(((totalLikes / totalViews) * 100).toFixed(1))
      : 0

    const avgViewsPerTitle = approved.length > 0
      ? Math.round(totalViews / approved.length)
      : 0

    const topContent = approved
      .slice()
      .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))[0] || null

    res.json({
      overview: {
        totalViews,
        totalLikes,
        approvalRate,
        engagementRate,
        avgViewsPerTitle,
        totalEpisodes,
        submissionCounts: {
          total:    items.length,
          approved: approved.length,
          pending:  pending.length,
          rejected: rejected.length,
        },
        topContent: topContent
          ? {
              _id:       topContent._id,
              title:     topContent.title,
              type:      topContent.type,
              posterUrl: topContent.posterUrl || '',
              viewCount: topContent.viewCount || 0,
              likeCount: topContent.likeCount || 0,
            }
          : null,
      },
      content: items.map((i) => ({
        _id:              i._id,
        title:            i.title,
        type:             i.type,
        posterUrl:        i.posterUrl || '',
        submissionStatus: i.submissionStatus,
        viewCount:        i.viewCount     || 0,
        likeCount:        i.likeCount     || 0,
        revisionCount:    i.revisionCount || 0,
        episodes: i.type === 'Series'
          ? (i.episodes || []).map((ep) => ({
              number:    ep.number,
              title:     ep.title,
              viewCount: ep.viewCount || 0,
            }))
          : [],
        createdAt: i.createdAt,
      })),
    })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/creator/content
 * Approved creators — their own submissions (all statuses).
 */
router.get('/content', requireAuth, requireCreator, async (req, res, next) => {
  try {
    const { status } = req.query
    const filter = { creatorId: req.user._id }
    if (status) filter.submissionStatus = status

    const items = await Content.find(filter)
      .sort({ updatedAt: -1 })
      .select('title type genre rating isPremium isFeatured submissionStatus rejectionReason revisionCount viewCount likeCount posterUrl backdropUrl bunnyVideoId releaseYear createdAt updatedAt')
      .lean()

    res.json(items)
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/creator/content
 * Approved creators — create a new draft submission.
 */
router.post('/content', requireAuth, requireCreator, async (req, res, next) => {
  try {
    const {
      title, subtitle, type = 'Film', genre = [], cast = [], director = '',
      releaseYear, rating = 0, desc = '', posterUrl = '', backdropUrl = '',
      contentLanguage = 'Bengali', certification = null, duration = '',
      contentWarnings = '', moodTags = [], badge = null,
      isPremium = false, episodes = [],
    } = req.body

    if (!title?.trim()) return res.status(400).json({ error: 'Title is required' })
    if (!['Film', 'Series', 'Documentary'].includes(type)) {
      return res.status(400).json({ error: 'Invalid type' })
    }

    const content = await Content.create({
      title:            title.trim(),
      subtitle:         subtitle?.trim() || '',
      type,
      genre:            Array.isArray(genre) ? genre : [],
      cast:             Array.isArray(cast)  ? cast  : [],
      director:         director?.trim() || '',
      releaseYear:      releaseYear ? Number(releaseYear) : null,
      rating:           Number(rating) || 0,
      desc:             desc?.trim() || '',
      posterUrl:        posterUrl?.trim() || '',
      backdropUrl:      backdropUrl?.trim() || '',
      contentLanguage:  contentLanguage || 'Bengali',
      certification:    certification || null,
      duration:         type !== 'Series' ? (duration?.trim() || '') : '',
      contentWarnings:  contentWarnings?.trim() || '',
      moodTags:         Array.isArray(moodTags) ? moodTags : [],
      badge:            badge || null,
      isPremium:        Boolean(isPremium),
      episodes:         Array.isArray(episodes)
        ? episodes
            .filter((ep) => ep.number && ep.title)
            .map((ep) => ({
              number:      Number(ep.number),
              title:       String(ep.title).trim(),
              duration:    String(ep.duration || '').trim(),
              bunnyVideoId: '',
            }))
        : [],
      creatorId:        req.user._id,
      submissionStatus: 'pending',
      revisionCount:    0,
    })

    res.status(201).json(content)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/creator/content/:id
 * Approved creators — get one of their own submissions.
 */
router.get('/content/:id', requireAuth, requireCreator, async (req, res, next) => {
  try {
    const content = await Content.findOne({ _id: req.params.id, creatorId: req.user._id }).lean()
    if (!content) return res.status(404).json({ error: 'Content not found' })
    res.json(content)
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/creator/content/:id
 * Approved creators — update metadata on their own content (only if pending or rejected).
 */
router.patch('/content/:id', requireAuth, requireCreator, async (req, res, next) => {
  try {
    const content = await Content.findOne({ _id: req.params.id, creatorId: req.user._id })
    if (!content) return res.status(404).json({ error: 'Content not found' })
    if (content.submissionStatus === 'approved') {
      return res.status(400).json({ error: 'Approved content cannot be edited' })
    }

    const ALLOWED = [
      'title', 'subtitle', 'desc', 'type', 'genre', 'cast', 'director',
      'releaseYear', 'rating', 'posterUrl', 'backdropUrl', 'palette',
      'contentLanguage', 'certification', 'contentWarnings', 'moodTags', 'duration',
      'badge', 'isPremium', 'bunnyVideoId', 'episodes',
    ]

    const updates = {}
    for (const key of ALLOWED) {
      if (key in req.body) updates[key] = req.body[key]
    }

    const updated = await Content.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).lean()

    res.json(updated)
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/creator/content/:id/resubmit
 * Creators can resubmit rejected content after editing.
 */
router.post('/content/:id/resubmit', requireAuth, requireCreator, async (req, res, next) => {
  try {
    const content = await Content.findOne({ _id: req.params.id, creatorId: req.user._id })
    if (!content) return res.status(404).json({ error: 'Content not found' })
    if (content.submissionStatus !== 'rejected') {
      return res.status(400).json({ error: 'Only rejected content can be resubmitted' })
    }

    const updated = await Content.findByIdAndUpdate(
      req.params.id,
      { $set: { submissionStatus: 'pending', rejectionReason: '' }, $inc: { revisionCount: 1 } },
      { new: true }
    ).lean()

    res.json(updated)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/creator/revenue
 * Approved creators — earnings overview, monthly chart, per-content breakdown, payout history, tier.
 */
router.get('/revenue', requireAuth, requireCreator, async (req, res, next) => {
  try {
    const creatorId = req.user._id

    // ── Tier lookup ───────────────────────────────────────────────────────────
    const TIERS = [
      { name: 'Newcomer',    level: 1, minViews: 0,       maxViews: 999,    share: 60, nextTier: 'Rising Star',  nextMin: 1_000    },
      { name: 'Rising Star', level: 2, minViews: 1_000,   maxViews: 9_999,  share: 65, nextTier: 'Established',  nextMin: 10_000   },
      { name: 'Established', level: 3, minViews: 10_000,  maxViews: 99_999, share: 70, nextTier: 'Featured',     nextMin: 100_000  },
      { name: 'Featured',    level: 4, minViews: 100_000, maxViews: Infinity, share: 75, nextTier: null, nextMin: null },
    ]

    // Total views across all approved content
    const [viewAgg] = await Content.aggregate([
      { $match: { creatorId, submissionStatus: 'approved' } },
      { $group: { _id: null, totalViews: { $sum: '$viewCount' } } },
    ])
    const totalViews = viewAgg?.totalViews ?? 0
    const tier = TIERS.find((t) => totalViews <= t.maxViews) || TIERS[TIERS.length - 1]
    const progress = tier.nextMin
      ? Math.min(Math.round(((totalViews - tier.minViews) / (tier.nextMin - tier.minViews)) * 100), 100)
      : 100

    // ── All earnings for this creator ─────────────────────────────────────────
    const earnings = await CreatorEarning.find({ creatorId })
      .populate('contentId', 'title type posterUrl viewCount')
      .sort({ year: -1, month: -1 })
      .lean()

    // Overview aggregation
    const now = new Date()
    const thisMonth = now.getMonth() + 1
    const thisYear  = now.getFullYear()

    let totalEarnedPaise = 0, thisMonthPaise = 0, pendingPaise = 0, paidPaise = 0
    for (const e of earnings) {
      totalEarnedPaise += e.netAmountPaise
      if (e.year === thisYear && e.month === thisMonth) thisMonthPaise += e.netAmountPaise
      if (e.status === 'pending') pendingPaise += e.netAmountPaise
      else                         paidPaise   += e.netAmountPaise
    }

    // ── Monthly chart — last 6 months ─────────────────────────────────────────
    const monthly = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(thisYear, thisMonth - 1 - i, 1)
      const m = d.getMonth() + 1
      const y = d.getFullYear()
      const amount = earnings
        .filter((e) => e.month === m && e.year === y)
        .reduce((sum, e) => sum + e.netAmountPaise, 0)
      monthly.push({
        month: d.toLocaleString('en-IN', { month: 'short' }),
        year:  y,
        amount: Math.round(amount / 100),  // convert paise → rupees
      })
    }

    // ── Per-content breakdown ─────────────────────────────────────────────────
    const contentMap = new Map()
    for (const e of earnings) {
      const cid = String(e.contentId?._id ?? e.contentId)
      if (!contentMap.has(cid)) {
        contentMap.set(cid, {
          _id:          cid,
          title:        e.contentId?.title       ?? 'Unknown',
          type:         e.contentId?.type        ?? '—',
          posterUrl:    e.contentId?.posterUrl   ?? '',
          viewCount:    e.contentId?.viewCount   ?? 0,
          revenueShare: e.revenueSharePct,
          earned:       0,
        })
      }
      contentMap.get(cid).earned += Math.round(e.netAmountPaise / 100)
    }

    // ── Payout history ────────────────────────────────────────────────────────
    const payouts = await CreatorPayout.find({ creatorId })
      .sort({ createdAt: -1 })
      .lean()

    res.json({
      overview: {
        totalEarned:    Math.round(totalEarnedPaise / 100),
        thisMonth:      Math.round(thisMonthPaise   / 100),
        pendingPayout:  Math.round(pendingPaise     / 100),
        paidOut:        Math.round(paidPaise        / 100),
      },
      monthly,
      content: [...contentMap.values()],
      payouts: payouts.map((p) => ({
        _id:    p._id,
        amount: Math.round(p.amountPaise / 100),
        date:   p.paidAt ?? p.createdAt,
        status: p.status,
        method: p.method,
      })),
      tier: {
        name:         tier.name,
        level:        tier.level,
        totalViews,
        revenueShare: tier.share,
        nextTier:     tier.nextTier,
        nextMinViews: tier.nextMin,
        progress,
      },
    })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/creator/content/:id
 * Creators can delete their own pending or rejected content.
 */
router.delete('/content/:id', requireAuth, requireCreator, async (req, res, next) => {
  try {
    const content = await Content.findOne({ _id: req.params.id, creatorId: req.user._id })
    if (!content) return res.status(404).json({ error: 'Content not found' })
    if (content.submissionStatus === 'approved') {
      return res.status(400).json({ error: 'Approved content cannot be deleted' })
    }
    await content.deleteOne()
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

export default router
