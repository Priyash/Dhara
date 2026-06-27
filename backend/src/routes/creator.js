import { Router } from 'express'
import { User } from '../models/User.js'
import { Content } from '../models/Content.js'
import { CreatorEarning } from '../models/CreatorEarning.js'
import { CreatorPayout } from '../models/CreatorPayout.js'
import { ViewEvent } from '../models/ViewEvent.js'
import { ContentRankSnapshot } from '../models/ContentRankSnapshot.js'
import { requireAuth } from '../middleware/auth.js'
import { emailTierAdvancement } from '../config/email.js'
import { Reel, REEL_MAX_DURATION_SECS } from '../models/Reel.js'
import { bunnyRequest } from '../services/bunnyUpload.js'
import { ThumbnailVariant } from '../models/ThumbnailVariant.js'
import { withVariantStats } from '../utils/variantStats.js'
import { validateVariantImageUrl } from '../utils/variantImage.js'

const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID

// Returns 'YYYY-MM-DD' in IST for a given UTC Date (default: now)
function istDate(d = new Date()) {
  return new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10)
}

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
const MAX_REVISIONS = 5

router.post('/apply', requireAuth, async (req, res, next) => {
  try {
    if (req.user.creatorStatus === 'approved') {
      return res.status(400).json({ error: 'You are already an approved creator' })
    }
    if (req.user.creatorStatus === 'applied') {
      return res.status(400).json({ error: 'Your application is already under review' })
    }

    // Enforce reapply cooldown after three-strikes
    if (req.user.creatorReapplyAfter && new Date() < req.user.creatorReapplyAfter) {
      const daysLeft = Math.ceil((req.user.creatorReapplyAfter - new Date()) / 86_400_000)
      return res.status(429).json({
        error: `You can reapply in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}. Please review our creator guidelines before reapplying.`,
        reapplyAfter: req.user.creatorReapplyAfter,
      })
    }

    const { studioName, bio, portfolioUrl, sampleWorkUrl, contentTypes } = req.body

    if (!studioName?.trim())
      return res.status(400).json({ error: 'Studio name is required' })
    if (String(studioName).length > 120)
      return res.status(400).json({ error: 'Studio name must be 120 characters or fewer' })
    if (!sampleWorkUrl?.trim())
      return res.status(400).json({ error: 'A link to your sample work is required' })
    if (String(sampleWorkUrl).length > 500)
      return res.status(400).json({ error: 'Sample work URL must be 500 characters or fewer' })
    if (bio && String(bio).length > 1000)
      return res.status(400).json({ error: 'Bio must be 1000 characters or fewer' })
    if (!Array.isArray(contentTypes) || contentTypes.length === 0)
      return res.status(400).json({ error: 'Select at least one content type you plan to upload' })

    const VALID_TYPES = ['Film', 'Series', 'Serial Drama', 'Documentary']
    const sanitizedTypes = contentTypes.filter((t) => VALID_TYPES.includes(t))
    if (sanitizedTypes.length === 0)
      return res.status(400).json({ error: 'Invalid content type selection' })

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          creatorStatus:                 'applied',
          'creatorProfile.studioName':   String(studioName).trim().slice(0, 120),
          'creatorProfile.bio':          String(bio || '').trim().slice(0, 1000),
          'creatorProfile.portfolioUrl': String(portfolioUrl || '').trim().slice(0, 500),
          'creatorProfile.sampleWorkUrl': String(sampleWorkUrl).trim().slice(0, 500),
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
    creatorRejectedAt:      req.user.creatorRejectedAt  ?? null,
    creatorReapplyAfter:    req.user.creatorReapplyAfter ?? null,
    creatorRejectionCount:  req.user.creatorRejectionCount ?? 0,
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
    if (studioName !== undefined) {
      if (String(studioName).length > 120) return res.status(400).json({ error: 'Studio name must be 120 characters or fewer' })
      updates['creatorProfile.studioName'] = String(studioName).trim().slice(0, 120)
    }
    if (bio !== undefined) {
      if (String(bio).length > 1000) return res.status(400).json({ error: 'Bio must be 1000 characters or fewer' })
      updates['creatorProfile.bio'] = String(bio).trim().slice(0, 1000)
    }
    if (portfolioUrl !== undefined) {
      updates['creatorProfile.portfolioUrl'] = String(portfolioUrl).trim().slice(0, 500)
    }
    if (sampleWorkUrl !== undefined) {
      if (String(sampleWorkUrl).length > 500) return res.status(400).json({ error: 'Sample work URL must be 500 characters or fewer' })
      updates['creatorProfile.sampleWorkUrl'] = String(sampleWorkUrl).trim().slice(0, 500)
    }
    if (contentTypes !== undefined && Array.isArray(contentTypes)) {
      const VALID = ['Film', 'Series', 'Serial Drama', 'Documentary']
      updates['creatorProfile.contentTypes'] = contentTypes.filter((t) => VALID.includes(t))
    }

    const user = await User.findByIdAndUpdate(req.user._id, { $set: updates }, { new: true })
    res.json({ creatorProfile: user.creatorProfile })
  } catch (err) {
    next(err)
  }
})

// Masks a sensitive identifier down to its last 4 characters, e.g. "••••1234".
function maskTail(value) {
  if (!value) return ''
  const tail = String(value).slice(-4)
  return tail.length < String(value).length ? `••••${tail}` : value
}

/**
 * GET /api/creator/payout-details
 * Approved creators — returns their saved bank/UPI details with sensitive
 * fields masked. `hasDetails` tells the UI whether to show "Edit" vs "Add".
 */
router.get('/payout-details', requireAuth, requireCreator, async (req, res) => {
  const d = req.user.creatorPayoutDetails || {}
  res.json({
    hasDetails:        Boolean(d.method),
    method:            d.method || null,
    accountHolderName: d.accountHolderName || '',
    accountNumber:     maskTail(d.accountNumber),
    ifsc:              d.ifsc || '',
    upiId:             d.upiId ? `${maskTail(d.upiId.split('@')[0])}@${d.upiId.split('@')[1] || ''}` : '',
    updatedAt:         d.updatedAt || null,
  })
})

/**
 * PUT /api/creator/payout-details
 * Approved creators — add or replace their bank/UPI payout details.
 * Clears any previously-linked RazorpayX fund account so the auto-payout
 * job re-creates one against the new details on the next run.
 */
router.put('/payout-details', requireAuth, requireCreator, async (req, res, next) => {
  try {
    const { method, accountHolderName, accountNumber, ifsc, upiId } = req.body

    if (!['bank', 'upi'].includes(method)) {
      return res.status(400).json({ error: 'method must be "bank" or "upi"' })
    }

    const updates = {
      'creatorPayoutDetails.method':                method,
      'creatorPayoutDetails.razorpayFundAccountId':  '',
      'creatorPayoutDetails.updatedAt':              new Date(),
    }

    if (method === 'bank') {
      if (!accountHolderName?.trim()) return res.status(400).json({ error: 'Account holder name is required' })
      if (!/^[0-9]{6,20}$/.test(String(accountNumber || '').trim())) {
        return res.status(400).json({ error: 'Account number must be 6–20 digits' })
      }
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(ifsc || '').trim().toUpperCase())) {
        return res.status(400).json({ error: 'Enter a valid IFSC code' })
      }
      updates['creatorPayoutDetails.accountHolderName'] = String(accountHolderName).trim().slice(0, 120)
      updates['creatorPayoutDetails.accountNumber']     = String(accountNumber).trim()
      updates['creatorPayoutDetails.ifsc']              = String(ifsc).trim().toUpperCase()
      updates['creatorPayoutDetails.upiId']              = ''
    } else {
      if (!/^[\w.+-]{2,256}@[a-zA-Z]{2,64}$/.test(String(upiId || '').trim())) {
        return res.status(400).json({ error: 'Enter a valid UPI ID (e.g. name@bank)' })
      }
      updates['creatorPayoutDetails.upiId']              = String(upiId).trim()
      updates['creatorPayoutDetails.accountHolderName']  = ''
      updates['creatorPayoutDetails.accountNumber']      = ''
      updates['creatorPayoutDetails.ifsc']               = ''
    }

    await User.findByIdAndUpdate(req.user._id, { $set: updates })
    res.json({ success: true })
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
    const creatorId = req.user._id

    const items = await Content.find({ creatorId })
      .select('title type posterUrl submissionStatus viewCount likeCount revisionCount seasons createdAt')
      .lean()

    const approved = items.filter((i) => i.submissionStatus === 'approved')
    const pending  = items.filter((i) => i.submissionStatus === 'pending')
    const rejected = items.filter((i) => i.submissionStatus === 'rejected')

    const totalViews = approved.reduce((s, i) => s + (i.viewCount  || 0), 0)
    const totalLikes = approved.reduce((s, i) => s + (i.likeCount  || 0), 0)

    const totalEpisodes = approved
      .filter((i) => i.type === 'Series' || i.type === 'Serial Drama')
      .reduce((s, i) => s + (i.seasons || []).reduce((a, se) => a + (se.episodes?.length || 0), 0), 0)

    const settled      = approved.length + rejected.length
    const approvalRate = settled > 0 ? Math.round((approved.length / settled) * 100) : 0
    const engagementRate = totalViews > 0
      ? Number(((totalLikes / totalViews) * 100).toFixed(1)) : 0
    const avgViewsPerTitle = approved.length > 0 ? Math.round(totalViews / approved.length) : 0
    const topContent = approved.slice().sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))[0] || null

    // ── ViewEvent aggregations ─────────────────────────────────────────────────
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000)

    const [dailyAgg, hourlyAgg, stateAgg] = await Promise.all([
      ViewEvent.aggregate([
        { $match: { creatorId, viewedAt: { $gte: sevenDaysAgo } } },
        { $group: {
            _id:   { $dateToString: { format: '%Y-%m-%d', date: '$viewedAt', timezone: 'Asia/Kolkata' } },
            views: { $sum: 1 },
        }},
        { $sort: { _id: 1 } },
      ]),
      ViewEvent.aggregate([
        { $match: { creatorId } },
        { $group: { _id: '$hour', views: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      ViewEvent.aggregate([
        { $match: { creatorId } },
        { $group: { _id: '$state', views: { $sum: 1 } } },
        { $sort: { views: -1 } },
        { $limit: 10 },
      ]),
    ])

    // Fill 7-day array (all days present, zeros for missing)
    const viewsByDay = Array.from({ length: 7 }, (_, i) => {
      const dateStr = istDate(new Date(Date.now() - (6 - i) * 86_400_000))
      const found   = dailyAgg.find((a) => a._id === dateStr)
      return { date: dateStr, views: found?.views || 0 }
    })

    // Fill 24-hour slots
    const viewsByHour = Array.from({ length: 24 }, (_, h) => {
      const found = hourlyAgg.find((a) => a._id === h)
      return { hour: h, views: found?.views || 0 }
    })

    const viewsByState = stateAgg.map((a) => ({ state: a._id, views: a.views }))

    // ── Ranking deltas (yesterday's snapshot vs current) ───────────────────────
    const todayStr     = istDate()
    const yesterdayStr = istDate(new Date(Date.now() - 86_400_000))

    const currentRankings = items
      .slice()
      .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
      .map((item, idx) => ({ contentId: item._id, rank: idx + 1, viewCount: item.viewCount || 0 }))

    // Lazily persist today's snapshot only once per day
    ContentRankSnapshot.findOneAndUpdate(
      { creatorId, snapshotDate: todayStr },
      { $setOnInsert: { creatorId, snapshotDate: todayStr, rankings: currentRankings } },
      { upsert: true }
    ).catch(() => {})

    const yesterdaySnap = await ContentRankSnapshot.findOne({ creatorId, snapshotDate: yesterdayStr }).lean()
    const rankingDeltas = {}
    if (yesterdaySnap) {
      const yMap = Object.fromEntries(yesterdaySnap.rankings.map((r) => [String(r.contentId), r.rank]))
      for (const r of currentRankings) {
        const cid = String(r.contentId)
        rankingDeltas[cid] = yMap[cid] != null ? yMap[cid] - r.rank : 0
      }
    }

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
        seasons: (i.type === 'Series' || i.type === 'Serial Drama')
          ? (i.seasons || []).map((s) => ({
              number:   s.number,
              title:    s.title || '',
              episodes: (s.episodes || []).map((ep) => ({ number: ep.number, title: ep.title, viewCount: ep.viewCount || 0 })),
            }))
          : [],
        createdAt: i.createdAt,
      })),
      viewsByDay,
      viewsByHour,
      viewsByState,
      rankingDeltas,
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
    const { status, page, limit: rawLimit } = req.query
    const filter = { creatorId: req.user._id }
    if (status) filter.submissionStatus = status

    const pageNum  = Math.max(1, parseInt(page, 10) || 1)
    const limitNum = Math.min(50, Math.max(1, parseInt(rawLimit, 10) || 20))
    const skip     = (pageNum - 1) * limitNum

    const [items, total] = await Promise.all([
      Content.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .select('title type genre rating isPremium isFeatured submissionStatus rejectionReason revisionCount viewCount likeCount posterUrl backdropUrl bunnyVideoId releaseYear createdAt updatedAt')
        .lean(),
      Content.countDocuments(filter),
    ])

    res.json({ items, total, page: pageNum, pages: Math.ceil(total / limitNum), limit: limitNum })
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
      isPremium = false, seasons = [],
    } = req.body

    if (!title?.trim()) return res.status(400).json({ error: 'Title is required' })
    if (!['Film', 'Series', 'Serial Drama', 'Documentary'].includes(type)) {
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
      duration:         (type !== 'Series' && type !== 'Serial Drama') ? (duration?.trim() || '') : '',
      contentWarnings:  contentWarnings?.trim() || '',
      moodTags:         Array.isArray(moodTags) ? moodTags : [],
      badge:            badge || null,
      isPremium:        Boolean(isPremium),
      seasons:          Array.isArray(seasons)
        ? seasons
            .filter((s) => s.number)
            .map((s) => ({
              number:   Number(s.number),
              title:    String(s.title || '').trim(),
              episodes: Array.isArray(s.episodes)
                ? s.episodes
                    .filter((ep) => ep.number && ep.title)
                    .map((ep) => ({
                      number:       Number(ep.number),
                      title:        String(ep.title).trim(),
                      desc:         String(ep.desc  || '').trim(),
                      duration:     String(ep.duration || '').trim(),
                      bunnyVideoId: '',
                    }))
                : [],
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

    // Creators may only update human-readable metadata.
    // Excluded intentionally:
    //   bunnyVideoId  — assigned exclusively by upload-job / admin
    //   badge         — editorial label ('NEW', 'LIVE') set only by admins
    //   rating        — computed from community votes, not creator-declared
    //   isFeatured    — admin editorial control
    //   isPublished   — admin publish gate
    //   submissionStatus / revisionCount — state machine managed by server
    const ALLOWED = [
      'title', 'subtitle', 'desc', 'type', 'genre', 'cast', 'director',
      'releaseYear', 'posterUrl', 'backdropUrl', 'palette', 'subtitleUrl',
      'contentLanguage', 'certification', 'contentWarnings', 'moodTags', 'duration',
      'isPremium', 'seasons',
    ]

    const updates = {}
    for (const key of ALLOWED) {
      if (key in req.body) updates[key] = req.body[key]
    }

    if (Array.isArray(updates.seasons)) {
      // Preserve server-assigned bunnyVideoId and viewCount when creator updates season/episode metadata
      const existingSeasonMap = new Map(
        (content.seasons || []).map((s) => [s.number, s])
      )
      updates.seasons = updates.seasons
        .filter((s) => s.number)
        .map((s) => {
          const sNum   = Number(s.number)
          const prevS  = existingSeasonMap.get(sNum)
          const existingEpMap = new Map((prevS?.episodes || []).map((ep) => [ep.number, ep]))
          return {
            number:   sNum,
            title:    String(s.title || '').trim(),
            episodes: Array.isArray(s.episodes)
              ? s.episodes
                  .filter((ep) => ep.number && ep.title)
                  .map((ep) => {
                    const num  = Number(ep.number)
                    const prev = existingEpMap.get(num)
                    return {
                      number:       num,
                      title:        String(ep.title).trim(),
                      desc:         String(ep.desc  || '').trim(),
                      duration:     String(ep.duration || '').trim(),
                      bunnyVideoId: prev?.bunnyVideoId || '',
                      subtitleUrl:  String(ep.subtitleUrl || '').trim(),
                      viewCount:    prev?.viewCount    || 0,
                    }
                  })
              : [],
          }
        })
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
    if ((content.revisionCount || 0) >= MAX_REVISIONS) {
      return res.status(429).json({
        error: `This submission has reached the maximum of ${MAX_REVISIONS} revisions. Please contact support if you believe this is in error.`,
      })
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

    // Notify creator when they advance to a new tier.
    // Atomic: only the request that actually flips the field sends the email.
    const prevTier = req.user.creatorTier || 'Newcomer'
    let tierAdvanced = false
    if (tier.name !== prevTier) {
      const updated = await User.findOneAndUpdate(
        { _id: creatorId, creatorTier: prevTier },
        { $set: { creatorTier: tier.name } },
        { new: false }
      )
      tierAdvanced = !!updated
      if (updated) {
        emailTierAdvancement(
          req.user.creatorProfile?.studioName || req.user.displayName,
          req.user.email,
          prevTier,
          tier.name,
          tier.share
        ).catch((err) => console.error('[email] tier-advancement failed:', err.message))
      }
    }

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
      tierAdvanced,
      newTierName: tierAdvanced ? tier.name : null,
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

// ── Creator thumbnail variants (artwork A/B) ────────────────────────────────
// Creators manage artwork variants for their OWN content. Ownership is checked
// on every route via the content's creatorId. See docs/thumbnail-trailer-pipeline.md.

/** Loads a variant only if it belongs to content this creator owns; else null. */
async function ownedVariant(variantId, creatorId) {
  const variant = await ThumbnailVariant.findById(variantId)
  if (!variant || variant.itemType !== 'content') return null
  const owns = await Content.exists({ _id: variant.itemId, creatorId })
  return owns ? variant : null
}

/**
 * GET /api/creator/content/:id/thumbnail-variants
 * Lists artwork variants (with read-time CTR stats) for one of the creator's titles.
 */
router.get('/content/:id/thumbnail-variants', requireAuth, requireCreator, async (req, res, next) => {
  try {
    const owns = await Content.exists({ _id: req.params.id, creatorId: req.user._id })
    if (!owns) return res.status(404).json({ error: 'Content not found' })

    const variants = await ThumbnailVariant.find({ itemType: 'content', itemId: req.params.id })
      .sort({ createdAt: -1 })
      .lean()
    res.json(await withVariantStats(variants))
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/creator/content/:id/thumbnail-variants
 * Seeds a candidate variant for one of the creator's titles. Body: { imageUrl, label? }.
 */
router.post('/content/:id/thumbnail-variants', requireAuth, requireCreator, async (req, res, next) => {
  try {
    const owns = await Content.exists({ _id: req.params.id, creatorId: req.user._id })
    if (!owns) return res.status(404).json({ error: 'Content not found' })

    const { imageUrl, label } = req.body || {}
    const imgCheck = validateVariantImageUrl(imageUrl)
    if (!imgCheck.ok) {
      return res.status(400).json({ error: imgCheck.error })
    }

    const variant = await ThumbnailVariant.create({
      itemType:  'content',
      itemId:    req.params.id,
      imageUrl:  imgCheck.url,
      label:     label ? String(label).trim().slice(0, 120) : '',
      source:    'manual',
      status:    'candidate',
      createdBy: req.user._id,
    })
    res.status(201).json(variant)
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/creator/thumbnail-variants/:id   Body: { status?, label? }
 */
router.patch('/thumbnail-variants/:id', requireAuth, requireCreator, async (req, res, next) => {
  try {
    const variant = await ownedVariant(req.params.id, req.user._id)
    if (!variant) return res.status(404).json({ error: 'Variant not found' })

    if (req.body?.status != null) {
      if (!['candidate', 'live', 'rejected'].includes(req.body.status)) {
        return res.status(400).json({ error: 'status must be candidate, live, or rejected' })
      }
      variant.status = req.body.status
    }
    if (req.body?.label != null) variant.label = String(req.body.label).trim().slice(0, 120)
    await variant.save()
    res.json(variant)
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/creator/thumbnail-variants/:id
 */
router.delete('/thumbnail-variants/:id', requireAuth, requireCreator, async (req, res, next) => {
  try {
    const variant = await ownedVariant(req.params.id, req.user._id)
    if (!variant) return res.status(404).json({ error: 'Variant not found' })
    await variant.deleteOne()
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ── Creator Reels ─────────────────────────────────────────────────────────────

/**
 * GET /api/creator/reels
 * Any authenticated user — list their own reels.
 */
router.get('/reels', requireAuth, async (req, res, next) => {
  try {
    const { status, page, limit: rawLimit } = req.query
    const filter  = { creatorId: req.user._id, isDeleted: { $ne: true } }
    if (status) filter.submissionStatus = status

    const pageNum  = Math.max(1, parseInt(page,     10) || 1)
    const limitNum = Math.min(50, Math.max(1, parseInt(rawLimit, 10) || 20))

    const [items, total] = await Promise.all([
      Reel.find(filter)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      Reel.countDocuments(filter),
    ])

    res.json({ items, total, page: pageNum, pages: Math.ceil(total / limitNum), limit: limitNum })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/creator/reels
 * Approved creators only — upload access requires a creator account.
 * Regular users can watch/like/comment but cannot upload reels.
 */
const DAILY_REEL_LIMIT = 5   // max reels a creator can submit per calendar day (IST)

router.post('/reels', requireAuth, requireCreator, async (req, res, next) => {
  try {
    // Daily upload limit — count reels created today (IST midnight → now)
    const nowIST       = new Date(Date.now() + 5.5 * 3_600_000)
    const todayIST     = new Date(nowIST.toISOString().slice(0, 10) + 'T00:00:00+05:30')
    const todayCount   = await Reel.countDocuments({
      creatorId:  req.user._id,
      createdAt:  { $gte: todayIST },
      isDeleted:  { $ne: true },
    })
    if (todayCount >= DAILY_REEL_LIMIT) {
      return res.status(429).json({
        error: `Daily upload limit reached. You can submit up to ${DAILY_REEL_LIMIT} reels per day.`,
        code:  'DAILY_REEL_LIMIT_REACHED',
        limit: DAILY_REEL_LIMIT,
      })
    }

    const {
      title = '', description = '', hashtags = [],
      aspectRatio = '9:16', thumbnailUrl = '', durationSecs,
    } = req.body

    if (durationSecs != null && Number(durationSecs) > REEL_MAX_DURATION_SECS) {
      return res.status(400).json({
        error: `Reels must be ${REEL_MAX_DURATION_SECS} seconds or shorter`,
      })
    }

    const VALID_RATIOS = ['9:16', '16:9', '1:1']
    if (aspectRatio && !VALID_RATIOS.includes(aspectRatio)) {
      return res.status(400).json({ error: `aspectRatio must be one of: ${VALID_RATIOS.join(', ')}` })
    }

    // Normalise hashtags: lowercase, strip leading '#', deduplicate
    const normalizedTags = [...new Set(
      (Array.isArray(hashtags) ? hashtags : [])
        .map((t) => String(t).toLowerCase().replace(/^#/, '').trim())
        .filter(Boolean)
    )]

    const reel = await Reel.create({
      creatorId:    req.user._id,
      title:        String(title).trim(),
      description:  String(description).trim(),
      hashtags:     normalizedTags,
      aspectRatio,
      thumbnailUrl: String(thumbnailUrl).trim(),
      durationSecs: durationSecs != null ? Number(durationSecs) : 0,
      submissionStatus: 'pending',
    })

    res.status(201).json(reel)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/creator/reels/analytics
 * Reel analytics: overview stats + 7-day view chart.
 * Must be declared before /reels/:id to avoid Express treating "analytics" as an ID.
 */
router.get('/reels/analytics', requireAuth, async (req, res, next) => {
  try {
    const creatorId    = req.user._id
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000)

    const reels = await Reel.find({ creatorId, isDeleted: { $ne: true } })
      .select('submissionStatus viewCount likeCount commentCount title createdAt')
      .lean()

    const approved = reels.filter((r) => r.submissionStatus === 'approved')
    const rejected = reels.filter((r) => r.submissionStatus === 'rejected')

    const totalViews    = reels.reduce((s, r) => s + (r.viewCount    || 0), 0)
    const totalLikes    = reels.reduce((s, r) => s + (r.likeCount    || 0), 0)
    const totalComments = reels.reduce((s, r) => s + (r.commentCount || 0), 0)
    const approvalRate  = (approved.length + rejected.length) > 0
      ? Math.round((approved.length / (approved.length + rejected.length)) * 100) : null
    const topReel = approved.length
      ? [...approved].sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))[0] : null

    // 7-day view chart from ViewEvent (reelId is stored as contentId)
    const reelIds = reels.map((r) => r._id)

    const [dailyAgg, hourlyAgg, stateAgg, dowAgg] = reelIds.length
      ? await Promise.all([
          // 7-day daily views
          ViewEvent.aggregate([
            { $match: { contentId: { $in: reelIds }, viewedAt: { $gte: sevenDaysAgo } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$viewedAt', timezone: 'Asia/Kolkata' } }, views: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ]),
          // Hour-of-day breakdown (all time)
          ViewEvent.aggregate([
            { $match: { contentId: { $in: reelIds } } },
            { $group: { _id: '$hour', views: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ]),
          // Top 8 states
          ViewEvent.aggregate([
            { $match: { contentId: { $in: reelIds } } },
            { $group: { _id: '$state', views: { $sum: 1 } } },
            { $sort: { views: -1 } },
            { $limit: 8 },
          ]),
          // Day-of-week breakdown
          ViewEvent.aggregate([
            { $match: { contentId: { $in: reelIds } } },
            { $group: { _id: '$dayOfWeek', views: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ]),
        ])
      : [[], [], [], []]

    const viewsByDay = Array.from({ length: 7 }, (_, i) => {
      const d       = new Date(Date.now() - (6 - i) * 86_400_000)
      const dateStr = new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10)
      return { date: dateStr, views: dailyAgg.find((a) => a._id === dateStr)?.views || 0 }
    })

    const viewsByHour = Array.from({ length: 24 }, (_, h) => ({
      hour:  h,
      views: hourlyAgg.find((a) => a._id === h)?.views || 0,
    }))

    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const viewsByDow = Array.from({ length: 7 }, (_, d) => ({
      day:   DAYS[d],
      views: dowAgg.find((a) => a._id === d)?.views || 0,
    }))

    const peakHour = viewsByHour.reduce((best, h) => h.views > best.views ? h : best, { hour: 0, views: 0 })
    const peakDay  = viewsByDow.reduce((best, d)  => d.views  > best.views ? d  : best, { day: 'Mon', views: 0 })

    res.json({
      overview: {
        total:          reels.length,
        approved:       approved.length,
        pending:        reels.filter((r) => r.submissionStatus === 'pending').length,
        rejected:       rejected.length,
        totalViews,
        totalLikes,
        totalComments,
        approvalRate,
        engagementRate: totalViews > 0 ? Number(((totalLikes / totalViews) * 100).toFixed(1)) : 0,
        topReel:   topReel   ? { _id: topReel._id,   title: topReel.title,   viewCount: topReel.viewCount   || 0 } : null,
        peakHour:  peakHour.views > 0 ? peakHour.hour : null,
        peakDay:   peakDay.views  > 0 ? peakDay.day   : null,
      },
      viewsByDay,
      viewsByHour,
      viewsByState: stateAgg.map((s) => ({ state: s._id || 'Unknown', views: s.views })),
      viewsByDow,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/creator/reels/:id
 * Any authenticated user — get one of their own reels.
 */
router.get('/reels/:id', requireAuth, async (req, res, next) => {
  try {
    const reel = await Reel.findOne({ _id: req.params.id, creatorId: req.user._id }).lean()
    if (!reel) return res.status(404).json({ error: 'Reel not found' })
    res.json(reel)
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/creator/reels/:id
 * Any authenticated user — update metadata on their own pending or rejected reel.
 * bunnyVideoId is excluded — only upload-job/admin may write it.
 */
router.patch('/reels/:id', requireAuth, async (req, res, next) => {
  try {
    const reel = await Reel.findOne({ _id: req.params.id, creatorId: req.user._id })
    if (!reel) return res.status(404).json({ error: 'Reel not found' })
    if (reel.submissionStatus === 'approved') {
      return res.status(400).json({ error: 'Approved reels cannot be edited' })
    }

    const ALLOWED = ['title', 'description', 'hashtags', 'aspectRatio', 'thumbnailUrl', 'durationSecs']
    const updates = {}
    for (const key of ALLOWED) {
      if (key in req.body) updates[key] = req.body[key]
    }

    if (updates.durationSecs != null && Number(updates.durationSecs) > REEL_MAX_DURATION_SECS) {
      return res.status(400).json({ error: `Reels must be ${REEL_MAX_DURATION_SECS} seconds or shorter` })
    }

    if (updates.hashtags != null) {
      updates.hashtags = [...new Set(
        (Array.isArray(updates.hashtags) ? updates.hashtags : [])
          .map((t) => String(t).toLowerCase().replace(/^#/, '').trim())
          .filter(Boolean)
      )]
    }

    const updated = await Reel.findByIdAndUpdate(
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
 * POST /api/creator/reels/:id/resubmit
 * Any authenticated user can resubmit their own rejected reel.
 */
router.post('/reels/:id/resubmit', requireAuth, async (req, res, next) => {
  try {
    const reel = await Reel.findOne({ _id: req.params.id, creatorId: req.user._id })
    if (!reel) return res.status(404).json({ error: 'Reel not found' })
    if (reel.submissionStatus !== 'rejected') {
      return res.status(400).json({ error: 'Only rejected reels can be resubmitted' })
    }
    if ((reel.revisionCount || 0) >= MAX_REVISIONS) {
      return res.status(429).json({
        error: `This reel has reached the maximum of ${MAX_REVISIONS} revisions.`,
      })
    }
    // Rejection clears bunnyVideoId — creator must upload a new video before resubmitting
    if (!reel.bunnyVideoId) {
      return res.status(400).json({
        error: 'Upload a new video before resubmitting. The previous video was removed when your reel was rejected.',
        code:  'VIDEO_REQUIRED',
      })
    }

    const updated = await Reel.findByIdAndUpdate(
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
 * POST /api/creator/payouts/request
 * Creator requests a manual payout of their pending balance.
 * Minimum threshold: ₹1,000. Creates a CreatorPayout record with status 'requested'.
 * Must be declared before /reels/:id to avoid param collision.
 */
const PAYOUT_MIN_RUPEES = 1000

router.post('/payouts/request', requireAuth, requireCreator, async (req, res, next) => {
  try {
    const [earningsAgg] = await CreatorEarning.aggregate([
      { $match: { creatorId: req.user._id, status: 'pending' } },
      { $group: { _id: null, total: { $sum: '$netAmountPaise' } } },
    ])
    const pendingPaise = earningsAgg?.total ?? 0
    const pendingRupees = Math.round(pendingPaise / 100)

    if (pendingRupees < PAYOUT_MIN_RUPEES) {
      return res.status(400).json({
        error:      `Minimum payout is ₹${PAYOUT_MIN_RUPEES}. Your current balance is ₹${pendingRupees}.`,
        code:       'BELOW_PAYOUT_THRESHOLD',
        pendingRupees,
        minimumRupees: PAYOUT_MIN_RUPEES,
      })
    }

    // Check there isn't already a pending/requested payout in flight
    const inFlight = await CreatorPayout.findOne({
      creatorId: req.user._id,
      status: { $in: ['requested', 'processing'] },
    }).lean()
    if (inFlight) {
      return res.status(400).json({
        error: 'You already have a payout request in progress. Please wait for it to be processed.',
        code:  'PAYOUT_IN_PROGRESS',
      })
    }

    const payout = await CreatorPayout.create({
      creatorId:   req.user._id,
      amountPaise: pendingPaise,
      status:      'requested',
      method:      req.body.method || 'bank_transfer',
      notes:       req.body.notes  || '',
    })

    res.status(201).json({
      _id:    payout._id,
      amount: pendingRupees,
      status: payout.status,
      method: payout.method,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/creator/reels/:id
 * Any authenticated user can soft-delete their own pending or rejected reels.
 * Approved reels require admin action to remove.
 */
router.delete('/reels/:id', requireAuth, async (req, res, next) => {
  try {
    const reel = await Reel.findOne({ _id: req.params.id, creatorId: req.user._id })
    if (!reel) return res.status(404).json({ error: 'Reel not found' })
    if (reel.submissionStatus === 'approved') {
      return res.status(400).json({ error: 'Approved reels cannot be deleted. Contact support.' })
    }

    const { bunnyVideoId } = reel
    await Reel.findByIdAndUpdate(req.params.id, { $set: { isDeleted: true, bunnyVideoId: '' } })

    if (bunnyVideoId) {
      bunnyRequest(`/library/${libraryId}/videos/${bunnyVideoId}`, { method: 'DELETE' })
        .catch((err) => console.warn('[creator-reel-delete] Bunny delete failed (non-fatal):', err.message))
    }

    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

export default router
