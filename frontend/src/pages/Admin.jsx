import { useEffect, useMemo, useCallback, useState, useRef } from 'react'
import { UploadCloud, FolderPlus, ShieldAlert, RefreshCw, Link2, Film, CheckCircle2, XCircle, Pencil, X, Library, ImagePlus } from 'lucide-react'
import { uploadToCloudinary } from '../services/cloudinary'
import { useStore } from '../store/useStore'
import { useUploadNotifier } from '../hooks/useUploadNotifier'
import {
  createAdminCollection,
  createUploadJob,
  fetchAdminContentById,
  getAdminSession,
  importFromCdn,
  listBunnyCollections,
  listBunnyVideos,
  listAdminCollections,
  listAdminContent,
  listUploadJobs,
  mapExistingBunnyVideo,
  syncBunnyCollections,
  updateAdminContent,
  uploadJobFile,
} from '../services/api'
import styles from './Admin.module.css'

const statusClass = {
  awaiting_file: styles.statusAwaiting,
  queued: styles.statusQueued,
  uploading: styles.statusUploading,
  processing: styles.statusProcessing,
  ready: styles.statusReady,
  failed: styles.statusFailed,
}

export default function Admin() {
  const { authLoading } = useStore()
  const [sessionLoading, setSessionLoading] = useState(true)
  const [adminAllowed, setAdminAllowed] = useState(false)
  const [sessionError, setSessionError] = useState('')

  const [collections, setCollections] = useState([])
  const [bunnyCollections, setBunnyCollections] = useState([])
  const [bunnyVideos, setBunnyVideos] = useState([])
  const [contentItems, setContentItems] = useState([])
  const [jobs, setJobs] = useState([])

  const [collectionName, setCollectionName] = useState('')
  const [bunnyCollectionId, setBunnyCollectionId] = useState('')

  const [title, setTitle] = useState('')
  const [selectedCollectionId, setSelectedCollectionId] = useState('')
  const [selectedContentId, setSelectedContentId] = useState('')
  const [mapCollectionId, setMapCollectionId] = useState('')
  const [mapVideoId, setMapVideoId] = useState('')
  const [mapContentId, setMapContentId] = useState('')
  const [file, setFile] = useState(null)

  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [toast, setToast] = useState(null)   // { type: 'success'|'error', message }

  // ── Content metadata editor ────────────────────────────────────────────────
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editNotice, setEditNotice] = useState('')
  const [editError, setEditError] = useState('')
  const [contentSearch, setContentSearch] = useState('')
  const [imgUploading, setImgUploading] = useState({ poster: false, backdrop: false })
  const [imgProgress,  setImgProgress]  = useState({ poster: 0,     backdrop: 0     })
  const modalFormRef = useRef(null)

  const showToast = useCallback((t) => {
    setToast(t)
    setTimeout(() => setToast(null), 5000)
  }, [])

  const { requestPermission, checkTransitions } = useUploadNotifier(showToast)

  const selectedCollection = useMemo(
    () => collections.find((c) => c._id === selectedCollectionId),
    [collections, selectedCollectionId]
  )

  const loadData = async () => {
    const [collectionData, contentData, jobData, bunnyCollectionData] = await Promise.all([
      listAdminCollections(),
      listAdminContent(),
      listUploadJobs(40),
      listBunnyCollections(),
    ])

    setCollections(collectionData)
    setContentItems(contentData)
    setJobs(jobData)
    setBunnyCollections(bunnyCollectionData)
  }

  const loadBunnyVideos = async (collectionId) => {
    if (!collectionId) { setBunnyVideos([]); return }
    try {
      const items = await listBunnyVideos({ collectionId })
      setBunnyVideos(items)
      if (!items.length) setError('No videos found in this collection.')
    } catch (err) {
      setError(err?.message || 'Could not load videos.')
    }
  }

  useEffect(() => {
    if (authLoading) return  // wait for Firebase session to resolve first
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
    if (editForm && modalFormRef.current) {
      modalFormRef.current.scrollTop = 0
    }
  }, [editForm])

  const openEditModal = async (item) => {
    setEditNotice('')
    setEditError('')
    setEditingId(item._id)
    setEditBusy(true)
    try {
      const full = await fetchAdminContentById(item._id)
      setEditForm({
        title:       full.title       || '',
        subtitle:    full.subtitle    || '',
        desc:        full.desc        || '',
        type:        full.type        || 'Film',
        genre:       (full.genre     || []).join(', '),
        cast:        (full.cast      || []).join(', '),
        director:    full.director    || '',
        releaseYear: full.releaseYear != null ? String(full.releaseYear) : '',
        rating:      full.rating      != null ? String(full.rating)      : '',
        isPremium:   Boolean(full.isPremium),
        isFeatured:  Boolean(full.isFeatured),
        badge:       full.badge       || '',
        posterUrl:   full.posterUrl   || '',
        posterUrl:     full.posterUrl      || '',
        backdropUrl:   full.backdropUrl    || '',
        bunnyVideoId:  full.bunnyVideoId   || '',
        palette:       full.palette        || '',
        reviewCount:   full.reviewCount   != null ? String(full.reviewCount) : '',
        contentLanguage: full.contentLanguage || 'Bengali',
        certification: full.certification || '',
      })
    } catch (err) {
      setEditError(err?.message || 'Could not load content.')
      setEditingId(null)
    } finally {
      setEditBusy(false)
    }
  }

  const closeEditModal = () => {
    setEditingId(null)
    setEditForm(null)
    setEditNotice('')
    setEditError('')
  }

  const handleEditSave = async (e) => {
    e.preventDefault()
    setEditNotice('')
    setEditError('')
    setEditBusy(true)
    try {
      const payload = {
        title:       editForm.title.trim(),
        subtitle:    editForm.subtitle.trim(),
        desc:        editForm.desc.trim(),
        type:        editForm.type,
        genre:       editForm.genre.split(',').map((s) => s.trim()).filter(Boolean),
        cast:        editForm.cast.split(',').map((s) => s.trim()).filter(Boolean),
        director:    editForm.director.trim(),
        releaseYear: editForm.releaseYear ? Number(editForm.releaseYear) : null,
        rating:      editForm.rating      ? Number(editForm.rating)      : 0,
        isPremium:     editForm.isPremium,
        isFeatured:    editForm.isFeatured,
        badge:         editForm.badge.trim() || null,
        posterUrl:     editForm.posterUrl.trim(),
        backdropUrl:   editForm.backdropUrl.trim(),
        palette:       editForm.palette.trim(),
        reviewCount:   editForm.reviewCount ? Number(editForm.reviewCount) : 0,
        contentLanguage: editForm.contentLanguage || 'Bengali',
        certification: editForm.certification || null,
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

  const handleCreateCollection = async (e) => {
    e.preventDefault()
    setNotice('')
    setError('')
    setBusy(true)
    try {
      const created = await createAdminCollection({
        name: collectionName,
        bunnyCollectionId,
      })
      setCollections((prev) => [created, ...prev.filter((c) => c._id !== created._id)])
      setCollectionName('')
      setBunnyCollectionId('')
      setNotice('Collection mapping saved.')
    } catch (err) {
      setError(err?.message || 'Could not save collection.')
    } finally {
      setBusy(false)
    }
  }

  const handleUpload = async (e) => {
    e.preventDefault()
    if (!file) return setError('Please choose a video file.')
    if (!selectedCollectionId) return setError('Please select a mapped collection.')

    setNotice('')
    setError('')
    setBusy(true)
    try {
      const job = await createUploadJob({
        title,
        collectionId: selectedCollectionId,
        contentId: selectedContentId || null,
      })

      await uploadJobFile(job._id, file)
      setTitle('')
      setSelectedContentId('')
      setFile(null)
      setNotice('Upload accepted. Processing is running asynchronously.')
      await loadData()
    } catch (err) {
      setError(err?.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  const handleImportFromCdn = async () => {
    setNotice('')
    setError('')
    setBusy(true)
    try {
      const result = await importFromCdn()
      setNotice(result.imported > 0
        ? `Imported ${result.imported} new video${result.imported !== 1 ? 's' : ''} from CDN.`
        : 'No new videos found — all CDN videos are already in the library.')
      await loadData()
    } catch (err) {
      setError(err?.message || 'Could not import from CDN.')
    } finally {
      setBusy(false)
    }
  }

  const handleSyncBunnyCollections = async () => {
    setNotice('')
    setError('')
    setBusy(true)
    try {
      const result = await syncBunnyCollections()
      setNotice(`Synced ${result.imported} collections.`)
      await loadData()
    } catch (err) {
      setError(err?.message || 'Could not sync collections.')
    } finally {
      setBusy(false)
    }
  }

  const handleMapExisting = async (e) => {
    e.preventDefault()
    if (!mapContentId || !mapVideoId) {
      setError('Select both a content item and a stream video.')
      return
    }

    setNotice('')
    setError('')
    setBusy(true)
    try {
      const result = await mapExistingBunnyVideo({
        contentId: mapContentId,
        bunnyVideoId: mapVideoId,
      })
      setNotice(result.message || 'Stream video mapped successfully.')
      await loadData()
    } catch (err) {
      setError(err?.message || 'Could not map stream video.')
    } finally {
      setBusy(false)
    }
  }

  if (sessionLoading) {
    return <main className={styles.state}>Loading admin studio...</main>
  }

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

  return (
    <main className={styles.page}>
      {/* Upload completion toast */}
      {toast && (
        <div className={`${styles.toast} ${toast.type === 'error' ? styles.toastError : styles.toastSuccess}`}>
          {toast.type === 'success'
            ? <CheckCircle2 size={16} />
            : <XCircle      size={16} />
          }
          <span>{toast.message}</span>
          <button className={styles.toastClose} onClick={() => setToast(null)}>×</button>
        </div>
      )}

      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Admin Studio</h1>
          <p className={styles.titleSub}>Manage content, collections and uploads</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.refreshBtn} onClick={() => void loadData()}>
            <RefreshCw size={13} />
            Refresh
          </button>
          <button className={styles.refreshBtn} onClick={handleSyncBunnyCollections} disabled={busy}>
            <FolderPlus size={13} />
            Sync CDN
          </button>
          <button className={styles.importBtn} onClick={handleImportFromCdn} disabled={busy}>
            <UploadCloud size={13} />
            Import from CDN
          </button>
        </div>
      </header>

      {(notice || error) && (
        <div className={`${styles.message} ${error ? styles.error : styles.notice}`}>
          {error || notice}
        </div>
      )}

      <section className={styles.grid}>
        <article className={styles.card}>
          <h2 className={styles.cardTitle}>
            <FolderPlus size={16} />
            Collection Mapping
          </h2>
          <form className={styles.form} onSubmit={handleCreateCollection}>
            <label className={styles.label}>
              Dhara Collection Name
              <input
                className={styles.input}
                value={collectionName}
                onChange={(e) => setCollectionName(e.target.value)}
                placeholder="Bengali Classics"
                required
              />
            </label>

            <label className={styles.label}>
              CDN Collection ID
              <input
                className={styles.input}
                value={bunnyCollectionId}
                onChange={(e) => setBunnyCollectionId(e.target.value)}
                placeholder="Collection GUID"
                required
              />
            </label>

            <button className={styles.primaryBtn} type="submit" disabled={busy}>
              Save Collection
            </button>
          </form>
        </article>

        <article className={styles.card}>
          <h2 className={styles.cardTitle}>
            <UploadCloud size={16} />
            Upload Video
          </h2>
          <form className={styles.form} onSubmit={handleUpload}>
            <label className={styles.label}>
              Video Title
              <input
                className={styles.input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Movie title"
                required
              />
            </label>

            <label className={styles.label}>
              Collection
              <select
                className={styles.select}
                value={selectedCollectionId}
                onChange={(e) => setSelectedCollectionId(e.target.value)}
                required
              >
                <option value="">Select collection</option>
                {collections.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name} ({c.bunnyCollectionId})
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.label}>
              Existing Content (optional)
              <select
                className={styles.select}
                value={selectedContentId}
                onChange={(e) => setSelectedContentId(e.target.value)}
              >
                <option value="">Create upload without mapping to content</option>
                {contentItems.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.title} ({item.type})
                  </option>
                ))}
              </select>
            </label>

            <div className={styles.label}>
              Video File
              <div
                className={`${styles.dropZone} ${dragOver ? styles.dropZoneActive : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  const dropped = e.dataTransfer.files?.[0]
                  if (dropped) setFile(dropped)
                }}
              >
                <Film size={22} className={styles.dropZoneIcon} />
                {file ? (
                  <span className={styles.dropZoneFile}>{file.name}</span>
                ) : (
                  <>
                    <span className={styles.dropZoneText}>Drop video file here</span>
                    <span className={styles.dropZoneHint}>or click to browse · MP4, MOV, MKV</span>
                  </>
                )}
                <input
                  className={styles.fileInput}
                  type="file"
                  accept="video/*"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  required
                />
              </div>
            </div>

            <button className={styles.primaryBtn} type="submit" disabled={busy || !selectedCollection}>
              {busy ? 'Uploading...' : 'Start Async Upload'}
            </button>
          </form>
        </article>
      </section>

      <section className={styles.jobsCard}>
        <h2 className={styles.cardTitle}>
          <Link2 size={16} />
          Map Existing Video
        </h2>
        <form className={styles.form} onSubmit={handleMapExisting}>
          <label className={styles.label}>
            Stream Collection
            <select
              className={styles.select}
              value={mapCollectionId}
              onChange={(e) => {
                const val = e.target.value
                setMapCollectionId(val)
                setMapVideoId('')
                void loadBunnyVideos(val)
              }}
            >
              <option value="">Select collection</option>
              {bunnyCollections.map((c) => (
                <option key={c.guid} value={c.guid}>
                  {c.name} ({c.videoCount} videos)
                </option>
              ))}
            </select>
          </label>

          <label className={styles.label}>
            Stream Video
            <select
              className={styles.select}
              value={mapVideoId}
              onChange={(e) => setMapVideoId(e.target.value)}
              disabled={!mapCollectionId}
            >
              <option value="">Select video</option>
              {bunnyVideos.map((v) => (
                <option key={v.guid} value={v.guid}>
                  {v.title} ({Math.round((v.length || 0) / 60)} min)
                </option>
              ))}
            </select>
          </label>

          <label className={styles.label}>
            Dhara Content Item
            <select
              className={styles.select}
              value={mapContentId}
              onChange={(e) => setMapContentId(e.target.value)}
            >
              <option value="">Select Dhara content</option>
              {contentItems.map((item) => (
                <option key={item._id} value={item._id}>
                  {item.title} ({item.type})
                </option>
              ))}
            </select>
          </label>

          <button className={styles.primaryBtn} type="submit" disabled={busy || !mapVideoId || !mapContentId}>
            Map Existing Video
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
                <p className={styles.jobTitle}>{job.title}</p>
                <p className={styles.jobMeta}>
                  {job.collectionName || job.collectionId?.name || 'Unknown collection'}
                  {job.bunnyVideoId ? ` · ${job.bunnyVideoId}` : ''}
                </p>
              </div>
              <div className={styles.jobSide}>
                <span className={`${styles.statusBadge} ${statusClass[job.status] || ''}`}>
                  {job.status}
                </span>
                <span className={styles.progress}>{job.progress || 0}%</span>
              </div>
              <p className={styles.jobNote}>{job.error || job.note || 'Pending update...'}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Content Library ───────────────────────────────────────────────── */}
      <section className={styles.jobsCard}>
        <div className={styles.libraryHeader}>
          <h2 className={styles.cardTitle}>
            <Library size={16} />
            Content Library
          </h2>
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
                  {item.isPremium ? ' · PRO' : ''}
                  {item.bunnyVideoId ? '' : ' · No stream'}
                </p>
              </div>
              <button
                className={styles.editBtn}
                onClick={() => openEditModal(item)}
                disabled={editBusy && editingId === item._id}
              >
                <Pencil size={12} />
                Edit
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ── Edit metadata modal ───────────────────────────────────────────── */}
      {editingId && (
        <div className={styles.modalBackdrop} onClick={(e) => e.target === e.currentTarget && closeEditModal()}>
          <div className={styles.modalPanel} role="dialog" aria-modal="true" aria-label="Edit metadata">
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>
                <Pencil size={14} />
                Edit Metadata
              </h2>
              <button className={styles.modalClose} onClick={closeEditModal} aria-label="Close">
                <X size={16} />
              </button>
            </div>

            {editBusy && !editForm && (
              <p className={styles.empty}>Loading…</p>
            )}

            {editNotice && <p className={`${styles.message} ${styles.notice}`}>{editNotice}</p>}
            {editError  && <p className={`${styles.message} ${styles.error}`}>{editError}</p>}

            {editForm && (
              <form ref={modalFormRef} className={styles.modalForm} onSubmit={handleEditSave}>
                <div className={styles.modalGrid}>
                  {/* Title */}
                  <label className={`${styles.label} ${styles.spanFull}`}>
                    Title *
                    <input className={styles.input} value={editForm.title} onChange={ef('title')} required />
                  </label>

                  {/* Subtitle */}
                  <label className={styles.label}>
                    Subtitle / Tagline
                    <input className={styles.input} value={editForm.subtitle} onChange={ef('subtitle')} placeholder="e.g. একটি রহস্য কাহিনী" />
                  </label>

                  {/* Type */}
                  <label className={styles.label}>
                    Type
                    <select className={styles.select} value={editForm.type} onChange={ef('type')}>
                      <option value="Film">Film</option>
                      <option value="Series">Series</option>
                    </select>
                  </label>

                  {/* Language */}
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

                  {/* Certification */}
                  <label className={styles.label}>
                    Certification (CBFC)
                    <select className={styles.select} value={editForm.certification || ''} onChange={ef('certification')}>
                      <option value="">— Select —</option>
                      <option value="U">U — Universal</option>
                      <option value="UA">UA — Parental Guidance</option>
                      <option value="A">A — Adults Only</option>
                    </select>
                  </label>

                  {/* Genre */}
                  <label className={styles.label}>
                    <span>Genre <span className={styles.labelHint}>(comma-separated)</span></span>
                    <input className={styles.input} value={editForm.genre} onChange={ef('genre')}
                      placeholder="Drama, Thriller, Romance" />
                    <div className={styles.quickTags}>
                      {['Drama','Thriller','Romance','Crime','Comedy','Historical','Family','Supernatural','Action','Social'].map((g) => (
                        <button key={g} type="button" className={styles.quickTag}
                          onClick={() => {
                            const existing = editForm.genre.split(',').map((s) => s.trim()).filter(Boolean)
                            if (!existing.includes(g)) {
                              setEditForm((prev) => ({ ...prev, genre: [...existing, g].join(', ') }))
                            }
                          }}>
                          {g}
                        </button>
                      ))}
                    </div>
                  </label>

                  {/* Director */}
                  <label className={styles.label}>
                    Director
                    <input className={styles.input} value={editForm.director} onChange={ef('director')} placeholder="পরিচালকের নাম" />
                  </label>

                  {/* Cast */}
                  <label className={`${styles.label} ${styles.spanFull}`}>
                    <span>Cast <span className={styles.labelHint}>(comma-separated)</span></span>
                    <input className={styles.input} value={editForm.cast} onChange={ef('cast')}
                      placeholder="Prosenjit Chatterjee, Rituparna Sengupta" />
                  </label>

                  {/* Release Year */}
                  <label className={styles.label}>
                    Release Year
                    <input className={styles.input} type="number" min="1900" max="2099"
                      value={editForm.releaseYear} onChange={ef('releaseYear')} placeholder="2024" />
                  </label>

                  {/* Rating */}
                  <label className={styles.label}>
                    <span>Rating <span className={styles.labelHint}>(0–5)</span></span>
                    <input className={styles.input} type="number" min="0" max="5" step="0.1"
                      value={editForm.rating} onChange={ef('rating')} placeholder="4.2" />
                  </label>

                  {/* Review Count */}
                  <label className={styles.label}>
                    Review Count
                    <input className={styles.input} type="number" min="0"
                      value={editForm.reviewCount} onChange={ef('reviewCount')} placeholder="12400" />
                  </label>

                  {/* Badge */}
                  <label className={styles.label}>
                    Badge
                    <input className={styles.input} value={editForm.badge} onChange={ef('badge')} placeholder="NEW / EXCLUSIVE" />
                  </label>

                  {/* ── Images ── */}
                  <div className={`${styles.imagesSection} ${styles.spanFull}`}>
                    <p className={styles.imagesSectionTitle}>
                      <ImagePlus size={13} /> Images
                    </p>
                    <div className={styles.imageGrid}>

                      {/* Poster */}
                      <div className={styles.imageSlot}>
                        <p className={styles.imageSlotLabel}>Poster <span className={styles.labelHint}>2:3 portrait · cards &amp; modal</span></p>
                        <div className={styles.imagePreviewWrap}>
                          {editForm.posterUrl
                            ? <img src={editForm.posterUrl} className={styles.imagePreview} alt="Poster preview" />
                            : <div className={styles.imageEmpty}><ImagePlus size={22} opacity={0.3} /><span>No image</span></div>
                          }
                        </div>
                        <label className={styles.imageUploadBtn}>
                          {imgUploading.poster
                            ? `Uploading… ${imgProgress.poster}%`
                            : 'Upload Poster'}
                          <input
                            type="file" accept="image/*" className={styles.fileInputHidden}
                            disabled={imgUploading.poster}
                            onChange={(e) => handleImageUpload('posterUrl', e.target.files?.[0])}
                          />
                        </label>
                        <input
                          className={styles.input} value={editForm.posterUrl} onChange={ef('posterUrl')}
                          placeholder="Or paste Cloudinary URL…"
                        />
                      </div>

                      {/* Backdrop */}
                      <div className={styles.imageSlot}>
                        <p className={styles.imageSlotLabel}>Backdrop <span className={styles.labelHint}>16:9 landscape · hero &amp; featured</span></p>
                        <div className={styles.imagePreviewWrap}>
                          {editForm.backdropUrl
                            ? <img src={editForm.backdropUrl} className={styles.imagePreview} alt="Backdrop preview" />
                            : <div className={styles.imageEmpty}><ImagePlus size={22} opacity={0.3} /><span>No image</span></div>
                          }
                        </div>
                        <label className={styles.imageUploadBtn}>
                          {imgUploading.backdrop
                            ? `Uploading… ${imgProgress.backdrop}%`
                            : 'Upload Backdrop'}
                          <input
                            type="file" accept="image/*" className={styles.fileInputHidden}
                            disabled={imgUploading.backdrop}
                            onChange={(e) => handleImageUpload('backdropUrl', e.target.files?.[0])}
                          />
                        </label>
                        <input
                          className={styles.input} value={editForm.backdropUrl} onChange={ef('backdropUrl')}
                          placeholder="Or paste Cloudinary URL…"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Bunny Stream (read-only) */}
                  {editForm.bunnyVideoId && (
                    <div className={`${styles.label} ${styles.spanFull}`}>
                      Stream Video ID
                      <div className={styles.readonlyField}>
                        <span>{editForm.bunnyVideoId}</span>
                        <span className={styles.readonlyNote}>Bunny Stream · linked via Upload or Map</span>
                      </div>
                    </div>
                  )}

                  {/* Synopsis */}
                  <label className={`${styles.label} ${styles.spanFull}`}>
                    Synopsis / Description
                    <textarea className={`${styles.input} ${styles.textarea}`}
                      value={editForm.desc} onChange={ef('desc')} rows={4}
                      placeholder="গল্পের সারসংক্ষেপ লিখুন…" />
                  </label>

                  {/* Toggles */}
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
                </div>

                <div className={styles.modalFooter}>
                  <button type="button" className={styles.ghostBtn} onClick={closeEditModal}>Cancel</button>
                  <button type="submit" className={styles.primaryBtn} disabled={editBusy}>
                    {editBusy ? 'Saving…' : 'Save Metadata'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
