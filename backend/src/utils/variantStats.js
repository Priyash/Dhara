import { InteractionEvent } from '../models/InteractionEvent.js'

/**
 * Enriches lean ThumbnailVariant docs with read-time attribution stats,
 * aggregated from InteractionEvent.variantId (no denormalized rollup — see
 * docs/thumbnail-trailer-pipeline.md). Shared by the admin and creator review
 * grids.
 *
 * CTR = clicks / impressions is the core thumbnail metric. Downstream
 * play/completion attribution is wired in a later increment, so cvr stays 0
 * until then.
 *
 * @param {Array} variants  lean ThumbnailVariant documents (each with `_id`)
 * @returns {Promise<Array>} the same docs, each with a `stats` object
 */
export async function withVariantStats(variants) {
  if (!Array.isArray(variants) || variants.length === 0) return variants

  const ids = variants.map((v) => v._id)
  const counts = await InteractionEvent.aggregate([
    { $match: { variantId: { $in: ids } } },
    { $group: { _id: { variantId: '$variantId', eventType: '$eventType' }, n: { $sum: 1 } } },
  ])

  const byVariant = new Map()
  for (const row of counts) {
    const key = String(row._id.variantId)
    const entry = byVariant.get(key) || { impression: 0, click: 0, play: 0, completion: 0 }
    if (row._id.eventType in entry) entry[row._id.eventType] = row.n
    byVariant.set(key, entry)
  }

  return variants.map((v) => {
    const c = byVariant.get(String(v._id)) || { impression: 0, click: 0, play: 0, completion: 0 }
    return {
      ...v,
      stats: {
        impressions: c.impression,
        clicks:      c.click,
        plays:       c.play,
        completions: c.completion,
        ctr: c.impression ? c.click / c.impression : 0,
        cvr: c.impression ? c.completion / c.impression : 0,
      },
    }
  })
}
