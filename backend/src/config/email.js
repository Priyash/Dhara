/**
 * email.js — thin wrapper around the Resend REST API.
 *
 * Why Resend? No npm dependency needed — a single fetch call.
 * Free tier: 3,000 emails/month, 100/day. More than enough for creator notifications.
 *
 * Setup:
 *   1. Create a free account at resend.com
 *   2. Add RESEND_API_KEY to your Render env vars
 *   3. Add RESEND_FROM to your Render env vars (e.g. "ধারা <noreply@yourdomain.com>")
 *      — must be a verified sender domain in Resend
 *
 * If RESEND_API_KEY is not set, sendEmail() logs a warning and returns without throwing
 * so that missing config never crashes the server.
 */

const RESEND_API = 'https://api.resend.com/emails'

/**
 * @param {{ to: string, subject: string, html: string }} opts
 */
export async function sendEmail({ to, subject, html }) {
  const key  = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM || 'ধারা <noreply@dhara.stream>'

  if (!key) {
    console.warn('[email] RESEND_API_KEY not set — skipping email to', to)
    return
  }

  try {
    const res = await fetch(RESEND_API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from, to, subject, html }),
    })
    if (!res.ok) {
      const err = await res.text().catch(() => res.status)
      console.error('[email] Resend error:', err)
    }
  } catch (err) {
    console.error('[email] fetch failed:', err.message)
  }
}

// ── Pre-built templates ───────────────────────────────────────────────────────

export function emailCreatorApproved(studioName, email) {
  return sendEmail({
    to:      email,
    subject: 'Your creator application was approved — ধারা',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
        <h2 style="color:#7c3aed">ধারা Creator Studio</h2>
        <p>Hi <strong>${studioName}</strong>,</p>
        <p>🎉 Great news — your creator application has been <strong>approved</strong>!</p>
        <p>You can now log in to <a href="https://dhara.stream/creator-studio" style="color:#7c3aed">Creator Studio</a>
           and submit your first film, series, or documentary for review.</p>
        <p style="margin-top:32px;font-size:13px;color:#888">
          — The ধারা team
        </p>
      </div>
    `,
  })
}

export function emailCreatorRejected(studioName, email, reason) {
  return sendEmail({
    to:      email,
    subject: 'Update on your creator application — ধারা',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
        <h2 style="color:#7c3aed">ধারা Creator Studio</h2>
        <p>Hi <strong>${studioName}</strong>,</p>
        <p>Thank you for applying to become a creator on ধারা.</p>
        <p>After reviewing your application, we're unable to approve it at this time.</p>
        ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
        <p>You're welcome to improve your submission and apply again.</p>
        <p style="margin-top:32px;font-size:13px;color:#888">
          — The ধারা team
        </p>
      </div>
    `,
  })
}

export function emailSubmissionApproved(studioName, email, contentTitle) {
  return sendEmail({
    to:      email,
    subject: `"${contentTitle}" is now live on ধারা`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
        <h2 style="color:#7c3aed">ধারা Creator Studio</h2>
        <p>Hi <strong>${studioName}</strong>,</p>
        <p>🎬 Your title <strong>"${contentTitle}"</strong> has been reviewed and approved.
           It is now <strong>live</strong> on ধারা for all subscribers to watch!</p>
        <p>Check your <a href="https://dhara.stream/creator-studio" style="color:#7c3aed">Creator Studio</a>
           for views and engagement data.</p>
        <p style="margin-top:32px;font-size:13px;color:#888">
          — The ধারা team
        </p>
      </div>
    `,
  })
}

export function emailSubmissionRejected(studioName, email, contentTitle, reason) {
  return sendEmail({
    to:      email,
    subject: `Update on "${contentTitle}" — ধারা`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
        <h2 style="color:#7c3aed">ধারা Creator Studio</h2>
        <p>Hi <strong>${studioName}</strong>,</p>
        <p>We've reviewed <strong>"${contentTitle}"</strong> and unfortunately cannot approve it in its current form.</p>
        ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
        <p>You can edit your submission and resubmit from
           <a href="https://dhara.stream/creator-studio" style="color:#7c3aed">Creator Studio</a>.</p>
        <p style="margin-top:32px;font-size:13px;color:#888">
          — The ধারা team
        </p>
      </div>
    `,
  })
}

export function emailTierAdvancement(studioName, email, prevTier, newTier, revenueSharePct) {
  return sendEmail({
    to:      email,
    subject: `You've reached ${newTier} tier — ধারা`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
        <h2 style="color:#7c3aed">ধারা Creator Studio</h2>
        <p>Hi <strong>${studioName}</strong>,</p>
        <p>🎉 Congratulations! You've advanced from <strong>${prevTier}</strong> to the
           <strong>${newTier}</strong> tier.</p>
        <p>Your revenue share has increased to <strong>${revenueSharePct}%</strong> on all future earnings.</p>
        <p>Keep creating great content to continue growing on ধারা!</p>
        <p>
          <a href="https://dhara.stream/creator-studio" style="color:#7c3aed">View your Creator Studio →</a>
        </p>
        <p style="margin-top:32px;font-size:13px;color:#888">
          — The ধারা team
        </p>
      </div>
    `,
  })
}

export function emailSubscriptionRenewalReminder(displayName, email, expiresAt, plan) {
  const expiryStr = new Date(expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  return sendEmail({
    to:      email,
    subject: 'Your ধারা subscription expires in 3 days',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
        <h2 style="color:#7c3aed">ধারা</h2>
        <p>Hi <strong>${displayName}</strong>,</p>
        <p>Your <strong>${plan}</strong> subscription expires on <strong>${expiryStr}</strong>.</p>
        <p>To continue enjoying unlimited Bengali cinema, series &amp; documentaries without interruption,
           please renew before it lapses.</p>
        <p>
          <a href="https://dhara.stream/profile" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">
            Renew Subscription
          </a>
        </p>
        <p style="margin-top:32px;font-size:13px;color:#888">
          — The ধারা team
        </p>
      </div>
    `,
  })
}
