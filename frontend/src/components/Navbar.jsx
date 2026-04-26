import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Bell, Crown, LogOut, UserRound } from 'lucide-react'
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
  const { setShowSearch, openPaywall, openAuth, signOut, isLoggedIn, isSubscribed, user } = useStore()
  const navigate = useNavigate()

  const avatarLetter = user?.displayName?.[0] || user?.email?.[0] || '?'

  return (
    <nav
      className={`${styles.nav} ${scrolled ? styles.scrolled : ''}`}
      role="navigation"
      aria-label="Main navigation"
    >
      {/* Logo */}
      <a href="/" className={styles.logo} aria-label="Dhara home">
        ধারা
      </a>

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

        <button className={styles.iconBtn} aria-label="Notifications">
          <Bell size={16} />
        </button>

        {isLoggedIn ? (
          <>
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
                <span className={styles.profileLabel}>
                  {user?.displayName || 'My Profile'}
                </span>
                <UserRound size={14} />
              </button>
              <button
                className={styles.iconBtn}
                onClick={signOut}
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut size={16} />
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
