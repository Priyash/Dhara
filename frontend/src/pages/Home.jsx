import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Hero from '../components/Hero'
import ContentRow from '../components/ContentRow'
import CinematicRow from '../components/CinematicRow'
import GenreMosaic from '../components/GenreMosaic'
import WideResumeCard from '../components/WideResumeCard'
import CategoryGrid from '../components/CategoryGrid'
import CuratedShelfRow from '../components/CuratedShelfRow'
import { useStore } from '../store/useStore'
import { fetchContent, fetchShelves, fetchContinueWatching, fetchRecommendationShelves } from '../services/api'
import styles from './Home.module.css'

export default function Home() {
  const { openItem, isSubscribed, isLoggedIn } = useStore()
  const navigate = useNavigate()
  const [content,               setContent]               = useState([])
  const [shelves,               setShelves]               = useState([])
  const [continueWatching,      setContinueWatching]      = useState([])
  const [recommendationShelves, setRecommendationShelves] = useState([])
  const [contentLoading,        setContentLoading]        = useState(true)
  const [contentError,          setContentError]          = useState(false)

  const loadContent = (signal) => {
    setContentLoading(true)
    setContentError(false)
    fetchContent({ sort: 'popular', page: 1, limit: 48 }, { signal })
      .then((res) => { setContent(Array.isArray(res) ? res : (res.items ?? [])); setContentError(false) })
      .catch((err) => { if (err?.name !== 'AbortError') setContentError(true) })
      .finally(() => setContentLoading(false))
  }

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller

    loadContent(signal)
    fetchShelves({ signal }).then(setShelves).catch(() => {})
    fetchRecommendationShelves({ signal }).then(setRecommendationShelves).catch(() => {})

    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!isLoggedIn) { setContinueWatching([]); return }
    const controller = new AbortController()
    // Small delay so Watch.jsx's unmount save completes before we read from the backend
    const t = setTimeout(() => {
      fetchContinueWatching({ signal: controller.signal }).then(setContinueWatching).catch(() => {})
    }, 350)
    return () => { clearTimeout(t); controller.abort() }
  }, [isLoggedIn])

  // Re-fetch when the tab regains focus (user returns from another tab after watching)
  useEffect(() => {
    if (!isLoggedIn) return
    const controller = new AbortController()
    const onFocus = () => fetchContinueWatching({ signal: controller.signal }).then(setContinueWatching).catch(() => {})
    window.addEventListener('focus', onFocus)
    return () => { window.removeEventListener('focus', onFocus); controller.abort() }
  }, [isLoggedIn])

  const movies      = content.filter(c => c.type === 'Film')
  const series      = content.filter(c => c.type === 'Series')
  const serialDrama = content.filter(c => c.type === 'Serial Drama')
  const originals   = content.filter(c => c.type === 'Documentary')
  const newReleases = content.filter(c => c.badge === 'NEW')
  const live        = content.filter(c => c.badge === 'LIVE')

  // Pick top 2 from each category so all types are represented; backfill to 8 if any category is thin
  const trendingPick = [
    ...movies.slice(0, 2),
    ...series.slice(0, 2),
    ...serialDrama.slice(0, 2),
    ...originals.slice(0, 2),
  ]
  const trendingIds  = new Set(trendingPick.map(c => c._id || c.id))
  const trending     = [
    ...trendingPick,
    ...content.filter(c => !trendingIds.has(c._id || c.id)),
  ].slice(0, 8)

  const rowProps = { onCardClick: openItem, isSubscribed }

  // Continue watching click — go directly to watch page (respects paywall via openItem fallback)
  const handleContinueClick = (item) => {
    if (item.isPremium && !isSubscribed) { openItem(item); return }
    navigate(`/watch/${item.id || item._id}`)
  }

  return (
    <main>
      <Hero />

      <div className={styles.rows}>

        {/* ── Continue Watching — wide resume card ── */}
        {continueWatching.length > 0 && (
          <WideResumeCard
            items={continueWatching}
            onCardClick={handleContinueClick}
          />
        )}

        {/* ── Recommendation shelves (affinity / top10 / genre) ── */}
        {recommendationShelves
          .filter(shelf => shelf.type !== 'progress')
          .map(shelf => (
            <ContentRow
              key={shelf.id}
              title={shelf.type === 'affinity' && shelf.seed?.title ? shelf.seed.title : shelf.title}
              eyebrow={
                shelf.type === 'affinity' ? 'Because you watched' :
                shelf.type === 'top10'    ? 'This week' :
                undefined
              }
              items={shelf.items}
              ranked={shelf.type === 'top10'}
              onSeeAll={shelf.type === 'top10' ? () => navigate('/browse') : undefined}
              eventSource={`shelf_${shelf.type}`}
              {...rowProps}
            />
          ))
        }

        {/* ── Content load error ── */}
        {contentError && !contentLoading && (
          <div className={styles.contentError}>
            <p>Could not load content. Check your connection.</p>
            <button onClick={() => loadContent()}>Retry</button>
          </div>
        )}

        {/* ── Trending ── */}
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
          <CategoryGrid
            title="Trending Now"
            eyebrow="Right now"
            items={trending}
            onSeeAll={() => navigate('/browse')}
            {...rowProps}
          />
        )}

        {/* ── New Releases — cinematic 16:9 row ── */}
        {newReleases.length > 0 && (
          <CinematicRow
            title="New Releases"
            eyebrow="Just dropped"
            items={newReleases}
            onCardClick={openItem}
            onSeeAll={() => navigate('/browse?filter=New')}
          />
        )}

        {/* ── Live ── */}
        {live.length > 0 && (
          <ContentRow title="Live Now" items={live} {...rowProps} />
        )}

        {/* ── Movies — editorial mosaic (5+ items) → grid overflow ── */}
        {movies.length > 0 && (
          <>
            <div className={styles.ambientPulse} aria-hidden="true" />

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

            {/* Mosaic only when there are 5+ films; else fall straight to grid */}
            {movies.length >= 5 && (
              <GenreMosaic
                title="Movies"
                items={movies.slice(0, 5)}
                onCardClick={openItem}
              />
            )}

            <CategoryGrid
              title={movies.length >= 5 ? 'More Films' : 'Movies'}
              eyebrow={movies.length >= 5 ? undefined : 'Now streaming'}
              items={movies.length >= 5 ? movies.slice(5) : movies}
              onCardClick={openItem}
              isSubscribed={isSubscribed}
              onSeeAll={() => navigate('/browse?type=Film')}
              totalCount={movies.length}
              eventSource="grid_films"
            />
          </>
        )}

        {/* ── Series — grid layout ── */}
        {series.length > 0 && (
          <CategoryGrid
            title="Series"
            eyebrow="Binge-worthy"
            items={series}
            onCardClick={openItem}
            isSubscribed={isSubscribed}
            onSeeAll={() => navigate('/browse?type=Series')}
            totalCount={series.length}
            eventSource="grid_series"
          />
        )}

        {/* ── ধারাবাহিক (Serial Drama) — cinematic row ── */}
        {serialDrama.length > 0 && (
          <CinematicRow
            title="ধারাবাহিক"
            eyebrow="Serial Drama"
            items={serialDrama}
            onCardClick={openItem}
            onSeeAll={() => navigate('/browse?type=Serial+Drama')}
          />
        )}

        {/* ── Originals — grid layout ── */}
        {originals.length > 0 && (
          <CategoryGrid
            title="Originals"
            eyebrow="Dhara exclusive"
            items={originals}
            onCardClick={openItem}
            isSubscribed={isSubscribed}
            onSeeAll={() => navigate('/browse?type=Documentary')}
            totalCount={originals.length}
            eventSource="grid_originals"
          />
        )}

        {/* ── Curated shelves ── */}
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
        <span className={styles.copyright}>© {new Date().getFullYear()} Dhara Streaming</span>
      </footer>
    </main>
  )
}
