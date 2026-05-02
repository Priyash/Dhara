import { Router } from 'express'
import { Content } from '../models/Content.js'

const router = Router()

const HIDE_STREAM = '-bunnyVideoId -trailerVideoId -episodes.bunnyVideoId'

/**
 * GET /api/search?q=byomkesh
 * Public. Two-stage strategy:
 *   1. Short queries (< 4 chars): regex prefix match on title — handles "byo" → "Byomkesh"
 *   2. Longer queries: MongoDB $text search ranked by relevance, regex fallback if index not ready
 */
router.get('/', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim()
    if (q.length < 2) return res.json([])

    let results

    // Hide pending/rejected creator submissions from search.
    // Existing admin content has no submissionStatus field and must remain visible.
    const approvedOnly = { submissionStatus: { $nin: ['pending', 'rejected'] } }

    if (q.length < 4) {
      results = await Content
        .find({ ...approvedOnly, title: { $regex: `^${q}`, $options: 'i' } })
        .sort({ rating: -1 })
        .limit(20)
        .select(HIDE_STREAM)
        .lean()
    } else {
      results = await Content
        .find({ ...approvedOnly, $text: { $search: q } }, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' } })
        .limit(20)
        .select(HIDE_STREAM)
        .lean()

      // Regex fallback if text index hasn't built yet (new Atlas cluster)
      if (results.length === 0) {
        results = await Content
          .find({ ...approvedOnly, title: { $regex: q, $options: 'i' } })
          .sort({ rating: -1 })
          .limit(20)
          .select(HIDE_STREAM)
          .lean()
      }
    }

    res.json(results)
  } catch (err) {
    next(err)
  }
})

export default router
