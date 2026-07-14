import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { hasConfig } from '@/stores/config'
import AlbumList from '@/pages/AlbumList'
import AlbumDetail from '@/pages/AlbumDetail'
import Settings from '@/pages/Settings'
import Header from '@/components/Header'
import ToastContainer from '@/components/Toast'

function App() {
  const [configured, setConfigured] = useState(hasConfig())

  // 防止用户误操作关闭/离开页面
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  return (
    <div className="flex flex-col h-full">
      {configured && <Header />}
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={configured ? <AlbumList /> : <Navigate to="/settings" />} />
          <Route path="/album/:name" element={configured ? <AlbumDetail /> : <Navigate to="/settings" />} />
          <Route path="/settings" element={<Settings configured={configured} onConfigChange={setConfigured} />} />
        </Routes>
      </main>
      <ToastContainer />
    </div>
  )
}

export default App
