import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// GitHub Pages 部署在仓库名子路径下，需指定 basename；本地开发无需前缀
const BASENAME = import.meta.env.DEV ? '/' : '/MyPhotos'

// 注册 Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${BASENAME}/sw.js`).catch(() => {
      // Service Worker 注册失败不影响应用运行
    })
  })

  // 新 SW 激活并接管页面时自动刷新，确保加载最新资源
  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
    window.location.reload()
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={BASENAME}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
