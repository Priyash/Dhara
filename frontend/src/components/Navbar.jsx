import { useNavigate, useLocation } from 'react-router-dom'
import { Search, Crown, Clapperboard } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useScrolled } from '../hooks/useScrolled'
import { NAV_LINKS } from '../data/content'
import styles from './Navbar.module.css'

const NAV_ROUTES = {
  Home:      '/',
  Movies:    '/browse?type=Film',
  Series:    '/browse?type=Series',
  Originals: '/browse?type=Documentary',
  Live:      '/browse?type=Live',
  Reels:     '/reels',
}

function getActiveLink(location) {
  if (location.pathname === '/reels') return 'Reels'
  if (location.pathname !== '/browse') return location.pathname === '/' ? 'Home' : null
  const type = new URLSearchParams(location.search).get('type')
  if (type === 'Film')         return 'Movies'
  if (type === 'Series')       return 'Series'
  if (type === 'Documentary')  return 'Originals'
  if (type === 'Live')         return 'Live'
  return null
}

export default function Navbar() {
  const scrolled = useScrolled(60)
  const { setShowSearch, openPaywall, openAuth, isLoggedIn, isSubscribed, isAdmin, isCreator, creatorStatus, user, authLoading } = useStore()
  const navigate = useNavigate()
  const location = useLocation()
  const activeLink = getActiveLink(location)
  const onAdminPage = location.pathname === '/admin'
  const onCreatorPage = location.pathname === '/creator-studio'

  const avatarLetter = user?.displayName?.[0] || user?.email?.[0] || '?'

  return (
    <nav
      className={`${styles.nav} ${scrolled ? styles.scrolled : ''}`}
      role="navigation"
      aria-label="Main navigation"
    >
      {/* Logo */}
      <button
        className={styles.logo}
        aria-label="Dhara home"
        onClick={() => navigate('/')}
      >
        ধারা
      </button>

      {/* Nav links */}
      <ul className={styles.links} role="list">
        {NAV_LINKS.map((link) => (
          <li key={link}>
            <button
              className={`${styles.link} ${activeLink === link ? styles.linkActive : ''}`}
              onClick={() => navigate(NAV_ROUTES[link] || '/')}
            >
              {link}
            </button>
          </li>
        ))}
      </ul>

      {/* Actions */}
      <div className={styles.actions}>
        <button
          className={styles.iconBtn}
          onClick={() => setShowSearch(true)}
          aria-label="Search"
        >
          <Search size={16} />
        </button>

        {authLoading ? (
          <div className={styles.navAuthSkeleton} aria-hidden="true" />
        ) : isLoggedIn ? (
          <>
            {isAdmin && (
              <button
                className={`${styles.adminBtn} ${onAdminPage ? styles.adminBtnActive : ''}`}
                onClick={() => { if (!onAdminPage) navigate('/admin') }}
                disabled={onAdminPage}
                title={onAdminPage ? 'You are in Admin Studio' : 'Admin Studio'}
              >
                <Clapperboard size={13} />
                Studio
              </button>
            )}

            {!isAdmin && isCreator && creatorStatus === 'approved' && (
              <button
                className={`${styles.creatorBtn} ${onCreatorPage ? styles.creatorBtnActive : ''}`}
                onClick={() => { if (!onCreatorPage) navigate('/creator-studio') }}
                disabled={onCreatorPage}
                title={onCreatorPage ? 'You are in Creator Studio' : 'Creator Studio'}
              >
                <Clapperboard size={13} />
                Creator Studio
              </button>
            )}

            {!isSubscribed && (
              <button className={styles.subscribeBtn} onClick={openPaywall}>
                <Crown size={13} />
                Subscribe
              </button>
            )}

            <div className={styles.userMenu}>
              <button
                className={styles.profileBtn}
                onClick={() => navigate('/profile')}
                aria-label="Open profile"
                title={user?.email || 'Profile'}
              >
                <div className={styles.avatar}>
                  {avatarLetter.toUpperCase()}
                </div>
              </button>
            </div>
          </>
        ) : (
          <button className={styles.signInBtn} onClick={() => openAuth('signin')}>
            Sign In
          </button>
        )}
      </div>
    </nav>
  )
}
