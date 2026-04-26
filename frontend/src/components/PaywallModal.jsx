import { useState } from 'react'
import { X, Crown, Check } from 'lucide-react'
import { useStore } from '../store/useStore'
import { PLANS, PLAN_FEATURES } from '../data/content'
import styles from './PaywallModal.module.css'

export default function PaywallModal() {
  const [selected, setSelected] = useState('annual')
  const { setShowPaywall } = useStore()

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Subscribe to Dhara">
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <button
            className={styles.closeBtn}
            onClick={() => setShowPaywall(false)}
            aria-label="Close"
          >
            <X size={16} />
          </button>

          <div className={styles.eyebrow}>
            <Crown size={16} color="#f59e0b" />
            <span>Upgrade to Pro</span>
          </div>
          <h2 className={styles.heading}>Unlock All Content</h2>
          <p className={styles.sub}>Stream thousands of Bengali movies, web series & originals</p>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {/* Plans */}
          <div className={styles.plans}>
            {PLANS.map((plan) => (
              <button
                key={plan.id}
                className={`${styles.plan} ${selected === plan.id ? styles.planSelected : ''}`}
                onClick={() => setSelected(plan.id)}
                aria-pressed={selected === plan.id}
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

          {/* CTA */}
          <button className={styles.cta}>Start Watching Now</button>
          <p className={styles.fine}>Cancel anytime. No hidden charges.</p>
        </div>
      </div>
    </div>
  )
}
