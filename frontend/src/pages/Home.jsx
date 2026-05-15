import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Hero from '../components/Hero'
import ContentRow from '../components/ContentRow'
import CuratedShelfRow from '../components/CuratedShelfRow'
import { useStore } from '../store/useStore'
import { fetchContent, fetchShelves, fetchContinueWatching } from '../services/api'
import styles from './Home.module.css'

export default function Home() {
  const { openItem, isSubscribed, isLoggedIn } = useStore()
  const navigate = useNavigate()
  const [content,          setContent]          = useState([])
  const [shelves,          setShelves]          = useState([])
  const [continueWatching, setContinueWatching] = useState([])
  const [contentLoading,   setContentLoading]   = useState(true)

  useEffect(() => {
    // Cap at 48 — enough for all Home rows. Browse handles full paginated exploration.
    fetchContent({ sort: 'rating', page: 1, limit: 48 })
      .then((res) => setContent(Array.isArray(res) ? res : (res.items ?? [])))
      .catch(() => {})
      .finally(() => setContentLoading(false))
    fetchShelves().then(setShelves).catch(() => {})
  }, [])

  useEffect(() => {
    if (!isLoggedIn) { setContinueWatching([]); return }
    fetchContinueWatching().then(setContinueWatching).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])  // runs on every mount — App remounts routes on each navigation via key={location.key}

  useEffect(() => {
    if (!isLoggedIn) setContinueWatching([])
  }, [isLoggedIn])

  const trending    = content.slice(0, 8)
  const newReleases = content.filter(c => c.badge === 'NEW')
  const movies      = content.filter(c => c.type === 'Film')
  const series      = content.filter(c => c.type === 'Series')
  const originals   = content.filter(c => c.type === 'Documentary')
  const live        = content.filter(c => c.badge === 'LIVE')

  const rowProps = { onCardClick: openItem, isSubscribed }

  return (
    <main>
      <Hero />

      <div className={styles.rows}>

        {continueWatching.length > 0 && (
          <ContentRow
            title="Continue Watching"
            items={continueWatching}
            onSeeAll={null}
            isSubscribed={isSubscribed}
            onCardClick={(item) => {
              // Premium gate: open paywall modal instead of navigating
              if (item.isPremium && !isSubscribed) {
                openItem(item)
                return
              }
              navigate(`/watch/${item.id || item._id}`)
            }}
          />
        )}

        {contentLoading ? (
          <div className={styles.skeletonRows}>
            {[1, 2, 3].map((r) => (
              <div key={r} className={styles.skeletonRow}>
                <div className={styles.skeletonRowTitle} />
                <div className={styles.skeletonCards}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className={styles.skeletonCard} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : trending.length > 0 && (
          <ContentRow
            title="Trending Now"
            items={trending}
            onSeeAll={() => navigate('/browse')}
            {...rowProps}
          />
        )}

        {newReleases.length > 0 && (
          <ContentRow
            title="New Releases"
            items={newReleases}
            onSeeAll={() => navigate('/browse?filter=New')}
            {...rowProps}
          />
        )}

        {live.length > 0 && (
          <ContentRow
            title="Live Now"
            items={live}
            {...rowProps}
          />
        )}

        {movies.length > 0 && (
          <>
            <div className={styles.promo}>
              <div className={styles.promoRing1} aria-hidden="true" />
              <div className={styles.promoRing2} aria-hidden="true" />
              <div className={styles.promoText}>
                <p className={styles.promoEyebrow}>Explore</p>
                <h3 className={styles.promoHeading}>Bengali Classics</h3>
                <p className={styles.promoSub}>Timeless masterpieces from the golden era, restored in HD</p>
              </div>
              <button className={styles.promoBtn} onClick={() => navigate('/browse?type=Film')}>
                Browse Films →
              </button>
            </div>

            <ContentRow
              title="Movies"
              items={movies}
              onSeeAll={() => navigate('/browse?type=Film')}
              {...rowProps}
            />
          </>
        )}

        {series.length > 0 && (
          <ContentRow
            title="Series"
            items={series}
            onSeeAll={() => navigate('/browse?type=Series')}
            {...rowProps}
          />
        )}

        {originals.length > 0 && (
          <ContentRow
            title="Originals"
            items={originals}
            onSeeAll={() => navigate('/browse?type=Documentary')}
            {...rowProps}
          />
        )}

        {/* ── Curated Shelves ── */}
        {shelves.map((shelf) => (
          <CuratedShelfRow
            key={shelf._id}
            shelf={shelf}
            onCardClick={openItem}
            isSubscribed={isSubscribed}
          />
        ))}

      </div>

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
