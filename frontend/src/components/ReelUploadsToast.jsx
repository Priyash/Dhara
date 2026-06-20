import { useStore } from '../store/useStore'
import styles from './ReelUploadsToast.module.css'

function statusLabel(u) {
  if (u.status === 'done')      return 'Submitted for review'
  if (u.status === 'error')     return u.error || 'Upload failed'
  if (u.status === 'cancelled') return 'Cancelled'
  if (u.progress >= 100)        return 'Processing…'
  return `${u.progress ?? 0}% uploading…`
}

function barClass(u) {
  if (u.status === 'done')      return styles.barDone
  if (u.status === 'error')     return styles.barError
  if (u.status === 'cancelled') return styles.barCancelled
  return styles.barActive
}

export default function ReelUploadsToast() {
  const activeUploads    = useStore((s) => s.activeUploads)
  const patchActiveUpload  = useStore((s) => s.patchActiveUpload)
  const removeActiveUpload = useStore((s) => s.removeActiveUpload)

  const reelUploads = activeUploads.filter((u) => u.type === 'reel')
  if (!reelUploads.length) return null

  const handleCancel = (u) => {
    u.xhr?.abort()
    patchActiveUpload(u.uid, { status: 'cancelled', xhr: null })
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>Reel uploads</div>
      {reelUploads.map((u) => {
        const isDone      = u.status === 'done'
        const isTerminal  = u.status === 'done' || u.status === 'error' || u.status === 'cancelled'
        const progress    = Math.min(100, Math.max(0, u.progress ?? 0))

        return (
          <div key={u.uid} className={styles.item}>
            <div className={styles.itemTop}>
              <span className={styles.title} title={u.title}>{u.title || 'Reel'}</span>
              {isTerminal
                ? <button className={styles.dismissBtn} onClick={() => removeActiveUpload(u.uid)} aria-label="Dismiss">✕</button>
                : <button className={styles.cancelBtn} onClick={() => handleCancel(u)} aria-label="Cancel upload">✕</button>
              }
            </div>
            <div className={styles.trackWrap}>
              <div className={styles.track}>
                <div className={`${styles.bar} ${barClass(u)}`} style={{ width: `${isTerminal ? 100 : progress}%` }} />
              </div>
            </div>
            <div className={`${styles.statusText} ${isDone ? styles.statusDone : u.status === 'error' ? styles.statusError : ''}`}>
              {statusLabel(u)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
