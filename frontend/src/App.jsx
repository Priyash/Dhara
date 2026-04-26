import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useStore } from './store/useStore'
import Navbar from './components/Navbar'
import Home from './pages/Home'
import Browse from './pages/Browse'
import Watch from './pages/Watch'
import Profile from './pages/Profile'
import NotFound from './pages/NotFound'
import SearchOverlay from './components/SearchOverlay'
import PaywallModal from './components/PaywallModal'
import ContentDetailModal from './components/ContentDetailModal'
import AuthModal from './components/AuthModal'

export default function App() {
  const { showSearch, showPaywall, showAuth, selectedItem, initAuth } = useStore()

  // Wire up Firebase session listener once on mount
  useEffect(() => {
    const unsubscribe = initAuth()
    return unsubscribe
  }, [initAuth])

  return (
    <>
      <Navbar />

      <Routes>
        <Route path="/"          element={<Home />} />
        <Route path="/browse"    element={<Browse />} />
        <Route path="/watch/:id" element={<Watch />} />
        <Route path="/profile"   element={<Profile />} />
        <Route path="*"          element={<NotFound />} />
      </Routes>

      {showSearch   && <SearchOverlay />}
      {showPaywall  && <PaywallModal />}
      {showAuth     && <AuthModal />}
      {selectedItem && <ContentDetailModal />}
    </>
  )
}
