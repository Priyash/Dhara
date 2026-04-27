import { useRef, useCallback } from 'react'

function requestNotificationPermission() {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

function sendBrowserNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try {
    new Notification(title, { body, icon: '/favicon.ico' })
  } catch { /* noop */ }
}

export function useUploadNotifier(onToast) {
  const prevStatuses = useRef({}) // { [jobId]: status }

  // Call once on mount to request browser notification permission
  const requestPermission = useCallback(() => {
    requestNotificationPermission()
  }, [])

  // Call after every poll with the latest jobs array
  const checkTransitions = useCallback((jobs) => {
    jobs.forEach((job) => {
      const prev = prevStatuses.current[job._id]
      const curr = job.status

      if (prev && prev !== curr) {
        if (curr === 'ready') {
          const msg = `"${job.title}" is ready to stream.`
          onToast?.({ type: 'success', message: msg })
          if (document.hidden) sendBrowserNotification('Upload complete ✓', msg)
        }
        if (curr === 'failed') {
          const msg = `"${job.title}" upload failed. ${job.error || ''}`
          onToast?.({ type: 'error', message: msg })
          if (document.hidden) sendBrowserNotification('Upload failed', msg)
        }
      }

      prevStatuses.current[job._id] = curr
    })
  }, [onToast])

  return { requestPermission, checkTransitions }
}
