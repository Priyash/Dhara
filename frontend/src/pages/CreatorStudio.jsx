import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X, AlertTriangle, Film, CheckCircle2, XCircle,
  Plus, Eye, RotateCcw, ImagePlus, Clapperboard,
  Clock, TrendingUp, ArrowRight,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { uploadToCloudinary } from '../services/cloudinary'
import {
  getCreatorMe,
  listCreatorContent,
  createCreatorContent,
  resubmitCreatorContent,
} from '../services/api'
import styles from './CreatorStudio.module.css'

const STEPS = [
  { id: 'basics',  label: 'Basics'  },
  { id: 'media',   label: 'Media'   },
  { id: 'details', label: 'Details' },
  { id: 'review',  label: 'Review'  },
]

const EMPTY_FORM = {
  title: '', subtitle: '', type: 'Film', genre: '', releaseYear: '',
  contentLanguage: 'Bengali', certification: '',
  posterUrl: '', backdropUrl: '', bunnyVideoId: '',
  desc: '', director: '', cast: '', moodTags: '', contentWarnings: '',
}

const STATUS_META = {
  pending:  { label: 'In Review',  color: '#fbbf24', bg: 'rgba(251,191,36,0.12)'  },
  approved: { label: 'Live',       color: '#4ade80', bg: 'rgba(74,222,128,0.12)'  },
  rejected: { label: 'Rejected',   color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
}

function StatusChip({ status }) {
  const meta = STATUS_META[status] || { label: status, color: '#888', bg: 'rgba(255,255,255,0.06)' }
  return (
    <span className={styles.statusChip} style={{ color: meta.color, background: meta.bg }}>
      {status === 'pending'  && <Clock size={10} />}
      {status === 'approved' && <CheckCircle2 size={10} />}
      {status === 'rejected' && <XCircle size={10} />}
      {meta.label}
    </span>
  )
}

export default function CreatorStudio() {
  const navigate = useNavigate()
  const { isLoggedIn, authLoading, isCreator, creatorStatus } = useStore()

  const [loading, setLoading]           = useState(true)
  const [dashData, setDashData]         = useState(null)
  const [submissions, setSubmissions]   = useState([])
  const [filterTab, setFilterTab]       = useState('all')
  const [listLoading, setListLoading]   = useState(false)
  const [showModal, setShowModal]       = useState(false)
  const [step, setStep]                 = useState(0)
  const [form, setForm]                 = useState(EMPTY_FORM)
  const [submitting, setSubmitting]     = useState(false)
  const [submitError, setSubmitError]   = useState('')
  const [toast, setToast]               = useState(null)
  const [imgUploading, setImgUploading] = useState({ poster: false, backdrop: false })
  const [imgProgress,  setImgProgress]  = useState({ poster: 0,     backdrop: 0     })

  const showToast = useCallback((t) => {
    setToast(t)
    setTimeout(() => setToast(null), 5000)
  }, [])

  const loadDash = useCallback(async () => {
    try {
      const data = await getCreatorMe()
      setDashData(data)
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not load dashboard.' })
    } finally {
      setLoading(false)
    }
  }, [showToast])

  const loadSubmissions = useCallback(async (status = 'all') => {
    setListLoading(true)
    try {
      const params = status !== 'all' ? { status } : {}
      const data = await listCreatorContent(params)
      setSubmissions(data)
    } catch {
      setSubmissions([])
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (!isLoggedIn) { navigate('/'); return }
    if (!isCreator || creatorStatus !== 'approved') { navigate('/profile'); return }
    loadDash()
    loadSubmissions('all')
  }, [authLoading, isLoggedIn, isCreator, creatorStatus, navigate, loadDash, loadSubmissions])

  const handleFilterTab = (tab) => {
    setFilterTab(tab)
    loadSubmissions(tab)
  }

  const openModal = () => {
    setForm(EMPTY_FORM); setStep(0); setSubmitError(''); setShowModal(true)
  }

  const closeModal = () => { setShowModal(false); setSubmitError('') }

  const ff = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const handleImageUpload = async (field, file) => {
    if (!file) return
    const key = field === 'posterUrl' ? 'poster' : 'backdrop'
    setImgUploading((p) => ({ ...p, [key]: true }))
    setImgProgress((p)  => ({ ...p, [key]: 0 }))
    try {
      const url = await uploadToCloudinary(file, {
        folder: 'dhara/creator',
        onProgress: (pct) => setImgProgress((p) => ({ ...p, [key]: pct })),
      })
      setForm((prev) => ({ ...prev, [field]: url }))
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Image upload failed.' })
    } finally {
      setImgUploading((p) => ({ ...p, [key]: false }))
    }
  }

  const handleSubmit = async () => {
    if (!form.title.trim()) { setSubmitError('Title is required.'); return }
    setSubmitting(true); setSubmitError('')
    try {
      const payload = {
        ...form,
        genre:       form.genre.split(',').map((s) => s.trim()).filter(Boolean),
        cast:        form.cast.split(',').map((s) => s.trim()).filter(Boolean),
        moodTags:    form.moodTags.split(',').map((s) => s.trim()).filter(Boolean),
        releaseYear: form.releaseYear ? Number(form.releaseYear) : null,
        certification: form.certification || null,
      }
      await createCreatorContent(payload)
      showToast({ type: 'success', message: 'Submitted for review — we\'ll notify you once approved.' })
      closeModal()
      await Promise.all([loadDash(), loadSubmissions(filterTab)])
    } catch (err) {
      setSubmitError(err?.message || 'Submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleResubmit = async (id) => {
    try {
      await resubmitCreatorContent(id)
      showToast({ type: 'success', message: 'Resubmitted for review.' })
      await Promise.all([loadDash(), loadSubmissions(filterTab)])
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not resubmit.' })
    }
  }

  if (authLoading || loading) {
    return (
      <main className={styles.page}>
        <div className={styles.loadingState}>
          <Clapperboard size={28} className={styles.loadingIcon} />
          <p>Loading your studio…</p>
        </div>
      </main>
    )
  }

  const stats = dashData?.stats || { total: 0, approved: 0, pending: 0, rejected: 0 }
  const studioName = dashData?.creatorProfile?.studioName || 'My Studio'
  const bio        = dashData?.creatorProfile?.bio || ''

  return (
    <main className={styles.page}>

      {/* Toast */}
      {toast && (
        <div className={`${styles.toast} ${toast.type === 'error' ? styles.toastError : styles.toastSuccess}`}>
          {toast.type === 'success' ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
          <span>{toast.message}</span>
          <button className={styles.toastClose} onClick={() => setToast(null)}>×</button>
        </div>
      )}

      {/* ── Cinematic hero ── */}
      <header className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.heroContent}>
          <div className={styles.heroLeft}>
            <p className={styles.heroEyebrow}>
              <Clapperboard size={12} /> Creator Studio
            </p>
            <h1 className={styles.heroName}>{studioName}</h1>
            {bio && <p className={styles.heroBio}>{bio}</p>}

            {/* Inline stats — one row, no cards */}
            <div className={styles.heroStats}>
              <span className={styles.heroStat}>
                <strong>{stats.total}</strong> Total
              </span>
              <span className={styles.heroStatDivider} />
              <span className={`${styles.heroStat} ${styles.heroStatApproved}`}>
                <strong>{stats.approved}</strong> Live
              </span>
              <span className={styles.heroStatDivider} />
              <span className={`${styles.heroStat} ${styles.heroStatPending}`}>
                <strong>{stats.pending}</strong> In Review
              </span>
              {stats.rejected > 0 && (
                <>
                  <span className={styles.heroStatDivider} />
                  <span className={`${styles.heroStat} ${styles.heroStatRejected}`}>
                    <strong>{stats.rejected}</strong> Rejected
                  </span>
                </>
              )}
            </div>
          </div>

          <button className={styles.newBtn} onClick={openModal}>
            <Plus size={15} />
            New Submission
          </button>
        </div>

        {/* Pipeline flow strip */}
        <div className={styles.pipeline}>
          {[
            { label: 'Draft & Submit', desc: 'Fill details + upload media', done: stats.total > 0 },
            { label: 'Admin Review',   desc: 'We check quality & guidelines',  done: stats.approved > 0 || stats.rejected > 0 },
            { label: 'Goes Live',      desc: 'Visible to all Dhara subscribers', done: stats.approved > 0 },
          ].map((stage, i) => (
            <div key={stage.label} className={styles.pipelineStage}>
              <div className={`${styles.pipelineDot} ${stage.done ? styles.pipelineDotDone : ''}`}>
                {stage.done ? '✓' : i + 1}
              </div>
              <div className={styles.pipelineInfo}>
                <p className={styles.pipelineLabel}>{stage.label}</p>
                <p className={styles.pipelineDesc}>{stage.desc}</p>
              </div>
              {i < 2 && <ArrowRight size={14} className={styles.pipelineArrow} />}
            </div>
          ))}
        </div>
      </header>

      {/* ── Submissions ── */}
      <section className={styles.submissions}>
        <div className={styles.submissionsHead}>
          <h2 className={styles.submissionsTitle}>My Submissions</h2>
          <div className={styles.filterTabs}>
            {[
              { id: 'all',      label: 'All' },
              { id: 'pending',  label: 'In Review' },
              { id: 'approved', label: 'Live' },
              { id: 'rejected', label: 'Rejected' },
            ].map(({ id, label }) => (
              <button
                key={id}
                className={`${styles.filterTab} ${filterTab === id ? styles.filterTabActive : ''}`}
                onClick={() => handleFilterTab(id)}
              >
                {label}
                {id !== 'all' && stats[id] > 0 && (
                  <span className={styles.filterCount}>{stats[id]}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {listLoading ? (
          <div className={styles.loadingState} style={{ padding: '48px 0' }}>
            <p>Loading submissions…</p>
          </div>
        ) : submissions.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <Film size={32} />
            </div>
            <h3 className={styles.emptyTitle}>
              {filterTab === 'all'
                ? 'Your studio is empty'
                : `No ${filterTab === 'approved' ? 'live' : filterTab === 'pending' ? 'in-review' : 'rejected'} submissions`
              }
            </h3>
            <p className={styles.emptyDesc}>
              {filterTab === 'all'
                ? 'Submit your first film, documentary, or series and share Bengali stories with the world.'
                : 'Switch to "All" to see your full submission history.'
              }
            </p>
            {filterTab === 'all' && (
              <button className={styles.newBtn} onClick={openModal}>
                <Plus size={14} /> Submit Your First Work
              </button>
            )}
          </div>
        ) : (
          <div className={styles.submissionList}>
            {submissions.map((item) => (
              <div key={item._id} className={styles.submissionRow}>
                {/* Poster */}
                <div className={styles.rowPoster}>
                  {item.posterUrl
                    ? <img src={item.posterUrl} alt={item.title} className={styles.posterImg} />
                    : <div className={styles.posterFallback}><Film size={18} opacity={0.4} /></div>
                  }
                </div>

                {/* Info */}
                <div className={styles.rowInfo}>
                  <div className={styles.rowTop}>
                    <span className={styles.rowType}>{item.type}</span>
                    <StatusChip status={item.submissionStatus} />
                  </div>
                  <p className={styles.rowTitle}>{item.title}</p>
                  {item.genre?.length > 0 && (
                    <p className={styles.rowGenre}>{item.genre.slice(0, 3).join(' · ')}</p>
                  )}
                  {item.submissionStatus === 'rejected' && item.rejectionReason && (
                    <p className={styles.rowRejection}>
                      <AlertTriangle size={11} /> {item.rejectionReason}
                    </p>
                  )}
                </div>

                {/* Date */}
                <p className={styles.rowDate}>
                  {new Date(item.createdAt).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })}
                </p>

                {/* Actions */}
                <div className={styles.rowActions}>
                  {item.submissionStatus === 'approved' && (
                    <button className={styles.actionBtn} onClick={() => navigate(`/watch/${item._id}`)}>
                      <Eye size={12} /> View Live
                    </button>
                  )}
                  {item.submissionStatus === 'rejected' && (
                    <button className={styles.actionBtnPrimary} onClick={() => handleResubmit(item._id)}>
                      <RotateCcw size={12} /> Resubmit
                    </button>
                  )}
                  {item.submissionStatus === 'pending' && (
                    <span className={styles.pendingNote}>
                      <Clock size={11} /> Awaiting review
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── New Submission Modal ── */}
      {showModal && (
        <div className={styles.modalBackdrop} onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <div className={styles.modalPanel} role="dialog" aria-modal="true">

            <div className={styles.modalHeader}>
              <div>
                <p className={styles.modalEyebrow}>Step {step + 1} of {STEPS.length}</p>
                <h2 className={styles.modalTitle}>{STEPS[step].label}</h2>
              </div>
              <button className={styles.modalClose} onClick={closeModal} aria-label="Close"><X size={16} /></button>
            </div>

            {/* Step indicator */}
            <div className={styles.stepIndicator}>
              {STEPS.map((s, i) => (
                <div key={s.id} className={styles.stepItem}>
                  <div className={`${styles.stepDot} ${i < step ? styles.stepDotDone : i === step ? styles.stepDotActive : ''}`}>
                    {i < step ? '✓' : i + 1}
                  </div>
                  <span className={`${styles.stepLabel} ${i === step ? styles.stepLabelActive : ''}`}>{s.label}</span>
                  {i < STEPS.length - 1 && <div className={`${styles.stepLine} ${i < step ? styles.stepLineDone : ''}`} />}
                </div>
              ))}
            </div>

            <div className={styles.modalBody}>

              {/* Step 0 — Basics */}
              {step === 0 && (
                <div className={styles.formGrid}>
                  <label className={`${styles.label} ${styles.spanFull}`}>
                    Title *
                    <input className={styles.input} value={form.title} onChange={ff('title')} placeholder="e.g. আলোর পথে" autoFocus />
                  </label>
                  <label className={styles.label}>
                    Subtitle / Tagline
                    <input className={styles.input} value={form.subtitle} onChange={ff('subtitle')} placeholder="Optional" />
                  </label>
                  <label className={styles.label}>
                    Type
                    <select className={styles.select} value={form.type} onChange={ff('type')}>
                      <option value="Film">Film</option>
                      <option value="Series">Series</option>
                      <option value="Documentary">Documentary</option>
                    </select>
                  </label>
                  <label className={styles.label}>
                    Genre <span className={styles.labelHint}>(comma-separated)</span>
                    <input className={styles.input} value={form.genre} onChange={ff('genre')} placeholder="Drama, Thriller" />
                  </label>
                  <label className={styles.label}>
                    Release Year
                    <input className={styles.input} type="number" min="1900" max="2099" value={form.releaseYear} onChange={ff('releaseYear')} placeholder="2024" />
                  </label>
                  <label className={styles.label}>
                    Language
                    <select className={styles.select} value={form.contentLanguage} onChange={ff('contentLanguage')}>
                      <option value="Bengali">Bengali (বাংলা)</option>
                      <option value="Hindi">Hindi</option>
                      <option value="English">English</option>
                      <option value="Odia">Odia</option>
                      <option value="Tamil">Tamil</option>
                      <option value="Telugu">Telugu</option>
                    </select>
                  </label>
                  <label className={styles.label}>
                    Certification
                    <select className={styles.select} value={form.certification} onChange={ff('certification')}>
                      <option value="">— Select —</option>
                      <option value="U">U — Universal</option>
                      <option value="UA">UA — Parental Guidance</option>
                      <option value="A">A — Adults Only</option>
                    </select>
                  </label>
                </div>
              )}

              {/* Step 1 — Media */}
              {step === 1 && (
                <div className={styles.formGrid}>
                  {[
                    { field: 'posterUrl',   label: 'Poster',   hint: '2:3 portrait',    key: 'poster' },
                    { field: 'backdropUrl', label: 'Backdrop', hint: '16:9 landscape',  key: 'backdrop' },
                  ].map(({ field, label, hint, key }) => (
                    <div key={field} className={styles.imageSlot}>
                      <p className={styles.imageSlotLabel}>{label} <span className={styles.labelHint}>{hint}</span></p>
                      <div className={styles.imagePreviewWrap}>
                        {form[field]
                          ? <img src={form[field]} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} />
                          : <div className={styles.imageEmpty}><ImagePlus size={22} opacity={0.3} /><span>No image</span></div>
                        }
                      </div>
                      <label className={styles.imageUploadBtn}>
                        {imgUploading[key] ? `Uploading… ${imgProgress[key]}%` : `Upload ${label}`}
                        <input type="file" accept="image/*" style={{ display: 'none' }} disabled={imgUploading[key]}
                          onChange={(e) => handleImageUpload(field, e.target.files?.[0])} />
                      </label>
                      <input className={styles.input} value={form[field]} onChange={ff(field)} placeholder="Or paste URL…" />
                    </div>
                  ))}
                  <label className={`${styles.label} ${styles.spanFull}`}>
                    Bunny Video ID <span className={styles.labelHint}>(optional — admin can link it via Upload tab)</span>
                    <input className={styles.input} value={form.bunnyVideoId} onChange={ff('bunnyVideoId')} placeholder="Paste GUID from Bunny Stream" />
                  </label>
                </div>
              )}

              {/* Step 2 — Details */}
              {step === 2 && (
                <div className={styles.formGrid}>
                  <label className={`${styles.label} ${styles.spanFull}`}>
                    Synopsis / Description
                    <textarea className={styles.textarea} rows={4} value={form.desc} onChange={ff('desc')} placeholder="গল্পের সারসংক্ষেপ লিখুন…" />
                  </label>
                  <label className={styles.label}>
                    Director
                    <input className={styles.input} value={form.director} onChange={ff('director')} placeholder="পরিচালকের নাম" />
                  </label>
                  <label className={styles.label}>
                    Cast <span className={styles.labelHint}>(comma-separated)</span>
                    <input className={styles.input} value={form.cast} onChange={ff('cast')} placeholder="Actor 1, Actor 2" />
                  </label>
                  <label className={styles.label}>
                    Mood Tags <span className={styles.labelHint}>(comma-separated)</span>
                    <input className={styles.input} value={form.moodTags} onChange={ff('moodTags')} placeholder="Emotional, Suspenseful" />
                  </label>
                  <label className={styles.label}>
                    Content Warnings
                    <input className={styles.input} value={form.contentWarnings} onChange={ff('contentWarnings')} placeholder="violence, language" />
                  </label>
                </div>
              )}

              {/* Step 3 — Review */}
              {step === 3 && (
                <div className={styles.reviewGrid}>
                  <div className={styles.reviewSection}>
                    <p className={styles.reviewHead}>Basics</p>
                    <dl className={styles.reviewDl}>
                      <dt>Title</dt>     <dd>{form.title || '—'}</dd>
                      <dt>Type</dt>      <dd>{form.type}</dd>
                      <dt>Genre</dt>     <dd>{form.genre || '—'}</dd>
                      <dt>Year</dt>      <dd>{form.releaseYear || '—'}</dd>
                      <dt>Language</dt>  <dd>{form.contentLanguage}</dd>
                      <dt>Cert.</dt>     <dd>{form.certification || '—'}</dd>
                    </dl>
                  </div>
                  <div className={styles.reviewSection}>
                    <p className={styles.reviewHead}>Media</p>
                    <dl className={styles.reviewDl}>
                      <dt>Poster</dt>    <dd style={{ color: form.posterUrl   ? '#4ade80' : '#888' }}>{form.posterUrl   ? '✓ Set' : 'Not set'}</dd>
                      <dt>Backdrop</dt>  <dd style={{ color: form.backdropUrl ? '#4ade80' : '#888' }}>{form.backdropUrl ? '✓ Set' : 'Not set'}</dd>
                      <dt>Video ID</dt>  <dd style={{ color: form.bunnyVideoId ? '#4ade80' : '#888' }}>{form.bunnyVideoId || 'Not set'}</dd>
                    </dl>
                  </div>
                  <div className={styles.reviewSection}>
                    <p className={styles.reviewHead}>Details</p>
                    <dl className={styles.reviewDl}>
                      <dt>Director</dt>  <dd>{form.director || '—'}</dd>
                      <dt>Cast</dt>      <dd>{form.cast || '—'}</dd>
                      <dt>Mood</dt>      <dd>{form.moodTags || '—'}</dd>
                    </dl>
                  </div>
                  <p className={styles.reviewNote}>
                    Once submitted, your content will be reviewed by the Dhara team. You'll be able to see the status in your studio.
                  </p>
                  {submitError && (
                    <p className={styles.submitError}><AlertTriangle size={13} /> {submitError}</p>
                  )}
                </div>
              )}
            </div>

            <div className={styles.modalFooter}>
              <button className={styles.ghostBtn} onClick={() => step > 0 ? setStep(step - 1) : closeModal()}>
                {step === 0 ? 'Cancel' : '← Back'}
              </button>
              {step < STEPS.length - 1 ? (
                <button className={styles.primaryBtn} onClick={() => {
                  if (step === 0 && !form.title.trim()) { setSubmitError('Title is required.'); return }
                  setSubmitError(''); setStep(step + 1)
                }}>
                  Next →
                </button>
              ) : (
                <button className={styles.primaryBtn} onClick={handleSubmit} disabled={submitting}>
                  {submitting ? 'Submitting…' : 'Submit for Review'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
