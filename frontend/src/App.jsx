import { Component, useEffect, lazy, Suspense } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { useStore } from './store/useStore'
import Navbar from './components/Navbar'
import Home from './pages/Home'
import Browse from './pages/Browse'
import NotFound from './pages/NotFound'
import SearchOverlay from './components/SearchOverlay'
import PaywallModal from './components/PaywallModal'
import ContentDetailModal from './components/ContentDetailModal'
import AuthModal from './components/AuthModal'
import ScreenTransition from './components/ScreenTransition'
import VerifyEmailModal from './components/VerifyEmailModal'
import ReelUploadsToast from './components/ReelUploadsToast'
import styles from './App.module.css'

// Lazy-loaded routes — not part of the initial bundle.
// Home and Browse are loaded eagerly since every user visits them.
// Watch, Profile, Admin, CreatorStudio are loaded on-demand.
const Watch         = lazy(() => import('./pages/Watch'))
const Profile       = lazy(() => import('./pages/Profile'))
const Admin         = lazy(() => import('./pages/Admin'))
const CreatorStudio = lazy(() => import('./pages/CreatorStudio'))
const Reels         = lazy(() => import('./pages/Reels'))

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', gap: '16px', padding: '24px', textAlign: 'center',
        background: '#0a0a0a', color: '#e5e5e5', fontFamily: 'sans-serif',
      }}>
        <h2 style={{ fontSize: '20px', fontWeight: 600, margin: 0 }}>Something went wrong</h2>
        <p style={{ fontSize: '14px', color: '#888', margin: 0, maxWidth: '360px' }}>
          An unexpected error occurred. Try refreshing the page.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '10px 24px', borderRadius: '8px', border: 'none',
            background: '#db2777', color: '#0a0a0a', fontWeight: 600,
            fontSize: '14px', cursor: 'pointer',
          }}
        >
          Refresh page
        </button>
      </div>
    )
  }
}

function PageFallback() {
  return <div className={styles.pageFallback} />
}

function AnimatedRoutes() {
  const location = useLocation()
  return (
    <div key={location.key} className={styles.routePane}>
      <Suspense fallback={<PageFallback />}>
        <Routes location={location}>
          <Route path="/"                element={<Home />} />
          <Route path="/browse"          element={<Browse />} />
          <Route path="/watch/:id"       element={<Watch />} />
          <Route path="/profile"         element={<Profile />} />
          <Route path="/admin"           element={<Admin />} />
          <Route path="/creator-studio"  element={<CreatorStudio />} />
          <Route path="/reels"           element={<Reels />} />
          <Route path="/reels/:id"       element={<Reels />} />
          <Route path="*"                element={<NotFound />} />
        </Routes>
      </Suspense>
    </div>
  )
}

export default function App() {
  const { showSearch, showPaywall, showAuth, showVerifyEmail, selectedItem, initAuth } = useStore()

  useEffect(() => {
    const unsubscribe = initAuth()
    return unsubscribe
  }, [initAuth])

  return (
    <ErrorBoundary>
      <Navbar />
      <AnimatedRoutes />
      {showSearch      && <SearchOverlay />}
      {showPaywall     && <PaywallModal />}
      {showVerifyEmail && <VerifyEmailModal />}
      {showAuth        && <AuthModal />}
      {selectedItem    && <ContentDetailModal />}
      <ScreenTransition />
      <ReelUploadsToast />
    </ErrorBoundary>
  )
}
