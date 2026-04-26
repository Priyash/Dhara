import { useState, useEffect } from 'react'
import Hero from '../components/Hero'
import ContentRow from '../components/ContentRow'
import { useStore } from '../store/useStore'
import { fetchContent } from '../services/api'
import styles from './Home.module.css'

export default function Home() {
  const { openItem } = useStore()
  const [content, setContent] = useState([])

  useEffect(() => {
    fetchContent({ sort: 'rating' }).then(setContent).catch(() => {})
  }, [])

  // Split fetched content into rows client-side
  const trending    = content.filter(c => !c.badge).slice(0, 7)
  const newReleases = content.filter(c => c.badge === 'NEW')
  const topFilms    = content.filter(c => c.type === 'Film' && !c.badge)

  return (
    <main>
      <Hero />

      <div className={styles.rows}>
        <ContentRow title="Trending Now"           items={trending}    onCardClick={openItem} />
        <ContentRow title="New Releases"           items={newReleases} onCardClick={openItem} />

        {/* Category promo banner */}
        <div className={styles.promo}>
          <div className={styles.promoRing1} aria-hidden="true" />
          <div className={styles.promoRing2} aria-hidden="true" />
          <div className={styles.promoText}>
            <p className={styles.promoEyebrow}>Explore</p>
            <h3 className={styles.promoHeading}>Bengali Classics</h3>
            <p className={styles.promoSub}>Timeless masterpieces from the golden era, restored in HD</p>
          </div>
          <button className={styles.promoBtn}>Browse Collection →</button>
        </div>

        <ContentRow title="Award-Winning Films"    items={topFilms}    onCardClick={openItem} />
      </div>

      {/* Footer */}
      <footer className={styles.footer}>
        <span className={styles.footerLogo}>ধারা</span>
        <div className={styles.footerLinks}>
          {['About', 'Terms', 'Privacy', 'Help', 'Careers'].map((l) => (
            <a key={l} href="#" className={styles.footerLink}>{l}</a>
          ))}
        </div>
        <span className={styles.copyright}>© 2025 Dhara Streaming</span>
      </footer>
    </main>
  )
}
