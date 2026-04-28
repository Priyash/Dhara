import { useState, useEffect, useCallback } from 'react'
import { X, Crown, Check, Loader } from 'lucide-react'
import { useStore } from '../store/useStore'
import { PLANS, PLAN_FEATURES } from '../data/content'
import { createOrder, verifyPayment } from '../services/api'
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

export default function PaywallModal() {
  const [selected, setSelected] = useState('annual')
  const [stage, setStage]       = useState(STAGE.IDLE)
  const [errorMsg, setErrorMsg] = useState('')
  const { setShowPaywall, refreshProfile } = useStore()

  // Pre-load Razorpay script the moment the modal mounts
  useEffect(() => { loadRazorpayScript() }, [])

  const handleSubscribe = useCallback(async () => {
    setStage(STAGE.LOADING)
    setErrorMsg('')

    try {
      const scriptLoaded = await loadRazorpayScript()
      if (!scriptLoaded) throw new Error('Payment service could not be loaded. Please try again.')

      // Create a Razorpay order on the backend
      const order = await createOrder(selected)
      setStage(STAGE.CHECKOUT)

      await new Promise((resolve, reject) => {
        const rzp = new window.Razorpay({
          key:         order.keyId,
          amount:      order.amount,
          currency:    order.currency,
          order_id:    order.orderId,
          name:        'ধারা',
          description: `${selected.charAt(0).toUpperCase() + selected.slice(1)} Plan`,
          theme:       { color: '#f59e0b' },
          modal: {
            ondismiss: () => reject(new Error('dismissed')),
          },
          handler: async (response) => {
            try {
              setStage(STAGE.VERIFYING)
              // Backend verifies HMAC + fetches order from Razorpay to confirm
              // amount, status, and user ownership before activating subscription
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
    } catch (err) {
      if (err.message === 'dismissed') {
        setStage(STAGE.IDLE)
      } else {
        setErrorMsg(err.message || 'Something went wrong. Please try again.')
        setStage(STAGE.ERROR)
      }
    }
  }, [selected, refreshProfile, setShowPaywall])

  const busy = [STAGE.LOADING, STAGE.CHECKOUT, STAGE.VERIFYING].includes(stage)

  const ctaLabel = {
    [STAGE.IDLE]:      'Start Watching Now',
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
          ) : (
            <>
              <div className={styles.eyebrow}>
                <Crown size={16} color="#f59e0b" />
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
            {/* Plan cards stagger in via CSS animation-delay on --stagger */}
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
                      <p className={styles.planLabel}>{plan.label}</p>
                      <p className={styles.planSub}>{plan.sub}</p>
                    </div>
                  </div>
                  <div className={styles.planRight}>
                    {plan.badge && <span className={styles.planBadge}>{plan.badge}</span>}
                    <span className={styles.planPrice}>{plan.price}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Features */}
            <div className={styles.features}>
              {PLAN_FEATURES.map((f) => (
                <div key={f} className={styles.feature}>
                  <Check size={13} color="var(--color-accent)" />
                  <span>{f}</span>
                </div>
              ))}
            </div>

            {/* Error message */}
            {stage === STAGE.ERROR && errorMsg && (
              <p className={styles.errorMsg}>{errorMsg}</p>
            )}

            {/* CTA */}
            <button
              className={`${styles.cta} ${busy ? styles.ctaBusy : ''} ${stage === STAGE.ERROR ? styles.ctaError : ''}`}
              onClick={handleSubscribe}
              disabled={busy}
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
