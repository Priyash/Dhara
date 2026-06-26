/**
 * RazorpayX payout adapter — automates creator bank/UPI payouts via the
 * Contacts → Fund Accounts → Payouts flow. The installed `razorpay` npm SDK
 * doesn't expose these RazorpayX-only resources, so this calls the REST API
 * directly (same pattern as services/bunnyUpload.js's bunnyRequest).
 *
 * Dormant by design: isPayoutConfigured() returns false until a real
 * RAZORPAY_X_ACCOUNT_NUMBER is set, and every caller must check it first and
 * fall back to the existing manual admin payout flow when it's false.
 */

const BASE_URL = 'https://api.razorpay.com/v1'

export function isPayoutConfigured() {
  return Boolean(
    process.env.RAZORPAY_KEY_ID &&
    process.env.RAZORPAY_KEY_SECRET &&
    process.env.RAZORPAY_X_ACCOUNT_NUMBER
  )
}

async function rxRequest(path, { method = 'GET', body } = {}) {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }

  if (!res.ok) {
    throw new Error(typeof data === 'string' ? data : data?.error?.description || `RazorpayX API HTTP ${res.status}`)
  }
  return data
}

/** Creates a RazorpayX contact representing a creator (idempotent — safe to call once per creator). */
export async function createContact({ name, email, referenceId }) {
  return rxRequest('/contacts', {
    method: 'POST',
    body: { name, email, type: 'vendor', reference_id: referenceId },
  })
}

/** Links a bank account or UPI VPA to a contact, returning a fund_account id. */
export async function createFundAccount({ contactId, method, accountHolderName, accountNumber, ifsc, upiId }) {
  if (method === 'upi') {
    return rxRequest('/fund_accounts', {
      method: 'POST',
      body: {
        contact_id: contactId,
        account_type: 'vpa',
        vpa: { address: upiId },
      },
    })
  }
  return rxRequest('/fund_accounts', {
    method: 'POST',
    body: {
      contact_id: contactId,
      account_type: 'bank_account',
      bank_account: { name: accountHolderName, ifsc, account_number: accountNumber },
    },
  })
}

/** Issues a payout from the configured RazorpayX current account to a fund account. */
export async function createPayout({ fundAccountId, amountPaise, mode, referenceId, narration }) {
  return rxRequest('/payouts', {
    method: 'POST',
    body: {
      account_number: process.env.RAZORPAY_X_ACCOUNT_NUMBER,
      fund_account_id: fundAccountId,
      amount: amountPaise,
      currency: 'INR',
      mode: mode || 'IMPS',
      purpose: 'payout',
      queue_if_low_balance: true,
      reference_id: referenceId,
      narration,
    },
  })
}

export async function fetchPayout(payoutId) {
  return rxRequest(`/payouts/${payoutId}`)
}
