import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Search, Crown, Clapperboard } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useScrolled } from '../hooks/useScrolled'
import { NAV_LINKS } from '../data/content'
import styles from './Navbar.module.css'

const NAV_ROUTES = {
  Home: '/',
  Movies: '/browse',
  Series: '/browse',
  Originals: '/browse',
  Live: '/browse',
}

export default function Navbar() {
  const scrolled = useScrolled(60)
  const [activeLink, setActiveLink] = useState('Home')
  const { setShowSearch, openPaywall, openAuth, isLoggedIn, isSubscribed, isAdmin, user } = useStore()
  const navigate = useNavigate()
  const location = useLocation()
  const onAdminPage = location.pathname === '/admin'

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
        onClick={() => { setActiveLink('Home'); navigate('/') }}
      >
        ধারা
      </button>

      {/* Nav links */}
      <ul className={styles.links} role="list">
        {NAV_LINKS.map((link) => (
          <li key={link}>
            <button
              className={`${styles.link} ${activeLink === link ? styles.linkActive : ''}`}
              onClick={() => { setActiveLink(link); navigate(NAV_ROUTES[link] || '/') }}
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

        {isLoggedIn ? (
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
