import { useEffect, useState, useCallback, useRef } from 'react'
import { X, Plus, Check, Ban, Trash2, ImageIcon, Sparkles, Upload } from 'lucide-react'
import { uploadToCloudinary } from '../services/cloudinary'

/**
 * Grid for managing a title's artwork A/B variants (the thumbnail pipeline's
 * review surface — docs/thumbnail-trailer-pipeline.md). Seed a variant by URL,
 * promote it to `live` so it starts serving on browse rails, reject it, or
 * delete it. Per-variant impressions / clicks / CTR are shown read-time.
 *
 * Backend-agnostic: callers pass an `api` object so the same grid serves both
 * the admin and creator surfaces:
 *   api.list()                  -> Promise<variant[]>   (caller binds the item)
 *   api.create({ imageUrl, label }) -> Promise
 *   api.update(id, patch)       -> Promise
 *   api.remove(id)              -> Promise
 */
const pct = (n) => `${(n * 100).toFixed(1)}%`

const STATUS_COLOR = {
  live:      '#4ade80',
  candidate: 'var(--color-text-muted)',
  rejected:  '#f87171',
}

export default function ThumbnailVariantModal({ item, api, onClose }) {
  const [variants, setVariants] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [newUrl,   setNewUrl]   = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [busyId,   setBusyId]   = useState(null)
  const [adding,   setAdding]   = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [uploading,  setUploading]  = useState(false)
  const [notice,     setNotice]     = useState('')
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      setVariants(await api.list())
    } catch (err) {
      setError(err?.message || 'Failed to load variants.')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  // Close on Escape.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleAdd = async () => {
    const url = newUrl.trim()
    if (!/^https?:\/\//i.test(url)) { setError('Enter a valid http(s) image URL.'); return }
    setAdding(true); setError('')
    try {
      await api.create({ imageUrl: url, label: newLabel.trim() })
      setNewUrl(''); setNewLabel('')
      await load()
    } catch (err) {
      setError(err?.message || 'Failed to add variant.')
    } finally {
      setAdding(false)
    }
  }

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (file) e.target.value = ''   // allow re-selecting the same file later
    if (!file) return
    setUploading(true); setError(''); setNotice('')
    try {
      const secureUrl = await uploadToCloudinary(file, { folder: 'dhara/artwork-variants' })
      await api.create({ imageUrl: secureUrl, label: newLabel.trim() })
      setNewLabel('')
      await load()
    } catch (err) {
      setError(err?.message || 'Image upload failed.')
    } finally {
      setUploading(false)
    }
  }

  const handleExtract = async () => {
    setExtracting(true); setError(''); setNotice('')
    try {
      const res = await api.extract()
      if (res?.configured === false) {
        setNotice('Auto-extraction isn’t enabled on the server yet — upload or add by URL for now.')
      } else {
        // Extraction runs in the background server-side; candidates appear shortly.
        setNotice('Generating candidate frames in the background — they’ll appear here in a moment.')
        setTimeout(() => { load().catch(() => {}) }, 6000)
      }
    } catch (err) {
      setError(err?.message || 'Frame extraction failed.')
    } finally {
      setExtracting(false)
    }
  }

  const setStatus = async (v, status) => {
    setBusyId(v._id); setError('')
    try {
      await api.update(v._id, { status })
      await load()
    } catch (err) {
      setError(err?.message || 'Failed to update variant.')
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (v) => {
    setBusyId(v._id); setError('')
    try {
      await api.remove(v._id)
      await load()
    } catch (err) {
      setError(err?.message || 'Failed to delete variant.')
    } finally {
      setBusyId(null)
    }
  }

  const liveCount = variants.filter((v) => v.status === 'live').length

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Artwork variants for ${item?.title || 'title'}`}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(760px, 100%)', maxHeight: '88vh', overflowY: 'auto',
          background: 'var(--color-surface, #16161c)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 14, padding: 20,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 7 }}>
              <ImageIcon size={15} /> Artwork A/B — {item?.title}
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
              {liveCount > 0
                ? `${liveCount} live variant${liveCount > 1 ? 's' : ''} serving on browse rails. CTR = clicks ÷ impressions.`
                : 'No live variants yet — the title ships its default poster until you set one live.'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Add variant */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://…/artwork.jpg"
            style={{ flex: '2 1 240px', minWidth: 0, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: 'inherit', fontSize: 13 }}
          />
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="label (optional)"
            style={{ flex: '1 1 120px', minWidth: 0, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: 'inherit', fontSize: 13 }}
          />
          <button
            onClick={handleAdd}
            disabled={adding}
            title="Add by URL (must be an uploaded/Cloudinary or CDN image)"
            style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#db2777', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            <Plus size={13} /> {adding ? 'Adding…' : 'Add'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} style={{ display: 'none' }} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title="Upload an image file"
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            <Upload size={13} /> {uploading ? 'Uploading…' : 'Upload'}
          </button>
          {typeof api.extract === 'function' && (
            <button
              onClick={handleExtract}
              disabled={extracting}
              title="Grab candidate frames from the source video"
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <Sparkles size={13} /> {extracting ? 'Generating…' : 'Generate from video'}
            </button>
          )}
        </div>

        {error && <p style={{ color: '#f87171', fontSize: 12, marginBottom: 10 }}>{error}</p>}
        {notice && <p style={{ color: '#4ade80', fontSize: 12, marginBottom: 10 }}>{notice}</p>}
        {loading && <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading…</p>}
        {!loading && variants.length === 0 && (
          <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No variants yet. Add one above to start an A/B test.</p>
        )}

        {/* Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
          {variants.map((v) => (
            <div key={v._id} style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden', background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ aspectRatio: '2 / 3', background: '#0c0c10' }}>
                <img src={v.imageUrl} alt={v.label || 'variant'} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <div style={{ padding: 9 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: STATUS_COLOR[v.status] }}>{v.status}</span>
                  {v.label && <span style={{ fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.label}</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                  {v.stats.impressions} impr · {v.stats.clicks} clicks<br />
                  CTR <strong style={{ color: '#fff' }}>{v.stats.impressions ? pct(v.stats.ctr) : '—'}</strong>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
                  {v.status !== 'live' && (
                    <button title="Set live" disabled={busyId === v._id} onClick={() => setStatus(v, 'live')}
                      style={{ flex: 1, padding: '5px 0', borderRadius: 6, border: '1px solid rgba(74,222,128,0.4)', background: 'transparent', color: '#4ade80', cursor: 'pointer', display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 4, fontSize: 11 }}>
                      <Check size={12} /> Live
                    </button>
                  )}
                  {v.status !== 'rejected' && (
                    <button title="Reject" disabled={busyId === v._id} onClick={() => setStatus(v, 'rejected')}
                      style={{ flex: 1, padding: '5px 0', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 4, fontSize: 11 }}>
                      <Ban size={12} /> Reject
                    </button>
                  )}
                  <button title="Delete" disabled={busyId === v._id} onClick={() => handleDelete(v)}
                    style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(248,113,113,0.35)', background: 'transparent', color: '#f87171', cursor: 'pointer' }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
