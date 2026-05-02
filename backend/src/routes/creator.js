import { Router } from 'express'
import { User } from '../models/User.js'
import { Content } from '../models/Content.js'
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

    const { studioName, bio, portfolioUrl } = req.body
    if (!studioName?.trim()) return res.status(400).json({ error: 'Studio name is required' })

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          creatorStatus: 'applied',
          'creatorProfile.studioName':   studioName.trim(),
          'creatorProfile.bio':          (bio || '').trim(),
          'creatorProfile.portfolioUrl': (portfolioUrl || '').trim(),
          'creatorProfile.appliedAt':    new Date(),
          creatorRejectionReason:        '',
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
  })
})

/**
 * PATCH /api/creator/profile
 * Approved creators can update their studio profile.
 */
router.patch('/profile', requireAuth, requireCreator, async (req, res, next) => {
  try {
    const { studioName, bio, portfolioUrl } = req.body
    const updates = {}
    if (studioName  !== undefined) updates['creatorProfile.studioName']   = studioName.trim()
    if (bio         !== undefined) updates['creatorProfile.bio']           = bio.trim()
    if (portfolioUrl !== undefined) updates['creatorProfile.portfolioUrl'] = portfolioUrl.trim()

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
    const [total, approved, pending, rejected] = await Promise.all([
      Content.countDocuments({ creatorId: req.user._id }),
      Content.countDocuments({ creatorId: req.user._id, submissionStatus: 'approved' }),
      Content.countDocuments({ creatorId: req.user._id, submissionStatus: 'pending' }),
      Content.countDocuments({ creatorId: req.user._id, submissionStatus: 'rejected' }),
    ])

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
      .select('title type genre rating isPremium isFeatured submissionStatus rejectionReason revisionCount posterUrl backdropUrl bunnyVideoId releaseYear createdAt updatedAt')
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
      contentLanguage = 'Bengali', certification = null,
      contentWarnings = '', moodTags = [], badge = null,
      isPremium = false,
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
      contentWarnings:  contentWarnings?.trim() || '',
      moodTags:         Array.isArray(moodTags) ? moodTags : [],
      badge:            badge || null,
      isPremium:        Boolean(isPremium),
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
      'contentLanguage', 'certification', 'contentWarnings', 'moodTags',
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
