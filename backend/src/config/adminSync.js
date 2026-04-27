/**
 * On startup, read ADMIN_EMAILS and ensure every listed user has
 * admin: true custom claim in Firebase Auth.
 * Users not in the list are NOT touched — revoke manually via setAdminClaim.js.
 */
import { admin } from './firebase.js'

export async function syncAdminClaims() {
  const emails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

  if (emails.length === 0) return

  const results = await Promise.allSettled(
    emails.map(async (email) => {
      const user = await admin.auth().getUserByEmail(email)
      if (user.customClaims?.admin === true) {
        console.log(`[admin] ${email} — claim already set`)
        return
      }
      await admin.auth().setCustomUserClaims(user.uid, {
        ...(user.customClaims || {}),
        admin: true,
      })
      console.log(`[admin] ${email} — admin claim granted`)
    })
  )

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.warn(`[admin] ${emails[i]} — skipped: ${r.reason?.message}`)
    }
  })
}
