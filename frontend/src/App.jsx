import { useEffect, lazy, Suspense } from 'react'
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
import styles from './App.module.css'

// Lazy-loaded routes — not part of the initial bundle.
// Home and Browse are loaded eagerly since every user visits them.
// Watch, Profile, Admin, CreatorStudio are loaded on-demand.
const Watch         = lazy(() => import('./pages/Watch'))
const Profile       = lazy(() => import('./pages/Profile'))
const Admin         = lazy(() => import('./pages/Admin'))
const CreatorStudio = lazy(() => import('./pages/CreatorStudio'))

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
    <>
      <Navbar />
      <AnimatedRoutes />
      {showSearch   && <SearchOverlay />}
      {showPaywall  && <PaywallModal />}
      {showVerifyEmail && <VerifyEmailModal />}
      {showAuth     && <AuthModal />}
      {selectedItem && <ContentDetailModal />}
      <ScreenTransition />
    </>
  )
}
