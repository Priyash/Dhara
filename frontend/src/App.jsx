import { useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { useStore } from './store/useStore'
import Navbar from './components/Navbar'
import Home from './pages/Home'
import Browse from './pages/Browse'
import Watch from './pages/Watch'
import Profile from './pages/Profile'
import Admin from './pages/Admin'
import CreatorStudio from './pages/CreatorStudio'
import NotFound from './pages/NotFound'
import SearchOverlay from './components/SearchOverlay'
import PaywallModal from './components/PaywallModal'
import ContentDetailModal from './components/ContentDetailModal'
import AuthModal from './components/AuthModal'
import ScreenTransition from './components/ScreenTransition'
import VerifyEmailModal from './components/VerifyEmailModal'
import styles from './App.module.css'

function AnimatedRoutes() {
  const location = useLocation()
  return (
    <div key={location.key} className={styles.routePane}>
      <Routes location={location}>
        <Route path="/"          element={<Home />} />
        <Route path="/browse"    element={<Browse />} />
        <Route path="/watch/:id" element={<Watch />} />
        <Route path="/profile"         element={<Profile />} />
        <Route path="/admin"           element={<Admin />} />
        <Route path="/creator-studio"  element={<CreatorStudio />} />
        <Route path="*"                element={<NotFound />} />
      </Routes>
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
