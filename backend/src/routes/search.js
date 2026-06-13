import { Router } from 'express'
import { Content } from '../models/Content.js'
import { SearchLog } from '../models/SearchLog.js'

const router = Router()

const HIDE_STREAM = '-bunnyVideoId -trailerVideoId -episodes.bunnyVideoId'

// Blend textScore with quality + popularity so well-known titles rank above
// obscure exact-matches when the query is ambiguous.
function blendedRank(item, textScore = 0) {
  const quality    = (item.communityRating > 0 ? item.communityRating : item.rating || 0) * 1.2
  const popularity = Math.min(Math.log1p(item.viewCount || 0) * 0.4, 4)
  return textScore * 3 + quality + popularity
}

/**
 * GET /api/search?q=byomkesh&lang=Bengali
 * Two-stage strategy:
 *   1. Short queries (< 4 chars): regex prefix match on title
 *   2. Longer queries: MongoDB $text search re-ranked by blended score, regex fallback
 *
 * All queries (not just zero-result) are logged for popular-search analytics.
 */
router.get('/', async (req, res, next) => {
  try {
    const raw  = (req.query.q    || '').trim()
    const lang = (req.query.lang || '').trim()
    if (raw.length < 2) return res.json([])

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
        .sort({ rating: -1, viewCount: -1 })
        .limit(20)
        .select(HIDE_STREAM)
        .lean()
    } else {
      const textResults = await Content
        .find({ ...approvedOnly, $text: { $search: raw } }, { score: { $meta: 'textScore' } })
        .limit(40)
        .select(HIDE_STREAM)
        .lean()

      if (textResults.length > 0) {
        results = textResults
          .map(item => ({ item, rank: blendedRank(item, item.score || 0) }))
          .sort((a, b) => b.rank - a.rank)
          .slice(0, 20)
          .map(({ item }) => { delete item.score; return item })
      } else {
        // Regex fallback if text index hasn't built yet
        results = await Content
          .find({ ...approvedOnly, title: { $regex: q, $options: 'i' } })
          .sort({ rating: -1, viewCount: -1 })
          .limit(20)
          .select(HIDE_STREAM)
          .lean()
      }
    }

    // Log every query (not just zero-result) for popular-search analytics
    if (raw.length >= 2) {
      SearchLog.create({ query: raw.toLowerCase(), lang: lang || null, resultCount: results.length })
        .catch((err) => console.error('[search-log]', err.message))
    }

    res.json(results)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/search/popular
 * Returns the top searched terms from the last 30 days, deduped by query.
 * Used by the search overlay to replace hardcoded popular tags.
 */
router.get('/popular', async (req, res, next) => {
  try {
    const limit      = Math.min(12, Math.max(4, Number(req.query.limit || 8)))
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000)

    const agg = await SearchLog.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo }, resultCount: { $gt: 0 } } },
      { $group: { _id: '$query', count: { $sum: 1 } } },
      { $sort:  { count: -1 } },
      { $limit: limit },
    ])

    res.json(agg.map(a => a._id))
  } catch (err) {
    next(err)
  }
})

export default router
