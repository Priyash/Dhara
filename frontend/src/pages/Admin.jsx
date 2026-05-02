import { useEffect, useMemo, useCallback, useState, useRef } from 'react'
import {
  UploadCloud, FolderPlus, ShieldAlert, RefreshCw, Link2, Film,
  CheckCircle2, XCircle, Pencil, X, Library, ImagePlus,
  CreditCard, Check, Copy, AlertTriangle, Zap, Code2, Crown,
  UserCheck, UserX, FileCheck, FileX, ListPlus, Trash2,
} from 'lucide-react'
import { uploadToCloudinary } from '../services/cloudinary'
import { useStore } from '../store/useStore'
import { useUploadNotifier } from '../hooks/useUploadNotifier'
import {
  createAdminCollection, createBunnyCollection, createUploadJob, fetchAdminContentById,
  getAdminSession, importFromCdn, listBunnyCollections, listBunnyVideos,
  listAdminCollections, listAdminContent, listUploadJobs,
  mapExistingBunnyVideo, syncBunnyCollections, updateAdminContent,
  uploadJobFile, getPaymentConfig, updatePaymentConfig,
  listCreatorApplications, approveCreatorApplication, rejectCreatorApplication,
  listAdminSubmissions, approveSubmission, rejectSubmission,
} from '../services/api'
import styles from './Admin.module.css'

const TABS = [
  { id: 'content',  label: 'Content',     icon: Library },
  { id: 'uploads',  label: 'Uploads',     icon: UploadCloud },
  { id: 'payments', label: 'Payments',    icon: CreditCard },
  { id: 'creators', label: 'Creator Hub', icon: UserCheck },
]

const statusClass = {
  awaiting_file: styles.statusAwaiting,
  queued:        styles.statusQueued,
  uploading:     styles.statusUploading,
  processing:    styles.statusProcessing,
  ready:         styles.statusReady,
  failed:        styles.statusFailed,
}

export default function Admin() {
  const { authLoading } = useStore()
  const [sessionLoading, setSessionLoading] = useState(true)
  const [adminAllowed, setAdminAllowed]     = useState(false)
  const [sessionError, setSessionError]     = useState('')
  const [activeTab, setActiveTab]           = useState('content')

  // ── Data ──────────────────────────────────────────────────────────────────
  const [collections, setCollections]       = useState([])
  const [bunnyCollections, setBunnyCollections] = useState([])
  const [bunnyVideos, setBunnyVideos]       = useState([])
  const [contentItems, setContentItems]     = useState([])
  const [jobs, setJobs]                     = useState([])

  // ── Upload form ───────────────────────────────────────────────────────────
  const [collectionMode, setCollectionMode] = useState('pick') // 'pick' | 'create'
  const [collectionName, setCollectionName] = useState('')
  const [bunnyCollectionId, setBunnyCollectionId] = useState('')
  const [newCollectionName, setNewCollectionName] = useState('')
  const [title, setTitle]                   = useState('')
  const [selectedCollectionId, setSelectedCollectionId] = useState('')
  const [selectedContentId, setSelectedContentId]       = useState('')
  // Episode upload fields — only used when selected content is a Series
  const [episodeNumber, setEpisodeNumber]   = useState('')
  const [episodeTitle, setEpisodeTitle]     = useState('')
  const [episodeDuration, setEpisodeDuration] = useState('')
  const [seriesEpisodes, setSeriesEpisodes] = useState([])   // existing episodes of selected series
  const [loadingSeriesEpisodes, setLoadingSeriesEpisodes] = useState(false)
  const [mapCollectionId, setMapCollectionId] = useState('')
  const [mapVideoId, setMapVideoId]           = useState('')
  const [mapContentId, setMapContentId]       = useState('')
  const [mapVideoError, setMapVideoError]     = useState('')
  const [file, setFile]                       = useState(null)
  const [busy, setBusy]                       = useState(false)
  const [notice, setNotice]                   = useState('')
  const [error, setError]                     = useState('')
  const [dragOver, setDragOver]               = useState(false)
  const [toast, setToast]                     = useState(null)

  // ── Payment provider ──────────────────────────────────────────────────────
  const [paymentConfig, setPaymentConfig]   = useState(null)
  const [paymentBusy, setPaymentBusy]       = useState(false)
  const [copiedWebhook, setCopiedWebhook]   = useState(null)
  const [showLiveConfirm, setShowLiveConfirm] = useState(false)
  const [liveConfirmText, setLiveConfirmText] = useState('')

  // ── Creator Hub ───────────────────────────────────────────────────────────
  const [creatorApplications, setCreatorApplications] = useState([])
  const [submissions, setSubmissions]                 = useState([])
  const [creatorHubTab, setCreatorHubTab]             = useState('applications')
  const [appStatusFilter, setAppStatusFilter]         = useState('all')
  const [subStatusFilter, setSubStatusFilter]         = useState('pending')
  const [creatorBusy, setCreatorBusy]                 = useState(false)
  const [rejectModal, setRejectModal]                 = useState(null)
  const [rejectReason, setRejectReason]               = useState('')

  // ── Content editor ────────────────────────────────────────────────────────
  const [editingId, setEditingId]     = useState(null)
  const [editForm, setEditForm]       = useState(null)
  const [editBusy, setEditBusy]       = useState(false)
  const [editNotice, setEditNotice]   = useState('')
  const [editError, setEditError]     = useState('')
  const [contentSearch, setContentSearch] = useState('')
  const [imgUploading, setImgUploading]   = useState({ poster: false, backdrop: false })
  const [imgProgress,  setImgProgress]    = useState({ poster: 0,     backdrop: 0     })
  const modalFormRef = useRef(null)

  // ── Helpers ───────────────────────────────────────────────────────────────
  const showToast = useCallback((t) => {
    setToast(t)
    setTimeout(() => setToast(null), 5000)
  }, [])

  const { requestPermission, checkTransitions } = useUploadNotifier(showToast)

  const selectedCollection = useMemo(
    () => collections.find((c) => c._id === selectedCollectionId),
    [collections, selectedCollectionId]
  )

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadData = async () => {
    const [collectionData, contentData, jobData, bunnyCollectionData, paymentData] = await Promise.all([
      listAdminCollections(),
      listAdminContent(),
      listUploadJobs(40),
      listBunnyCollections(),
      getPaymentConfig().catch(() => null),
    ])
    setCollections(collectionData)
    setContentItems(contentData)
    setJobs(jobData)
    setBunnyCollections(bunnyCollectionData)
    if (paymentData) setPaymentConfig(paymentData)
  }

  const loadBunnyVideos = async (collectionId) => {
    setMapVideoError('')
    if (!collectionId) { setBunnyVideos([]); return }
    try {
      const items = await listBunnyVideos({ collectionId })
      setBunnyVideos(items)
      if (!items.length) setMapVideoError('No videos found in this collection.')
    } catch (err) {
      setMapVideoError(err?.message || 'Could not load videos.')
    }
  }

  useEffect(() => {
    if (authLoading) return
    let active = true
    ;(async () => {
      setSessionLoading(true)
      setSessionError('')
      try {
        await getAdminSession()
        if (!active) return
        setAdminAllowed(true)
        await loadData()
      } catch (err) {
        if (!active) return
        setAdminAllowed(false)
        setSessionError(err?.message || 'Admin access required.')
      } finally {
        if (active) setSessionLoading(false)
      }
    })()
    return () => { active = false }
  }, [authLoading])

  useEffect(() => {
    if (!adminAllowed) return undefined
    requestPermission()
    const timer = setInterval(() => {
      listUploadJobs(40)
        .then((jobs) => { setJobs(jobs); checkTransitions(jobs) })
        .catch(() => {})
    }, 5000)
    return () => clearInterval(timer)
  }, [adminAllowed, requestPermission, checkTransitions])

  useEffect(() => {
    if (editForm && modalFormRef.current) modalFormRef.current.scrollTop = 0
  }, [editForm])

  useEffect(() => {
    if (activeTab === 'creators' && adminAllowed) {
      void loadCreatorApplications()
      void loadSubmissions()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, adminAllowed])

  // ── Payment handlers ──────────────────────────────────────────────────────
  const handleSetProvider = async (provider) => {
    setPaymentBusy(true)
    try {
      const updated = await updatePaymentConfig({ activeProvider: provider })
      setPaymentConfig((prev) => ({ ...prev, ...updated }))
      showToast({ type: 'success', message: `Switched to ${provider}` })
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not switch provider.' })
    } finally {
      setPaymentBusy(false)
    }
  }

  const handleSetMode = async (mode) => {
    if (mode === 'live') { setShowLiveConfirm(true); return }
    setPaymentBusy(true)
    try {
      const updated = await updatePaymentConfig({ mode })
      setPaymentConfig((prev) => ({ ...prev, ...updated }))
      showToast({ type: 'success', message: 'Switched to Test mode' })
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not update mode.' })
    } finally {
      setPaymentBusy(false)
    }
  }

  const handleConfirmLive = async () => {
    setShowLiveConfirm(false)
    setLiveConfirmText('')
    setPaymentBusy(true)
    try {
      const updated = await updatePaymentConfig({ mode: 'live' })
      setPaymentConfig((prev) => ({ ...prev, ...updated }))
      showToast({ type: 'success', message: 'Live mode activated — real payments enabled' })
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not activate live mode.' })
    } finally {
      setPaymentBusy(false)
    }
  }

  const copyWebhookUrl = (provider, url) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedWebhook(provider)
      setTimeout(() => setCopiedWebhook(null), 2000)
    })
  }

  // ── Quick premium toggle (no modal needed) ───────────────────────────────
  const [togglingPremium, setTogglingPremium] = useState(null) // item._id being toggled

  const handleTogglePremium = async (item) => {
    setTogglingPremium(item._id)
    // Optimistic update
    setContentItems((prev) =>
      prev.map((c) => c._id === item._id ? { ...c, isPremium: !item.isPremium } : c)
    )
    try {
      await updateAdminContent(item._id, { isPremium: !item.isPremium })
    } catch {
      // Revert on failure
      setContentItems((prev) =>
        prev.map((c) => c._id === item._id ? { ...c, isPremium: item.isPremium } : c)
      )
    } finally {
      setTogglingPremium(null)
    }
  }

  // ── Content editor handlers ───────────────────────────────────────────────
  const openEditModal = async (item) => {
    setEditNotice('')
    setEditError('')
    setEditingId(item._id)
    setEditBusy(true)
    try {
      const full = await fetchAdminContentById(item._id)
      setEditForm({
        title:           full.title           || '',
        subtitle:        full.subtitle         || '',
        desc:            full.desc             || '',
        type:            full.type             || 'Film',
        genre:           (full.genre          || []).join(', '),
        cast:            (full.cast           || []).join(', '),
        director:        full.director         || '',
        releaseYear:     full.releaseYear != null ? String(full.releaseYear) : '',
        rating:          full.rating      != null ? String(full.rating)      : '',
        isPremium:       Boolean(full.isPremium),
        isFeatured:      Boolean(full.isFeatured),
        badge:           full.badge            || '',
        posterUrl:       full.posterUrl        || '',
        backdropUrl:     full.backdropUrl      || '',
        bunnyVideoId:    full.bunnyVideoId     || '',
        palette:         full.palette          || '',
        reviewCount:     full.reviewCount != null ? String(full.reviewCount) : '',
        contentLanguage: full.contentLanguage  || 'Bengali',
        certification:   full.certification    || '',
        contentWarnings: full.contentWarnings  || '',
        moodTags:        (full.moodTags        || []).join(', '),
        episodes:        (full.episodes        || []).map((ep) => ({
          number:      ep.number,
          title:       ep.title       || '',
          duration:    ep.duration    || '',
          bunnyVideoId: ep.bunnyVideoId || '',
        })),
      })
    } catch (err) {
      setEditError(err?.message || 'Could not load content.')
      setEditingId(null)
    } finally {
      setEditBusy(false)
    }
  }

  const closeEditModal = () => {
    setEditingId(null); setEditForm(null)
    setEditNotice('');  setEditError('')
  }

  const handleEditSave = async (e) => {
    e.preventDefault()
    setEditNotice(''); setEditError(''); setEditBusy(true)
    try {
      const payload = {
        title:           editForm.title.trim(),
        subtitle:        editForm.subtitle.trim(),
        desc:            editForm.desc.trim(),
        type:            editForm.type,
        genre:           editForm.genre.split(',').map((s) => s.trim()).filter(Boolean),
        cast:            editForm.cast.split(',').map((s) => s.trim()).filter(Boolean),
        director:        editForm.director.trim(),
        releaseYear:     editForm.releaseYear ? Number(editForm.releaseYear) : null,
        rating:          editForm.rating      ? Number(editForm.rating)      : 0,
        isPremium:       editForm.isPremium,
        isFeatured:      editForm.isFeatured,
        badge:           editForm.badge.trim() || null,
        posterUrl:       editForm.posterUrl.trim(),
        backdropUrl:     editForm.backdropUrl.trim(),
        palette:         editForm.palette.trim(),
        reviewCount:     editForm.reviewCount ? Number(editForm.reviewCount) : 0,
        contentLanguage: editForm.contentLanguage || 'Bengali',
        certification:   editForm.certification || null,
        contentWarnings: editForm.contentWarnings.trim(),
        moodTags:        editForm.moodTags.split(',').map((s) => s.trim()).filter(Boolean),
        episodes:        (editForm.episodes || []).map((ep) => ({
          number:      Number(ep.number),
          title:       ep.title.trim(),
          duration:    ep.duration.trim(),
          bunnyVideoId: ep.bunnyVideoId.trim(),
        })),
      }
      await updateAdminContent(editingId, payload)
      setEditNotice('Metadata saved.')
      await loadData()
    } catch (err) {
      setEditError(err?.message || 'Could not save metadata.')
    } finally {
      setEditBusy(false)
    }
  }

  const ef = (field) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setEditForm((prev) => ({ ...prev, [field]: val }))
  }

  const filteredContent = useMemo(() => {
    if (!contentSearch.trim()) return contentItems
    const q = contentSearch.toLowerCase()
    return contentItems.filter((c) =>
      c.title?.toLowerCase().includes(q) || c.type?.toLowerCase().includes(q)
    )
  }, [contentItems, contentSearch])

  const handleImageUpload = async (field, file) => {
    if (!file) return
    setImgUploading((p) => ({ ...p, [field]: true }))
    setImgProgress((p)  => ({ ...p, [field]: 0 }))
    try {
      const url = await uploadToCloudinary(file, {
        folder: 'dhara',
        onProgress: (pct) => setImgProgress((p) => ({ ...p, [field]: pct })),
      })
      setEditForm((prev) => ({ ...prev, [field]: url }))
    } catch (err) {
      setEditError(err?.message || 'Image upload failed.')
    } finally {
      setImgUploading((p) => ({ ...p, [field]: false }))
    }
  }

  // ── Creator Hub loaders ───────────────────────────────────────────────────
  const loadCreatorApplications = async (status = appStatusFilter) => {
    try {
      const data = await listCreatorApplications({ status })
      setCreatorApplications(data)
    } catch { /* non-critical */ }
  }

  const loadSubmissions = async (status = subStatusFilter) => {
    try {
      const data = await listAdminSubmissions({ status })
      setSubmissions(data)
    } catch { /* non-critical */ }
  }

  // ── Creator Hub handlers ──────────────────────────────────────────────────
  const handleApproveCreator = async (userId) => {
    setCreatorBusy(true)
    try {
      await approveCreatorApplication(userId)
      showToast({ type: 'success', message: 'Creator approved' })
      await loadCreatorApplications()
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not approve' })
    } finally { setCreatorBusy(false) }
  }

  const handleRejectCreator = async () => {
    if (!rejectModal || !rejectReason.trim()) return
    setCreatorBusy(true)
    try {
      if (rejectModal.type === 'app') {
        await rejectCreatorApplication(rejectModal.id, rejectReason)
        await loadCreatorApplications()
      } else {
        await rejectSubmission(rejectModal.id, rejectReason)
        await loadSubmissions()
      }
      showToast({ type: 'success', message: 'Rejected with reason' })
      setRejectModal(null); setRejectReason('')
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not reject' })
    } finally { setCreatorBusy(false) }
  }

  const handleApproveSubmission = async (id) => {
    setCreatorBusy(true)
    try {
      await approveSubmission(id)
      showToast({ type: 'success', message: 'Content approved and now live' })
      await loadSubmissions()
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not approve' })
    } finally { setCreatorBusy(false) }
  }

  // ── Upload handlers ───────────────────────────────────────────────────────
  const handleCreateCollection = async (e) => {
    e.preventDefault(); setNotice(''); setError(''); setBusy(true)
    try {
      const created = await createAdminCollection({ name: collectionName, bunnyCollectionId })
      setCollections((prev) => [created, ...prev.filter((c) => c._id !== created._id)])
      setCollectionName(''); setBunnyCollectionId('')
      setNotice('Collection mapping saved.')
    } catch (err) {
      setError(err?.message || 'Could not save collection.')
    } finally { setBusy(false) }
  }

  const handleCreateNewBunnyCollection = async (e) => {
    e.preventDefault(); setNotice(''); setError(''); setBusy(true)
    try {
      const created = await createBunnyCollection(newCollectionName.trim())
      setCollections((prev) => [created, ...prev.filter((c) => c._id !== created._id)])
      setBunnyCollections((prev) => [...prev, { guid: created.bunnyCollectionId, name: created.name }])
      setNewCollectionName('')
      setCollectionMode('pick')
      setNotice(`Collection "${created.name}" created in CDN and saved.`)
    } catch (err) {
      setError(err?.message || 'Could not create collection.')
    } finally { setBusy(false) }
  }

  const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/x-msvideo', 'video/webm']
  const MAX_FILE_SIZE = 1024 * 1024 * 1024 // 1 GB — server limit

  const validateVideoFile = (f) => {
    if (!f) return 'Please choose a video file.'
    if (!ALLOWED_VIDEO_TYPES.includes(f.type)) return `Unsupported file type "${f.type}". Use MP4, MOV, or MKV.`
    if (f.size > MAX_FILE_SIZE) return `File is too large (${(f.size / 1024 / 1024).toFixed(0)} MB). Maximum is 1 GB.`
    return null
  }

  const handleFileChange = (f) => {
    const err = validateVideoFile(f)
    if (err) { setError(err); return }
    setError(''); setFile(f)
  }

  // When a Series content item is selected, fetch its existing episodes
  const handleContentSelect = async (contentId) => {
    setSelectedContentId(contentId)
    setEpisodeNumber(''); setEpisodeTitle(''); setEpisodeDuration('')
    setSeriesEpisodes([])
    const selected = contentItems.find((c) => c._id === contentId)
    if (selected?.type === 'Series' && contentId) {
      setLoadingSeriesEpisodes(true)
      try {
        const full = await fetchAdminContentById(contentId)
        const eps  = (full.episodes || []).sort((a, b) => a.number - b.number)
        setSeriesEpisodes(eps)
        // Auto-suggest next episode number
        const nextNum = eps.length > 0 ? Math.max(...eps.map((e) => e.number)) + 1 : 1
        setEpisodeNumber(String(nextNum))
      } catch { /* non-critical */ }
      finally { setLoadingSeriesEpisodes(false) }
    }
  }

  const handleUpload = async (e) => {
    e.preventDefault()
    const fileErr = validateVideoFile(file)
    if (fileErr) return setError(fileErr)
    if (!selectedCollectionId) return setError('Please select a mapped collection.')

    const isSeries = Boolean(selectedContentId && contentItems.find((c) => c._id === selectedContentId)?.type === 'Series')
    if (isSeries && !episodeNumber) return setError('Please enter an episode number for this series.')

    setNotice(''); setError(''); setBusy(true)
    try {
      const job = await createUploadJob({
        title:           isSeries && episodeTitle.trim() ? episodeTitle.trim() : title,
        collectionId:    selectedCollectionId,
        contentId:       selectedContentId || null,
        episodeNumber:   isSeries ? Number(episodeNumber) : null,
        episodeTitle:    isSeries ? episodeTitle.trim()   : '',
        episodeDuration: isSeries ? episodeDuration.trim() : '',
      })
      await uploadJobFile(job._id, file)
      setTitle(''); setSelectedContentId(''); setFile(null)
      setEpisodeNumber(''); setEpisodeTitle(''); setEpisodeDuration(''); setSeriesEpisodes([])
      setNotice('Upload accepted — video is processing asynchronously.')
      await loadData()
    } catch (err) {
      setError(err?.message || 'Upload failed.')
    } finally { setBusy(false) }
  }

  const handleImportFromCdn = async () => {
    setNotice(''); setError(''); setBusy(true)
    try {
      const result = await importFromCdn()
      setNotice(result.imported > 0
        ? `Imported ${result.imported} new video${result.imported !== 1 ? 's' : ''} from CDN.`
        : 'No new videos found — all CDN videos are already in the library.')
      await loadData()
    } catch (err) {
      setError(err?.message || 'Could not import from CDN.')
    } finally { setBusy(false) }
  }

  const handleSyncBunnyCollections = async () => {
    setNotice(''); setError(''); setBusy(true)
    try {
      const result = await syncBunnyCollections()
      setNotice(`Synced ${result.imported} collections.`)
      await loadData()
    } catch (err) {
      setError(err?.message || 'Could not sync collections.')
    } finally { setBusy(false) }
  }

  const handleMapExisting = async (e) => {
    e.preventDefault()
    if (!mapContentId || !mapVideoId) { setError('Select both a content item and a stream video.'); return }
    setNotice(''); setError(''); setBusy(true)
    try {
      const result = await mapExistingBunnyVideo({ contentId: mapContentId, bunnyVideoId: mapVideoId })
      setNotice(result.message || 'Stream video mapped successfully.')
      await loadData()
    } catch (err) {
      setError(err?.message || 'Could not map stream video.')
    } finally { setBusy(false) }
  }

  // ── Guards ────────────────────────────────────────────────────────────────
  if (sessionLoading) return <main className={styles.state}>Loading admin studio...</main>

  if (!adminAllowed) {
    return (
      <main className={styles.state}>
        <div className={styles.gate}>
          <ShieldAlert size={24} />
          <p>{sessionError || 'Admin access required.'}</p>
        </div>
      </main>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className={styles.page}>

      {/* Toast */}
      {toast && (
        <div className={`${styles.toast} ${toast.type === 'error' ? styles.toastError : styles.toastSuccess}`}>
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          <span>{toast.message}</span>
          <button className={styles.toastClose} onClick={() => setToast(null)}>×</button>
        </div>
      )}

      {/* Live mode confirmation overlay */}
      {showLiveConfirm && (
        <div className={styles.modalBackdrop} onClick={(e) => e.target === e.currentTarget && setShowLiveConfirm(false)}>
          <div className={styles.modalPanel} style={{ maxWidth: 440 }} role="dialog" aria-modal="true">
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle} style={{ color: '#f87171' }}>
                <AlertTriangle size={16} />
                Switch to Live Mode
              </h2>
              <button className={styles.modalClose} onClick={() => setShowLiveConfirm(false)}><X size={16} /></button>
            </div>
            <div style={{ padding: '20px 24px 24px' }}>
              <p style={{ fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.6, marginBottom: 20 }}>
                Live mode processes <strong style={{ color: 'var(--color-text)' }}>real payments</strong> from real users.
                Make sure your provider credentials, webhook endpoint, and plan amounts are production-ready before switching.
              </p>
              <label style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'block', marginBottom: 8 }}>
                Type <code style={{ color: '#f87171', background: 'rgba(248,113,113,0.1)', padding: '1px 6px', borderRadius: 4 }}>LIVE</code> to confirm
              </label>
              <input
                className={styles.input}
                value={liveConfirmText}
                onChange={(e) => setLiveConfirmText(e.target.value)}
                placeholder="LIVE"
                autoFocus
              />
              <div className={styles.modalFooter} style={{ marginTop: 20 }}>
                <button className={styles.ghostBtn} onClick={() => { setShowLiveConfirm(false); setLiveConfirmText('') }}>Cancel</button>
                <button
                  className={styles.primaryBtn}
                  style={{ background: liveConfirmText === 'LIVE' ? '#dc2626' : undefined }}
                  disabled={liveConfirmText !== 'LIVE' || paymentBusy}
                  onClick={handleConfirmLive}
                >
                  Activate Live Mode
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Admin Studio</h1>
          <p className={styles.titleSub}>
            {activeTab === 'content'  && 'Manage the content library'}
            {activeTab === 'uploads'  && 'Upload and map video files'}
            {activeTab === 'payments' && 'Configure payment infrastructure'}
            {activeTab === 'creators' && 'Review creator applications and content submissions'}
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.refreshBtn} onClick={() => void loadData()}>
            <RefreshCw size={13} /> Refresh
          </button>
          {activeTab === 'uploads' && (
            <>
              <button className={styles.refreshBtn} onClick={handleSyncBunnyCollections} disabled={busy}>
                <FolderPlus size={13} /> Sync CDN
              </button>
              <button className={styles.importBtn} onClick={handleImportFromCdn} disabled={busy}>
                <UploadCloud size={13} /> Import from CDN
              </button>
            </>
          )}
        </div>
      </header>

      {/* Tab bar */}
      <nav className={styles.tabBar}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`${styles.tab} ${activeTab === id ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(id)}
          >
            <Icon size={14} />
            {label}
            {id === 'payments' && paymentConfig?.mode === 'live' && (
              <span className={styles.tabLivePip} title="Live mode active" />
            )}
          </button>
        ))}
      </nav>

      {(notice || error) && (
        <div className={`${styles.message} ${error ? styles.error : styles.notice}`}>
          {error || notice}
        </div>
      )}

      {/* ── CONTENT TAB ──────────────────────────────────────────────────── */}
      {activeTab === 'content' && (
        <section className={styles.jobsCard}>
          <div className={styles.libraryHeader}>
            <h2 className={styles.cardTitle}><Library size={16} /> Content Library</h2>
            <input
              className={styles.librarySearch}
              placeholder="Search title or type…"
              value={contentSearch}
              onChange={(e) => setContentSearch(e.target.value)}
            />
          </div>
          <div className={styles.libraryList}>
            {filteredContent.length === 0 && <p className={styles.empty}>No content found.</p>}
            {filteredContent.map((item) => (
              <div key={item._id} className={styles.libraryRow}>
                <div className={styles.libraryLeft}>
                  <p className={styles.libraryTitle}>{item.title}</p>
                  <p className={styles.libraryMeta}>
                    {item.type}
                    {item.releaseYear ? ` · ${item.releaseYear}` : ''}
                    {item.genre?.length ? ` · ${item.genre.join(', ')}` : ''}
                    {!item.bunnyVideoId ? ' · No stream' : ''}
                  </p>
                </div>
                <div className={styles.libraryActions}>
                  <button
                    className={`${styles.proToggleBtn} ${item.isPremium ? styles.proToggleBtnOn : ''}`}
                    onClick={() => handleTogglePremium(item)}
                    disabled={togglingPremium === item._id}
                    title={item.isPremium ? 'Click to make Free' : 'Click to make Premium'}
                    aria-label={item.isPremium ? 'Mark as free' : 'Mark as premium'}
                  >
                    <Crown size={11} />
                    {item.isPremium ? 'Free' : 'Premium'}
                  </button>
                  <button
                    className={styles.editBtn}
                    onClick={(e) => { e.currentTarget.blur(); openEditModal(item) }}
                    disabled={editBusy && editingId === item._id}
                  >
                    <Pencil size={12} /> Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── UPLOADS TAB ──────────────────────────────────────────────────── */}
      {activeTab === 'uploads' && (
        <>
          <section className={styles.grid}>
            <article className={styles.card}>
              <h2 className={styles.cardTitle}><FolderPlus size={16} /> Collection Mapping</h2>

              {/* mode toggle */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                <button
                  type="button"
                  className={collectionMode === 'pick' ? styles.primaryBtn : styles.secondaryBtn}
                  onClick={() => setCollectionMode('pick')}
                  style={{ flex: 1, padding: '0.4rem' }}
                >
                  Pick Existing
                </button>
                <button
                  type="button"
                  className={collectionMode === 'create' ? styles.primaryBtn : styles.secondaryBtn}
                  onClick={() => setCollectionMode('create')}
                  style={{ flex: 1, padding: '0.4rem' }}
                >
                  + Create New
                </button>
              </div>

              {collectionMode === 'pick' ? (
                <form className={styles.form} onSubmit={handleCreateCollection}>
                  <label className={styles.label}>
                    Dhara Collection Name
                    <input className={styles.input} value={collectionName} onChange={(e) => setCollectionName(e.target.value)} placeholder="Bengali Classics" required />
                  </label>
                  <label className={styles.label}>
                    CDN Collection
                    <select
                      className={styles.select}
                      value={bunnyCollectionId}
                      onChange={(e) => {
                        setBunnyCollectionId(e.target.value)
                        const picked = bunnyCollections.find((c) => c.guid === e.target.value)
                        if (picked && !collectionName) setCollectionName(picked.name)
                      }}
                      required
                    >
                      <option value="">Select CDN collection</option>
                      {bunnyCollections.map((c) => (
                        <option key={c.guid} value={c.guid}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                  <button className={styles.primaryBtn} type="submit" disabled={busy}>Save Mapping</button>
                </form>
              ) : (
                <form className={styles.form} onSubmit={handleCreateNewBunnyCollection}>
                  <label className={styles.label}>
                    New Collection Name
                    <input
                      className={styles.input}
                      value={newCollectionName}
                      onChange={(e) => setNewCollectionName(e.target.value)}
                      placeholder="e.g. Bengali Classics"
                      required
                    />
                  </label>
                  <p style={{ fontSize: '0.75rem', color: '#888', margin: '-0.5rem 0 0.5rem' }}>
                    This will create the collection in the CDN and save the mapping.
                  </p>
                  <button className={styles.primaryBtn} type="submit" disabled={busy || !newCollectionName.trim()}>
                    {busy ? 'Creating…' : 'Create Collection'}
                  </button>
                </form>
              )}
            </article>

            <article className={styles.card}>
              <h2 className={styles.cardTitle}><UploadCloud size={16} /> Upload Video</h2>
              <form className={styles.form} onSubmit={handleUpload}>

                <p style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-accent)', marginBottom: '0.5rem' }}>
                  STEP 1 — NAME & ORGANISE
                </p>
                <label className={styles.label}>
                  Video Title
                  <input className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Movie title" required />
                </label>
                <label className={styles.label}>
                  Collection
                  <select className={styles.select} value={selectedCollectionId} onChange={(e) => setSelectedCollectionId(e.target.value)} required>
                    <option value="">Select collection</option>
                    {collections.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </label>

                <p style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-accent)', margin: '1rem 0 0.5rem' }}>
                  STEP 2 — LINK TO CONTENT (OPTIONAL)
                </p>
                <label className={styles.label}>
                  Content Item
                  <select className={styles.select} value={selectedContentId} onChange={(e) => handleContentSelect(e.target.value)}>
                    <option value="">Upload without linking (map later)</option>
                    {contentItems.map((item) => (
                      <option key={item._id} value={item._id}>
                        {item.title} ({item.type})
                      </option>
                    ))}
                  </select>
                  {!selectedContentId && (
                    <span style={{ fontSize: '0.72rem', color: '#b45309', marginTop: '0.3rem', display: 'block' }}>
                      Video uploads to CDN but won't appear in the app until mapped.
                    </span>
                  )}
                </label>

                {/* ── Episode fields — shown only for Series ── */}
                {selectedContentId && contentItems.find((c) => c._id === selectedContentId)?.type === 'Series' && (
                  <div className={styles.episodeUploadBlock}>
                    <p className={styles.episodeUploadTitle}>
                      <Film size={12} /> Series Episode
                    </p>

                    {loadingSeriesEpisodes && (
                      <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading existing episodes…</p>
                    )}

                    {/* Existing episodes summary */}
                    {seriesEpisodes.length > 0 && (
                      <div className={styles.existingEpisodes}>
                        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>
                          Already uploaded: {seriesEpisodes.map((ep) => `E${ep.number}`).join(', ')}
                        </p>
                        <div className={styles.epPills}>
                          {seriesEpisodes.map((ep) => (
                            <button
                              key={ep.number}
                              type="button"
                              className={`${styles.epPill} ${Number(episodeNumber) === ep.number ? styles.epPillActive : ''}`}
                              onClick={() => {
                                setEpisodeNumber(String(ep.number))
                                setEpisodeTitle(ep.title || '')
                                setEpisodeDuration(ep.duration || '')
                              }}
                            >
                              E{ep.number}
                              {ep.bunnyVideoId ? ' ✓' : ' (no video)'}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 100px', gap: 8, marginTop: 8 }}>
                      <label className={styles.label}>
                        Ep #
                        <input
                          className={styles.input}
                          type="number"
                          min="1"
                          value={episodeNumber}
                          onChange={(e) => setEpisodeNumber(e.target.value)}
                          placeholder="1"
                          required
                        />
                      </label>
                      <label className={styles.label}>
                        Episode Title
                        <input
                          className={styles.input}
                          value={episodeTitle}
                          onChange={(e) => setEpisodeTitle(e.target.value)}
                          placeholder={`Episode ${episodeNumber || 'N'} title`}
                        />
                      </label>
                      <label className={styles.label}>
                        Duration
                        <input
                          className={styles.input}
                          value={episodeDuration}
                          onChange={(e) => setEpisodeDuration(e.target.value)}
                          placeholder="42m"
                        />
                      </label>
                    </div>

                    <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                      The video will automatically link to Episode {episodeNumber || 'N'} of this series once processed.
                    </p>
                  </div>
                )}

                <p style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-accent)', margin: '1rem 0 0.5rem' }}>
                  STEP 3 — UPLOAD FILE
                </p>
                <div className={styles.label}>
                  <div
                    className={`${styles.dropZone} ${dragOver ? styles.dropZoneActive : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFileChange(f) }}
                  >
                    <Film size={22} className={styles.dropZoneIcon} />
                    {file
                      ? <><span className={styles.dropZoneFile}>{file.name}</span><span className={styles.dropZoneHint}>{(file.size / 1024 / 1024).toFixed(1)} MB</span></>
                      : <><span className={styles.dropZoneText}>Drop video file here</span><span className={styles.dropZoneHint}>or click to browse · MP4, MOV, MKV · max 1 GB</span></>
                    }
                    <input className={styles.fileInput} type="file" accept=".mp4,.mov,.mkv,video/mp4,video/quicktime,video/x-matroska" onChange={(e) => handleFileChange(e.target.files?.[0] || null)} required />
                  </div>
                </div>

                <button className={styles.primaryBtn} type="submit" disabled={busy || !selectedCollection}>
                  {busy ? 'Uploading...' : 'Upload Video'}
                </button>
              </form>
            </article>
          </section>

          <section className={styles.jobsCard}>
            <h2 className={styles.cardTitle}><Link2 size={16} /> Map Existing Video</h2>
            <p style={{ fontSize: '0.78rem', color: '#888', margin: '-0.25rem 0 1.25rem' }}>
              Use this when a video already exists in the CDN but hasn't been linked to a Dhara content item yet.
            </p>
            <form className={styles.form} onSubmit={handleMapExisting}>

              <p style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-accent)', marginBottom: '0.5rem' }}>
                STEP 1 — FIND THE CDN VIDEO
              </p>
              <label className={styles.label}>
                Collection
                <select className={styles.select} value={mapCollectionId} onChange={(e) => { setMapCollectionId(e.target.value); setMapVideoId(''); void loadBunnyVideos(e.target.value) }}>
                  <option value="">Select collection</option>
                  {bunnyCollections.map((c) => <option key={c.guid} value={c.guid}>{c.name} ({c.videoCount} videos)</option>)}
                </select>
              </label>
              <label className={styles.label}>
                Video
                <select className={styles.select} value={mapVideoId} onChange={(e) => setMapVideoId(e.target.value)} disabled={!mapCollectionId}>
                  <option value="">{mapCollectionId ? 'Select video' : 'Select a collection first'}</option>
                  {bunnyVideos.map((v) => <option key={v.guid} value={v.guid}>{v.title} ({Math.round((v.length || 0) / 60)} min)</option>)}
                </select>
                {mapVideoError && <span style={{ fontSize: '0.72rem', color: '#b45309', marginTop: '0.3rem', display: 'block' }}>{mapVideoError}</span>}
              </label>

              <p style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-accent)', margin: '1rem 0 0.5rem' }}>
                STEP 2 — CHOOSE THE DHARA CONTENT TO LINK IT TO
              </p>
              <label className={styles.label}>
                Content Item
                <select className={styles.select} value={mapContentId} onChange={(e) => setMapContentId(e.target.value)}>
                  <option value="">Select content</option>
                  {contentItems.map((item) => <option key={item._id} value={item._id}>{item.title} ({item.type})</option>)}
                </select>
              </label>

              <button className={styles.primaryBtn} type="submit" disabled={busy || !mapVideoId || !mapContentId}>
                Link Video to Content
              </button>
            </form>
          </section>

          <section className={styles.jobsCard}>
            <h2 className={styles.cardTitle}>Upload Queue</h2>
            <div className={styles.jobsList}>
              {jobs.length === 0 && <p className={styles.empty}>No uploads yet.</p>}
              {jobs.map((job) => (
                <article key={job._id} className={styles.jobRow}>
                  <div className={styles.jobMain}>
                    <p className={styles.jobTitle}>
                      {job.episodeNumber
                        ? <>E{job.episodeNumber}{job.episodeTitle ? ` — ${job.episodeTitle}` : ''}</>
                        : job.title
                      }
                    </p>
                    <p className={styles.jobMeta}>
                      {job.collectionName || job.collectionId?.name || 'Unknown'}
                      {job.episodeDuration ? ` · ${job.episodeDuration}` : ''}
                      {job.bunnyVideoId ? ` · ${job.bunnyVideoId}` : ''}
                    </p>
                  </div>
                  <div className={styles.jobSide}>
                    <span className={`${styles.statusBadge} ${statusClass[job.status] || ''}`}>{job.status}</span>
                    <span className={styles.progress}>{job.progress || 0}%</span>
                  </div>
                  <p className={styles.jobNote}>{job.error || job.note || 'Pending update...'}</p>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      {/* ── PAYMENTS TAB ─────────────────────────────────────────────────── */}
      {activeTab === 'payments' && paymentConfig && (
        <div className={styles.paymentsPanel}>

          {/* Hero row */}
          <div className={styles.paymentHero}>
            <div className={styles.paymentHeroLeft}>
              <p className={styles.paymentHeroLabel}>Active Provider</p>
              <div className={styles.paymentHeroProvider}>
                <Zap size={18} className={styles.paymentHeroIcon} />
                <span className={styles.paymentHeroName}>
                  {paymentConfig.providerStatus?.[paymentConfig.activeProvider]?.displayName || paymentConfig.activeProvider}
                </span>
                <span className={`${styles.modePill} ${paymentConfig.mode === 'live' ? styles.modePillLive : styles.modePillTest}`}>
                  {paymentConfig.mode === 'live' ? '● LIVE' : '○ TEST'}
                </span>
              </div>
              {paymentConfig.mode === 'live' && (
                <p className={styles.liveWarningText}>
                  <AlertTriangle size={12} /> Real payments are being processed
                </p>
              )}
            </div>
            <div className={styles.paymentHeroRight}>
              <p className={styles.paymentHeroLabel}>Mode</p>
              <div className={styles.modeToggleGroup}>
                <button
                  className={`${styles.modeToggleBtn} ${paymentConfig.mode === 'test' ? styles.modeToggleBtnActive : ''}`}
                  onClick={() => paymentConfig.mode !== 'test' && handleSetMode('test')}
                  disabled={paymentBusy || paymentConfig.mode === 'test'}
                >
                  Test
                </button>
                <button
                  className={`${styles.modeToggleBtn} ${paymentConfig.mode === 'live' ? styles.modeToggleBtnLive : ''}`}
                  onClick={() => paymentConfig.mode !== 'live' && handleSetMode('live')}
                  disabled={paymentBusy || paymentConfig.mode === 'live'}
                >
                  Live
                </button>
              </div>
            </div>
          </div>

          {/* Provider cards */}
          <div className={styles.providerGrid}>
            {paymentConfig.supportedProviders?.map((providerKey) => {
              const status  = paymentConfig.providerStatus?.[providerKey]
              const isActive = paymentConfig.activeProvider === providerKey
              return (
                <div key={providerKey} className={`${styles.providerCard} ${isActive ? styles.providerCardActive : ''}`}>
                  <div className={styles.providerCardTop}>
                    <div className={styles.providerCardHeader}>
                      <span className={styles.providerCardName}>{status?.displayName || providerKey}</span>
                      {isActive && <span className={styles.activeBadge}>ACTIVE</span>}
                    </div>
                    {status?.configured ? (
                      <div className={styles.configuredRow}>
                        <Check size={12} className={styles.configuredIcon} />
                        <span className={styles.configuredText}>Configured</span>
                        {status.publicKeyHint && (
                          <code className={styles.keyHint}>{status.publicKeyHint}</code>
                        )}
                      </div>
                    ) : (
                      <div className={styles.unconfiguredRow}>
                        <AlertTriangle size={12} className={styles.unconfiguredIcon} />
                        <span className={styles.unconfiguredText}>Env vars missing</span>
                      </div>
                    )}
                  </div>

                  {status?.webhookUrl && (
                    <div className={styles.webhookBlock}>
                      <p className={styles.webhookLabel}>Webhook endpoint</p>
                      <div className={styles.webhookRow}>
                        <code className={styles.webhookCode}>{status.webhookUrl}</code>
                        <button
                          className={styles.copyBtn}
                          onClick={() => copyWebhookUrl(providerKey, status.webhookUrl)}
                          title="Copy"
                        >
                          {copiedWebhook === providerKey ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      </div>
                    </div>
                  )}

                  {!isActive && (
                    <button
                      className={styles.activateBtn}
                      disabled={paymentBusy || !status?.configured}
                      onClick={() => handleSetProvider(providerKey)}
                      title={!status?.configured ? 'Set env vars before activating' : undefined}
                    >
                      {!status?.configured ? 'Not configured' : 'Activate'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Developer callout */}
          <div className={styles.devCallout}>
            <div className={styles.devCalloutHeader}>
              <Code2 size={15} className={styles.devCalloutIcon} />
              <span>Adding a new payment provider</span>
            </div>
            <ol className={styles.devCalloutSteps}>
              <li>Create <code>backend/src/providers/stripe.js</code> implementing the adapter interface</li>
              <li>Register it in <code>backend/src/providers/index.js</code> under <code>ADAPTERS</code></li>
              <li>Add the provider's env vars to your secrets config</li>
              <li>Redeploy — it will appear here and can be activated without further code changes</li>
            </ol>
          </div>
        </div>
      )}

      {activeTab === 'payments' && !paymentConfig && (
        <div className={styles.paymentsPanel}>
          <p className={styles.empty}>Loading payment config…</p>
        </div>
      )}

      {/* ── CREATOR HUB TAB ──────────────────────────────────────────────── */}
      {activeTab === 'creators' && (
        <div className={styles.paymentsPanel}>

          {/* Reject reason modal */}
          {rejectModal && (
            <div className={styles.modalBackdrop} onClick={(e) => e.target === e.currentTarget && (setRejectModal(null), setRejectReason(''))}>
              <div className={styles.modalPanel} style={{ maxWidth: 420 }} role="dialog" aria-modal="true">
                <div className={styles.modalHeader}>
                  <h2 className={styles.modalTitle}><AlertTriangle size={14} /> Reject — Add Reason</h2>
                  <button className={styles.modalClose} onClick={() => { setRejectModal(null); setRejectReason('') }}><X size={16} /></button>
                </div>
                <div style={{ padding: '16px 24px 24px' }}>
                  <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
                    This reason will be shown to <strong>{rejectModal.name}</strong>.
                  </p>
                  <textarea
                    className={`${styles.input} ${styles.textarea}`}
                    rows={3}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="e.g. Video quality too low, missing metadata…"
                  />
                  <div className={styles.modalFooter} style={{ marginTop: 16 }}>
                    <button className={styles.ghostBtn} onClick={() => { setRejectModal(null); setRejectReason('') }}>Cancel</button>
                    <button className={styles.primaryBtn} style={{ background: '#dc2626' }} disabled={!rejectReason.trim() || creatorBusy} onClick={handleRejectCreator}>
                      Confirm Reject
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Sub-tab switcher */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            {[['applications', 'Creator Applications'], ['submissions', 'Content Submissions']].map(([id, label]) => (
              <button
                key={id}
                className={creatorHubTab === id ? styles.primaryBtn : styles.secondaryBtn}
                style={{ padding: '8px 18px' }}
                onClick={() => setCreatorHubTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── Applications sub-tab ── */}
          {creatorHubTab === 'applications' && (
            <section className={styles.jobsCard}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h2 className={styles.cardTitle}><UserCheck size={16} /> Creator Applications</h2>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[
                    { id: 'all',      label: 'All' },
                    { id: 'applied',  label: 'Pending' },
                    { id: 'approved', label: 'Approved' },
                    { id: 'rejected', label: 'Rejected' },
                  ].map(({ id, label }) => (
                    <button
                      key={id}
                      className={appStatusFilter === id ? styles.primaryBtn : styles.secondaryBtn}
                      style={{ padding: '4px 12px', fontSize: 12 }}
                      onClick={() => { setAppStatusFilter(id); void loadCreatorApplications(id) }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {creatorApplications.length === 0 && (
                <div className={styles.creatorEmptyState}>
                  <UserCheck size={28} className={styles.creatorEmptyIcon} />
                  <p className={styles.creatorEmptyTitle}>
                    {appStatusFilter === 'applied' ? 'No pending applications' :
                     appStatusFilter === 'approved' ? 'No approved creators yet' :
                     appStatusFilter === 'rejected' ? 'No rejected applications' :
                     'No creator applications yet'}
                  </p>
                  <p className={styles.creatorEmptyDesc}>
                    {appStatusFilter === 'applied' || appStatusFilter === 'all'
                      ? 'When users apply to become creators, their applications will appear here.'
                      : 'Switch to All or Pending to see other applications.'}
                  </p>
                </div>
              )}

              {creatorApplications.map((applicant) => (
                <div key={applicant._id} className={styles.creatorAppRow}>
                  {/* Status indicator column */}
                  <div className={`${styles.creatorAppStatus} ${
                    applicant.creatorStatus === 'approved' ? styles.creatorAppStatusApproved :
                    applicant.creatorStatus === 'rejected' ? styles.creatorAppStatusRejected :
                    styles.creatorAppStatusPending
                  }`}>
                    <span className={styles.creatorAppStatusDot} />
                    {applicant.creatorStatus === 'approved' ? 'Approved' :
                     applicant.creatorStatus === 'rejected' ? 'Rejected' :
                     'Under Review'}
                  </div>

                  {/* Info */}
                  <div className={styles.creatorAppInfo}>
                    <p className={styles.creatorAppName}>
                      {applicant.creatorProfile?.studioName || applicant.displayName || applicant.email}
                    </p>
                    <p className={styles.creatorAppMeta}>
                      {applicant.email}
                      {applicant.creatorProfile?.bio ? ` · ${applicant.creatorProfile.bio.slice(0, 80)}` : ''}
                    </p>
                    {applicant.creatorProfile?.portfolioUrl && (
                      <p className={styles.creatorAppPortfolio}>
                        <a href={applicant.creatorProfile.portfolioUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--color-accent)', fontSize: 12 }}>
                          {applicant.creatorProfile.portfolioUrl}
                        </a>
                      </p>
                    )}
                    {applicant.creatorRejectionReason && (
                      <p style={{ fontSize: 12, color: '#f87171', marginTop: 4 }}>
                        Rejection reason: {applicant.creatorRejectionReason}
                      </p>
                    )}
                  </div>

                  {/* Applied date */}
                  {applicant.creatorProfile?.appliedAt && (
                    <p className={styles.creatorAppDate}>
                      {new Date(applicant.creatorProfile.appliedAt).toLocaleDateString('en-IN', {
                        day: 'numeric', month: 'short', year: 'numeric'
                      })}
                    </p>
                  )}

                  {/* Actions */}
                  <div className={styles.libraryActions}>
                    {applicant.creatorStatus !== 'approved' && (
                      <button className={styles.editBtn} style={{ background: 'rgba(74,222,128,0.15)', color: '#4ade80', borderColor: 'rgba(74,222,128,0.3)' }} disabled={creatorBusy} onClick={() => handleApproveCreator(applicant._id)}>
                        <UserCheck size={12} /> Approve
                      </button>
                    )}
                    {applicant.creatorStatus !== 'rejected' && (
                      <button className={styles.editBtn} style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }} disabled={creatorBusy} onClick={() => { setRejectModal({ type: 'app', id: applicant._id, name: applicant.email }); setRejectReason('') }}>
                        <UserX size={12} /> Reject
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* ── Submissions sub-tab ── */}
          {creatorHubTab === 'submissions' && (
            <section className={styles.jobsCard}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h2 className={styles.cardTitle}><FileCheck size={16} /> Content Submissions</h2>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['pending', 'approved', 'rejected', 'all'].map((s) => (
                    <button
                      key={s}
                      className={subStatusFilter === s ? styles.primaryBtn : styles.secondaryBtn}
                      style={{ padding: '4px 12px', fontSize: 12, textTransform: 'capitalize' }}
                      onClick={() => { setSubStatusFilter(s); void loadSubmissions(s) }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {submissions.length === 0 && <p className={styles.empty}>No submissions found.</p>}

              {submissions.map((sub) => (
                <div key={sub._id} className={styles.libraryRow}>
                  <div className={styles.libraryLeft}>
                    <p className={styles.libraryTitle}>{sub.title} <span style={{ fontSize: 11, color: 'var(--color-text-dim)', fontWeight: 400 }}>({sub.type})</span></p>
                    <p className={styles.libraryMeta}>
                      by {sub.creatorId?.creatorProfile?.studioName || sub.creatorId?.email || 'Unknown Creator'}
                      {sub.revisionCount > 0 ? ` · Revision #${sub.revisionCount}` : ''}
                      {sub.rejectionReason ? ` · Prev reason: ${sub.rejectionReason.slice(0, 60)}` : ''}
                    </p>
                  </div>
                  <div className={styles.libraryActions}>
                    <span className={`${styles.statusBadge} ${sub.submissionStatus === 'approved' ? styles.statusReady : sub.submissionStatus === 'rejected' ? styles.statusFailed : styles.statusProcessing}`}>
                      {sub.submissionStatus}
                    </span>
                    {sub.submissionStatus !== 'approved' && (
                      <button className={styles.editBtn} style={{ background: 'rgba(74,222,128,0.15)', color: '#4ade80', borderColor: 'rgba(74,222,128,0.3)' }} disabled={creatorBusy} onClick={() => handleApproveSubmission(sub._id)}>
                        <FileCheck size={12} /> Approve
                      </button>
                    )}
                    {sub.submissionStatus !== 'rejected' && (
                      <button className={styles.editBtn} style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }} disabled={creatorBusy} onClick={() => { setRejectModal({ type: 'sub', id: sub._id, name: sub.title }); setRejectReason('') }}>
                        <FileX size={12} /> Reject
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      {/* Edit metadata modal — shown on any tab */}
      {editingId && (
        <div className={styles.modalBackdrop} onClick={(e) => e.target === e.currentTarget && closeEditModal()}>
          <div className={styles.modalPanel} role="dialog" aria-modal="true" aria-label="Edit metadata">
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}><Pencil size={14} /> Edit Metadata</h2>
              <button className={styles.modalClose} onClick={closeEditModal} aria-label="Close"><X size={16} /></button>
            </div>

            {editBusy && !editForm && <p className={styles.empty}>Loading…</p>}
            {editNotice && <p className={`${styles.message} ${styles.notice}`}>{editNotice}</p>}
            {editError  && <p className={`${styles.message} ${styles.error}`}>{editError}</p>}

            {editForm && (
              <form ref={modalFormRef} className={styles.modalForm} onSubmit={handleEditSave} id="edit-metadata-form">
                <div className={styles.modalGrid}>
                  <label className={`${styles.label} ${styles.spanFull}`}>
                    Title *
                    <input className={styles.input} value={editForm.title} onChange={ef('title')} required />
                  </label>
                  <label className={styles.label}>
                    Subtitle / Tagline
                    <input className={styles.input} value={editForm.subtitle} onChange={ef('subtitle')} placeholder="e.g. একটি রহস্য কাহিনী" />
                  </label>
                  <label className={styles.label}>
                    Type
                    <select className={styles.select} value={editForm.type} onChange={ef('type')}>
                      <option value="Film">Film</option>
                      <option value="Series">Series</option>
                      <option value="Documentary">Documentary</option>
                    </select>
                  </label>
                  <label className={styles.label}>
                    Language
                    <select className={styles.select} value={editForm.contentLanguage || ''} onChange={ef('contentLanguage')}>
                      <option value="">— Select —</option>
                      <option value="Bengali">Bengali (বাংলা)</option>
                      <option value="Hindi">Hindi (হিন্দি)</option>
                      <option value="English">English</option>
                      <option value="Odia">Odia</option>
                      <option value="Tamil">Tamil</option>
                      <option value="Telugu">Telugu</option>
                    </select>
                  </label>
                  <label className={styles.label}>
                    Certification (CBFC)
                    <select className={styles.select} value={editForm.certification || ''} onChange={ef('certification')}>
                      <option value="">— Select —</option>
                      <option value="U">U — Universal</option>
                      <option value="UA">UA — Parental Guidance</option>
                      <option value="A">A — Adults Only</option>
                    </select>
                  </label>
                  <label className={styles.label}>
                    <span>Genre <span className={styles.labelHint}>(comma-separated)</span></span>
                    <input className={styles.input} value={editForm.genre} onChange={ef('genre')} placeholder="Drama, Thriller, Romance" />
                    <div className={styles.quickTags}>
                      {['Drama','Thriller','Romance','Crime','Comedy','Historical','Family','Supernatural','Action','Social'].map((g) => (
                        <button key={g} type="button" className={styles.quickTag}
                          onClick={() => {
                            const existing = editForm.genre.split(',').map((s) => s.trim()).filter(Boolean)
                            if (!existing.includes(g)) setEditForm((prev) => ({ ...prev, genre: [...existing, g].join(', ') }))
                          }}>
                          {g}
                        </button>
                      ))}
                    </div>
                  </label>
                  <label className={styles.label}>
                    Director
                    <input className={styles.input} value={editForm.director} onChange={ef('director')} placeholder="পরিচালকের নাম" />
                  </label>
                  <label className={`${styles.label} ${styles.spanFull}`}>
                    <span>Cast <span className={styles.labelHint}>(comma-separated)</span></span>
                    <input className={styles.input} value={editForm.cast} onChange={ef('cast')} placeholder="Prosenjit Chatterjee, Rituparna Sengupta" />
                  </label>
                  <label className={styles.label}>
                    Release Year
                    <input className={styles.input} type="number" min="1900" max="2099" value={editForm.releaseYear} onChange={ef('releaseYear')} placeholder="2024" />
                  </label>
                  <label className={styles.label}>
                    <span>Rating <span className={styles.labelHint}>(0–5)</span></span>
                    <input className={styles.input} type="number" min="0" max="5" step="0.1" value={editForm.rating} onChange={ef('rating')} placeholder="4.2" />
                  </label>
                  <label className={styles.label}>
                    Review Count
                    <input className={styles.input} type="number" min="0" value={editForm.reviewCount} onChange={ef('reviewCount')} placeholder="12400" />
                  </label>
                  <label className={styles.label}>
                    Badge
                    <input className={styles.input} value={editForm.badge} onChange={ef('badge')} placeholder="NEW / EXCLUSIVE" />
                  </label>
                  <label className={styles.label}>
                    <span>Content Warnings <span className={styles.labelHint}>(comma-separated)</span></span>
                    <input className={styles.input} value={editForm.contentWarnings} onChange={ef('contentWarnings')} placeholder="violence, language, tobacco use" />
                  </label>
                  <label className={`${styles.label} ${styles.spanFull}`}>
                    <span>Mood Tags <span className={styles.labelHint}>(comma-separated, e.g. "Quirky, Romantic")</span></span>
                    <input className={styles.input} value={editForm.moodTags} onChange={ef('moodTags')} placeholder="Emotional, Suspenseful" />
                  </label>

                  <div className={`${styles.imagesSection} ${styles.spanFull}`}>
                    <p className={styles.imagesSectionTitle}><ImagePlus size={13} /> Images</p>
                    <div className={styles.imageGrid}>
                      {[
                        { field: 'posterUrl',   label: 'Poster',   hint: '2:3 portrait · cards & modal',    key: 'poster' },
                        { field: 'backdropUrl', label: 'Backdrop', hint: '16:9 landscape · hero & featured', key: 'backdrop' },
                      ].map(({ field, label, hint, key }) => (
                        <div key={field} className={styles.imageSlot}>
                          <p className={styles.imageSlotLabel}>{label} <span className={styles.labelHint}>{hint}</span></p>
                          <div className={styles.imagePreviewWrap}>
                            {editForm[field]
                              ? <img src={editForm[field]} className={styles.imagePreview} alt={`${label} preview`} />
                              : <div className={styles.imageEmpty}><ImagePlus size={22} opacity={0.3} /><span>No image</span></div>
                            }
                          </div>
                          <label className={styles.imageUploadBtn}>
                            {imgUploading[key] ? `Uploading… ${imgProgress[key]}%` : `Upload ${label}`}
                            <input type="file" accept="image/*" className={styles.fileInputHidden} disabled={imgUploading[key]} onChange={(e) => handleImageUpload(field, e.target.files?.[0])} />
                          </label>
                          <input className={styles.input} value={editForm[field]} onChange={ef(field)} placeholder="Or paste URL…" />
                        </div>
                      ))}
                    </div>
                  </div>

                  {editForm.bunnyVideoId && (
                    <div className={`${styles.label} ${styles.spanFull}`}>
                      Stream Video ID
                      <div className={styles.readonlyField}>
                        <span>{editForm.bunnyVideoId}</span>
                        <span className={styles.readonlyNote}>Linked via Upload or Map</span>
                      </div>
                    </div>
                  )}

                  <label className={`${styles.label} ${styles.spanFull}`}>
                    Synopsis / Description
                    <textarea className={`${styles.input} ${styles.textarea}`} value={editForm.desc} onChange={ef('desc')} rows={4} placeholder="গল্পের সারসংক্ষেপ লিখুন…" />
                  </label>

                  <div className={styles.toggleRow}>
                    <label className={styles.toggleLabel}>
                      <input type="checkbox" checked={editForm.isPremium} onChange={ef('isPremium')} />
                      <span>Premium (PRO)</span>
                    </label>
                    <label className={styles.toggleLabel}>
                      <input type="checkbox" checked={editForm.isFeatured} onChange={ef('isFeatured')} />
                      <span>Featured on Home</span>
                    </label>
                  </div>

                  {/* ── Episodes (Series only) ── */}
                  {editForm.type === 'Series' && (
                    <div className={`${styles.episodeSection} ${styles.spanFull}`}>
                      <div className={styles.episodeSectionHeader}>
                        <p className={styles.episodeSectionTitle}><ListPlus size={13} /> Episodes</p>
                        <button
                          type="button"
                          className={styles.ghostBtn}
                          style={{ padding: '4px 12px', fontSize: 12 }}
                          onClick={() => {
                            const next = editForm.episodes.length > 0
                              ? Math.max(...editForm.episodes.map((e) => e.number)) + 1
                              : 1
                            setEditForm((prev) => ({
                              ...prev,
                              episodes: [...prev.episodes, { number: next, title: '', duration: '', bunnyVideoId: '' }],
                            }))
                          }}
                        >
                          + Add Episode
                        </button>
                      </div>

                      {editForm.episodes.length === 0 && (
                        <p className={styles.episodeEmpty}>No episodes yet. Click "Add Episode" to start.</p>
                      )}

                      {editForm.episodes.map((ep, idx) => (
                        <div key={idx} className={styles.episodeRow}>
                          <span className={styles.episodeNum}>{ep.number}</span>
                          <input
                            className={`${styles.input} ${styles.epInput}`}
                            value={ep.title}
                            onChange={(e) => setEditForm((prev) => ({
                              ...prev,
                              episodes: prev.episodes.map((x, i) => i === idx ? { ...x, title: e.target.value } : x),
                            }))}
                            placeholder="Episode title"
                          />
                          <input
                            className={`${styles.input} ${styles.epInput} ${styles.epInputShort}`}
                            value={ep.duration}
                            onChange={(e) => setEditForm((prev) => ({
                              ...prev,
                              episodes: prev.episodes.map((x, i) => i === idx ? { ...x, duration: e.target.value } : x),
                            }))}
                            placeholder="42m"
                          />
                          <input
                            className={`${styles.input} ${styles.epInput}`}
                            value={ep.bunnyVideoId}
                            onChange={(e) => setEditForm((prev) => ({
                              ...prev,
                              episodes: prev.episodes.map((x, i) => i === idx ? { ...x, bunnyVideoId: e.target.value } : x),
                            }))}
                            placeholder="Bunny video ID"
                          />
                          <button
                            type="button"
                            className={styles.epDeleteBtn}
                            onClick={() => setEditForm((prev) => ({
                              ...prev,
                              episodes: prev.episodes.filter((_, i) => i !== idx),
                            }))}
                            aria-label="Remove episode"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </form>
            )}

            <div className={styles.modalFooter}>
              <button type="button" className={styles.ghostBtn} onClick={closeEditModal}>Cancel</button>
              <button type="submit" form="edit-metadata-form" className={styles.primaryBtn} disabled={editBusy || !editForm}>
                {editBusy ? 'Saving…' : 'Save Metadata'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
