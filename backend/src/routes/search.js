import { Router } from 'express'
import { Content } from '../models/Content.js'
import { SearchLog } from '../models/SearchLog.js'

const router = Router()

const HIDE_STREAM = '-bunnyVideoId -trailerVideoId -episodes.bunnyVideoId'

/**
 * GET /api/search?q=byomkesh&lang=Bengali
 * Public. Two-stage strategy:
 *   1. Short queries (< 4 chars): regex prefix match on title
 *   2. Longer queries: MongoDB $text search ranked by relevance, regex fallback
 *
 * Optional ?lang= filter restricts results to a specific contentLanguage.
 * Zero-result queries are logged asynchronously for catalog gap analysis.
 */
router.get('/', async (req, res, next) => {
  try {
    const raw  = (req.query.q    || '').trim()
    const lang = (req.query.lang || '').trim()
    if (raw.length < 2) return res.json([])

    // Escape regex metacharacters — prevents ReDoS from crafted inputs
    const q = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    const approvedOnly = {
      isPublished:      true,
      isDeleted:        { $ne: true },
      submissionStatus: { $nin: ['pending', 'rejected'] },
    }
    if (lang) approvedOnly.contentLanguage = lang

    let results

    if (q.length < 4) {
      results = await Content
        .find({ ...approvedOnly, title: { $regex: `^${q}`, $options: 'i' } })
        .sort({ rating: -1 })
        .limit(20)
        .select(HIDE_STREAM)
        .lean()
    } else {
      results = await Content
        .find({ ...approvedOnly, $text: { $search: raw } }, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' } })
        .limit(20)
        .select(HIDE_STREAM)
        .lean()

      // Regex fallback if text index hasn't built yet
      if (results.length === 0) {
        results = await Content
          .find({ ...approvedOnly, title: { $regex: q, $options: 'i' } })
          .sort({ rating: -1 })
          .limit(20)
          .select(HIDE_STREAM)
          .lean()
      }
    }

    // Log zero-result queries asynchronously so admins can identify catalog gaps
    if (results.length === 0 && raw.length >= 3) {
      SearchLog.create({ query: raw, lang: lang || null, resultCount: 0 })
        .catch((err) => console.error('[search-log]', err.message))
    }

    res.json(results)
  } catch (err) {
    next(err)
  }
})

export default router
