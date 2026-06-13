import { useState, useEffect, useCallback, useMemo } from 'react'
import { X, Crown, Check, Loader, Clock, AlertCircle } from 'lucide-react'
import { useStore } from '../store/useStore'
import { PLANS } from '../data/content'
import { createOrder, verifyPayment, createSubscription, verifySubscription } from '../services/api'
import styles from './PaywallModal.module.css'

function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true)
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

// Payment stage machine: idle → loading → checkout → verifying → success | error
const STAGE = {
  IDLE:      'idle',
  LOADING:   'loading',
  CHECKOUT:  'checkout',
  VERIFYING: 'verifying',
  SUCCESS:   'success',
  ERROR:     'error',
}

// Monthly plan uses recurring subscription; annual/family use one-time orders.
const RECURRING_PLANS = new Set(['monthly'])

export default function PaywallModal() {
  const { setShowPaywall, refreshProfile, subscriptionStatus, subscriptionPlan, subscriptionExpiresAt, trialEndsAt, graceEndsAt, user } = useStore()

  const currentPlan   = subscriptionPlan ?? user?.subscriptionPlan ?? null
  const isSubscribed  = subscriptionStatus === 'active'
  const isOnTrial     = subscriptionStatus === 'trial'
  const isOnGrace     = subscriptionStatus === 'grace'

  const defaultPlan = useMemo(() => {
    if (isSubscribed && currentPlan) return currentPlan
    return 'annual'
  }, [isSubscribed, currentPlan])

  const [selected, setSelected] = useState(defaultPlan)
  const [stage, setStage]       = useState(STAGE.IDLE)
  const [errorMsg, setErrorMsg] = useState('')

  // Pre-load Razorpay script the moment the modal mounts
  useEffect(() => { loadRazorpayScript() }, [])

  const trialDaysLeft = useMemo(() => {
    if (!isOnTrial || !trialEndsAt) return 0
    const diff = new Date(trialEndsAt).getTime() - Date.now()
    return Math.max(0, Math.ceil(diff / 86_400_000))
  }, [isOnTrial, trialEndsAt])

  // Prevent re-purchasing the plan the user is already on
  const isSamePlan = isSubscribed && selected === currentPlan

  const handleSubscribe = useCallback(async () => {
    setStage(STAGE.LOADING)
    setErrorMsg('')

    try {
      const scriptLoaded = await loadRazorpayScript()
      if (!scriptLoaded) throw new Error('Payment service could not be loaded. Please try again.')

      setStage(STAGE.CHECKOUT)

      if (RECURRING_PLANS.has(selected)) {
        // ── Recurring subscription checkout (monthly) ─────────────────────
        // Falls back to one-time order if plan ID isn't configured on the backend.
        let sub = null
        try {
          sub = await createSubscription(selected)
        } catch (err) {
          if (!err.message?.includes('not configured')) throw err
          // Recurring billing not set up — fall through to one-time order below
        }

        if (sub) {
          await new Promise((resolve, reject) => {
            const rzp = new window.Razorpay({
              key:             sub.keyId,
              subscription_id: sub.subscriptionId,
              name:            'ধারা',
              description:     'Monthly Plan — auto-renews every month',
              theme:           { color: '#4f46e5' },
              modal: {
                ondismiss: () => reject(new Error('dismissed')),
              },
              handler: async (response) => {
                try {
                  setStage(STAGE.VERIFYING)
                  await verifySubscription({
                    razorpay_payment_id:      response.razorpay_payment_id,
                    razorpay_subscription_id: response.razorpay_subscription_id,
                    razorpay_signature:       response.razorpay_signature,
                    plan:                     selected,
                  })
                  await refreshProfile()
                  setStage(STAGE.SUCCESS)
                  setTimeout(() => setShowPaywall(false), 1800)
                  resolve()
                } catch (err) {
                  reject(err)
                }
              },
            })
            rzp.open()
          })
          return  // done — skip the one-time order block below
        }
        // Fall through to one-time order when recurring isn't configured
      }

      {
        // ── One-time order checkout (annual / family) ─────────────────────
        const order = await createOrder(selected)

        await new Promise((resolve, reject) => {
          const rzp = new window.Razorpay({
            key:         order.keyId,
            amount:      order.amount,
            currency:    order.currency,
            order_id:    order.orderId,
            name:        'ধারা',
            description: `${selected.charAt(0).toUpperCase() + selected.slice(1)} Plan`,
            theme:       { color: '#4f46e5' },
            modal: {
              ondismiss: () => reject(new Error('dismissed')),
            },
            handler: async (response) => {
              try {
                setStage(STAGE.VERIFYING)
                await verifyPayment({
                  razorpay_order_id:   response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature:  response.razorpay_signature,
                  plan:                selected,
                })
                await refreshProfile()
                setStage(STAGE.SUCCESS)
                setTimeout(() => setShowPaywall(false), 1800)
                resolve()
              } catch (err) {
                reject(err)
              }
            },
          })
          rzp.open()
        })
      }
    } catch (err) {
      if (err.message === 'dismissed') {
        setStage(STAGE.IDLE)
        setErrorMsg('')
      } else {
        setErrorMsg(err.message || 'Something went wrong. Please try again.')
        setStage(STAGE.ERROR)
      }
    }
  }, [selected, refreshProfile, setShowPaywall])

  const busy = [STAGE.LOADING, STAGE.CHECKOUT, STAGE.VERIFYING].includes(stage)

  const idleLabel = isSamePlan
    ? 'Current Plan'
    : isSubscribed
      ? 'Switch to This Plan'
      : 'Start Watching Now'

  const ctaLabel = {
    [STAGE.IDLE]:      idleLabel,
    [STAGE.LOADING]:   'Preparing…',
    [STAGE.CHECKOUT]:  'Complete Payment',
    [STAGE.VERIFYING]: 'Confirming…',
    [STAGE.SUCCESS]:   "You're in!",
    [STAGE.ERROR]:     'Try Again',
  }[stage]

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Subscribe to Dhara">
      <div className={`${styles.modal} ${stage === STAGE.SUCCESS ? styles.modalSuccess : ''}`}>

        {/* Header */}
        <div className={styles.header}>
          {stage !== STAGE.SUCCESS && (
            <button
              className={styles.closeBtn}
              onClick={() => setShowPaywall(false)}
              aria-label="Close"
              disabled={busy}
            >
              <X size={16} />
            </button>
          )}

          {stage === STAGE.SUCCESS ? (
            <div className={styles.successHeader}>
              <div className={styles.successIcon}>✓</div>
              <h2 className={styles.heading}>আপনাকে স্বাগতম</h2>
              <p className={styles.sub}>Your subscription is now active. Enjoy!</p>
            </div>
          ) : isOnGrace ? (
            <>
              <div className={styles.eyebrow}>
                <AlertCircle size={16} color="#f87171" />
                <span style={{ color: '#f87171' }}>Payment Issue</span>
              </div>
              <h2 className={styles.heading}>Renew Your Access</h2>
              <p className={styles.sub}>
                {graceEndsAt
                  ? `Your last payment failed. Access continues until ${new Date(graceEndsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} — renew now.`
                  : 'Your last payment failed. Pick a plan below to restore access.'}
              </p>
            </>
          ) : isSubscribed ? (
            <>
              <div className={styles.eyebrow}>
                <Crown size={16} color="#4f46e5" />
                <span>Manage Plan</span>
              </div>
              <h2 className={styles.heading}>Change Your Plan</h2>
              <p className={styles.sub}>
                {subscriptionExpiresAt
                  ? `Current plan renews on ${new Date(subscriptionExpiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · Switch anytime`
                  : 'Select a different plan to switch — your new period starts immediately'}
              </p>
            </>
          ) : isOnTrial ? (
            <>
              <div className={styles.eyebrow}>
                <Clock size={16} color="#4f46e5" />
                <span>Free Trial Active</span>
              </div>
              <h2 className={styles.heading}>
                {trialDaysLeft > 0
                  ? `${trialDaysLeft} day${trialDaysLeft !== 1 ? 's' : ''} left in your trial`
                  : 'Your trial has ended'}
              </h2>
              <p className={styles.sub}>Subscribe now to keep watching unlimited Bengali content</p>
            </>
          ) : (
            <>
              <div className={styles.eyebrow}>
                <Crown size={16} color="#4f46e5" />
                <span>Upgrade to Pro</span>
              </div>
              <h2 className={styles.heading}>Unlock All Content</h2>
              <p className={styles.sub}>Unlimited Bengali cinema, series & originals</p>
            </>
          )}
        </div>

        {/* Body — hidden on success so the celebration header fills the card */}
        {stage !== STAGE.SUCCESS && (
          <div className={styles.body}>
            {/* Plan cards */}
            <div className={styles.plans}>
              {PLANS.map((plan, i) => (
                <button
                  key={plan.id}
                  className={`${styles.plan} ${selected === plan.id ? styles.planSelected : ''}`}
                  style={{ '--stagger': i }}
                  onClick={() => !busy && setSelected(plan.id)}
                  aria-pressed={selected === plan.id}
                  disabled={busy}
                >
                  <div className={styles.planLeft}>
                    <div className={`${styles.radio} ${selected === plan.id ? styles.radioSelected : ''}`}>
                      {selected === plan.id && <div className={styles.radioDot} />}
                    </div>
                    <div>
                      <p className={styles.planLabel}>
                        {plan.label}
                        {plan.id === 'monthly' && (
                          <span className={styles.planRecurring}> · auto-renews</span>
                        )}
                      </p>
                      <p className={styles.planSub}>{plan.priceNote}</p>
                    </div>
                  </div>
                  <div className={styles.planRight}>
                    {isSubscribed && plan.id === currentPlan
                      ? <span className={styles.planCurrent}>Current</span>
                      : plan.badge && <span className={styles.planBadge}>{plan.badge}</span>
                    }
                    <span className={styles.planPrice}>{plan.price}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Per-plan feature list — updates when selection changes */}
            {(() => {
              const activePlan = PLANS.find((p) => p.id === selected)
              return activePlan ? (
                <div className={styles.features} key={selected}>
                  {activePlan.features.map((f) => (
                    <div key={f} className={styles.feature}>
                      <Check size={13} color="var(--color-accent)" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              ) : null
            })()}

            {/* Error message */}
            {stage === STAGE.ERROR && errorMsg && (
              <p className={styles.errorMsg}>{errorMsg}</p>
            )}

            {/* CTA */}
            <button
              className={`${styles.cta} ${busy || isSamePlan ? styles.ctaBusy : ''} ${stage === STAGE.ERROR ? styles.ctaError : ''}`}
              onClick={handleSubscribe}
              disabled={busy || isSamePlan}
            >
              {busy && <Loader size={15} className={styles.spinner} />}
              {ctaLabel}
            </button>
            <p className={styles.fine}>Cancel anytime · Secured payment · No hidden charges</p>
          </div>
        )}
      </div>
    </div>
  )
}
