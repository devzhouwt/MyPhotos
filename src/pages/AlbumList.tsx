import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { hasConfig, ALBUM_BASE_DIR } from '@/stores/config'
import { getContents, createFile, updateFile, getAllFiles, deleteFile, getFileContent, getImageBlobUrl } from '@/services/gitee'
import { isThumbnailFile, getThumbnailName } from '@/utils/thumbnail'
import { showToast } from '@/components/Toast'
import {
  IconPlus,
  IconPencil,
  IconTrash,
  IconImage,
  IconX,
  IconAlertTriangle,
} from '@/components/icons'
import type { RepoFile, Album, BatchProgress } from '@/types'

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i]
}

export default function AlbumList() {
  const navigate = useNavigate()
  const location = useLocation()

  // 尝试读取预加载的相册数据（从 Settings 保存后预加载）
  const [preloaded] = useState(() => {
    try {
      const raw = sessionStorage.getItem('myphotos_preloaded_albums')
      if (raw) {
        sessionStorage.removeItem('myphotos_preloaded_albums')
        return JSON.parse(raw) as Album[]
      }
    } catch { /* ignore */ }
    return null
  })

  const [albums, setAlbums] = useState<Album[]>(() => preloaded ?? [])
  const [loading, setLoading] = useState(() => preloaded === null)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newAlbumName, setNewAlbumName] = useState('')
  const [createError, setCreateError] = useState('')
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [renameNewName, setRenameNewName] = useState('')
  const [renameError, setRenameError] = useState('')
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null)

  // 长按相册弹出操作菜单（手机端）
  const [longPressAlbum, setLongPressAlbum] = useState<Album | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLongPressRef = useRef(false)

  // 组件卸载时清除长按计时器
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    }
  }, [])

  // 检测设置页同步状态（通过 sessionStorage 跨页面通信）
  const [isSyncing, setIsSyncing] = useState(() => sessionStorage.getItem('myphotos_syncing') === 'true')
  useEffect(() => {
    const timer = setInterval(() => {
      setIsSyncing(sessionStorage.getItem('myphotos_syncing') === 'true')
    }, 500)
    return () => clearInterval(timer)
  }, [])

  // 路由守卫
  useEffect(() => {
    if (!hasConfig()) {
      navigate('/settings')
    }
  }, [navigate])

  const loadAlbums = useCallback(async (showLoading = true) => {
    if (!hasConfig()) return
    if (showLoading) setLoading(true)
    setError('')
    try {
      const contents = await getContents(ALBUM_BASE_DIR)
      const dirs = contents.filter((item) => item.type === 'dir')

      const albumList: Album[] = []
      for (const dir of dirs) {
        try {
          const files = await getContents(dir.path)
          const mediaFiles = files.filter(
            (f) => f.type === 'file' && f.name !== '.gitkeep' && f.name !== '.album-meta.json' && !isThumbnailFile(f.name),
          )

          // 读取 .album-meta.json
          let coverFileName: string | null = null
          let displayName: string | null = null
          let totalSizeBytes = 0
          let totalDirSizeBytes = 0
          const metaFile = files.find((f) => f.name === '.album-meta.json')
          if (metaFile) {
            try {
              const metaInfo = await getFileContent(metaFile.path)
              if (metaInfo.content) {
                const meta = JSON.parse(decodeURIComponent(escape(atob(metaInfo.content))))
                if (meta.coverFile) coverFileName = meta.coverFile as string
                if (meta.displayName) displayName = meta.displayName as string
                if (typeof meta.totalSizeBytes === 'number') totalSizeBytes = meta.totalSizeBytes
                if (typeof meta.totalDirSizeBytes === 'number') totalDirSizeBytes = meta.totalDirSizeBytes
              }
            } catch { /* 元数据读取失败，忽略 */ }
          }

          // 检查 sessionStorage 中的封面更新（转移照片后写入，绕过 Gitee CDN 缓存）
          try {
            const coverUpdates = JSON.parse(sessionStorage.getItem('myphotos_cover_updates') || '{}')
            if (dir.name in coverUpdates) {
              coverFileName = coverUpdates[dir.name] // null 表示清除封面设置
              // 消费后删除该条目
              delete coverUpdates[dir.name]
              sessionStorage.setItem('myphotos_cover_updates', JSON.stringify(coverUpdates))
            }
          } catch { /* 忽略 */ }

          // 如果没有手动设置封面，使用第一张图片
          if (!coverFileName) {
            const firstImage = mediaFiles.find((f) => /\.(jpg|jpeg|png|gif|webp)$/i.test(f.name))
            if (firstImage) coverFileName = firstImage.name
          }

          // 加载封面 blob URL（缩略图优先，回退原图）
          let coverUrl: string | null = null
          if (coverFileName) {
            const coverFilePath = `${dir.path}/${coverFileName}`
            const thumbName = getThumbnailName(coverFileName)
            const thumbPath = `${dir.path}/${thumbName}`
            try {
              coverUrl = await getImageBlobUrl(thumbPath)
            } catch {
              try {
                coverUrl = await getImageBlobUrl(coverFilePath)
              } catch { /* 封面加载失败 */ }
            }
          }

          albumList.push({
            name: displayName || dir.name,
            dirName: dir.name,
            coverUrl,
            fileCount: mediaFiles.length,
            totalSizeBytes,
            totalDirSizeBytes,
            files: mediaFiles,
          })
        } catch {
          albumList.push({ name: dir.name, dirName: dir.name, coverUrl: null, fileCount: 0, totalSizeBytes: 0, totalDirSizeBytes: 0, files: [] })
        }
      }
      setAlbums(albumList)
    } catch (err: any) {
      // 目录不存在时视为空相册列表
      if (err?.code === 404) {
        setAlbums([])
      } else {
        setError(err?.message || '加载相册列表失败')
      }
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  const isInitialMount = useRef(true)

  useEffect(() => {
    loadAlbums()
  }, [loadAlbums])

  // 从详情页返回时重新加载相册列表（刷新封面等数据）
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    if (location.pathname === '/' && !preloaded) {
      loadAlbums(false)
    }
  }, [location.pathname])

  const handleCreate = async () => {
    const name = newAlbumName.trim()
    if (!name) {
      setCreateError('请输入相册名称')
      return
    }
    if (name.includes('/')) {
      setCreateError('相册名称不能包含 /')
      return
    }

    setCreateError('')
    // 立即关闭弹窗并乐观更新列表
    setShowCreate(false)
    setNewAlbumName('')
    setAlbums((prev) => [...prev, { name, dirName: name, coverUrl: null, fileCount: 0, totalSizeBytes: 0, totalDirSizeBytes: 0, files: [] }])

    setBatchProgress({
      status: 'running',
      currentBatch: 0,
      totalBatches: 2,
      currentFile: 0,
      totalFiles: 2,
      message: `正在创建相册「${name}」...`,
    })

    try {
      // 1. 创建目录占位文件
      await createFile(`${ALBUM_BASE_DIR}/${name}/.gitkeep`, '', `创建相册 ${name}`)
      setBatchProgress((prev) => ({
        ...prev!,
        currentBatch: 1,
        currentFile: 1,
        message: `正在初始化元数据...`,
      }))

      // 2. 写入元数据
      const metaContent = JSON.stringify({ displayName: name })
      const metaBase64 = btoa(unescape(encodeURIComponent(metaContent)))
      await createFile(`${ALBUM_BASE_DIR}/${name}/.album-meta.json`, metaBase64, `初始化相册元数据`)
      setBatchProgress({
        status: 'done',
        currentBatch: 2,
        totalBatches: 2,
        currentFile: 2,
        totalFiles: 2,
        message: `相册「${name}」创建成功`,
      })

      // 刷新相册列表
      loadAlbums(false)
      setTimeout(() => setBatchProgress(null), 3000)
    } catch (err: any) {
      // 创建失败，回滚乐观更新
      setAlbums((prev) => prev.filter((a) => a.dirName !== name))
      setBatchProgress({
        ...batchProgress!,
        status: 'error',
        message: err?.message || '创建相册失败',
      })
    }
  }

  const handleDelete = async (album: Album) => {
    if (batchProgress?.status === 'running') return
    if (!window.confirm(`确定要删除相册「${album.name}」吗？此操作不可撤销。`)) return

    // 乐观更新：立即从列表中移除
    setAlbums((prev) => prev.filter((a) => a.dirName !== album.dirName))

    try {
      const allFiles = await getAllFiles(`${ALBUM_BASE_DIR}/${album.dirName}`)
      const totalFiles = allFiles.length
      if (totalFiles === 0) {
        loadAlbums(false)
        return
      }

      const batchSize = 200
      const batches: RepoFile[][] = []
      for (let i = 0; i < allFiles.length; i += batchSize) {
        batches.push(allFiles.slice(i, i + batchSize))
      }

      setBatchProgress({
        status: 'running',
        currentBatch: 0,
        totalBatches: batches.length,
        currentFile: 0,
        totalFiles,
        message: `正在删除相册「${album.name}」...`,
      })

      for (let i = 0; i < batches.length; i++) {
        setBatchProgress((prev) => ({
          ...prev!,
          currentBatch: i + 1,
          message: `正在删除第 ${i + 1}/${batches.length} 批...`,
        }))

        for (let j = 0; j < batches[i].length; j++) {
          const file = batches[i][j]
          await deleteFile(file.path, file.sha, `删除 ${file.path}`)
          setBatchProgress((prev) => ({
            ...prev!,
            currentFile: i * batchSize + j + 1,
          }))
        }

        if (i < batches.length - 1) {
          setBatchProgress((prev) => ({
            ...prev!,
            message: `第 ${i + 1} 批完成，等待3分钟后继续...`,
          }))
          await new Promise((resolve) => setTimeout(resolve, 3 * 60 * 1000))
        }
      }

      setBatchProgress({
        status: 'done',
        currentBatch: batches.length,
        totalBatches: batches.length,
        currentFile: totalFiles,
        totalFiles,
        message: '删除完成',
      })
      loadAlbums()
      setTimeout(() => setBatchProgress(null), 3000)
    } catch (err: any) {
      setBatchProgress((prev) => ({ ...prev!, status: 'error', message: err?.message || '删除失败' }))
    }
  }

  const openRenameModal = (album: Album) => {
    if (batchProgress?.status === 'running') return
    setRenameTarget(album.dirName)
    setRenameNewName(album.name)
    setRenameError('')
  }

  const closeRenameModal = () => {
    setRenameTarget(null)
    setRenameNewName('')
    setRenameError('')
  }

  const handleRename = async () => {
    if (!renameTarget) return
    const dirName = renameTarget
    const newName = renameNewName.trim()
    if (!newName) { setRenameError('请输入相册名称'); return }
    if (newName.includes('/')) { setRenameError('相册名称不能包含 /'); return }

    // 找到当前相册，检查显示名是否真的变了
    const album = albums.find((a) => a.dirName === dirName)
    if (!album || newName === album.name) { closeRenameModal(); return }

    const oldDisplayName = album.name
    closeRenameModal()

    // 乐观更新：立即在 UI 上反映重命名
    setAlbums((prev) =>
      prev.map((a) => (a.dirName === dirName ? { ...a, name: newName } : a)),
    )

    try {
      // 只需更新 .album-meta.json 中的 displayName，一次 API 调用
      const metaPath = `${ALBUM_BASE_DIR}/${dirName}/.album-meta.json`

      try {
        // 读取现有元数据，合并更新 displayName
        const existing = await getFileContent(metaPath)
        let mergedMeta: Record<string, unknown> = {}
        if (existing.content) {
          mergedMeta = JSON.parse(decodeURIComponent(escape(atob(existing.content))))
        }
        mergedMeta.displayName = newName
        const mergedBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(mergedMeta))))
        await updateFile(metaPath, mergedBase64, existing.sha, `重命名相册为 ${newName}`)
      } catch {
        // 元数据文件不存在，创建新的
        const metaContent = JSON.stringify({ displayName: newName })
        const metaBase64 = btoa(unescape(encodeURIComponent(metaContent)))
        await createFile(metaPath, metaBase64, `设置相册名称为 ${newName}`)
      }

      showToast(`相册「${newName}」重命名成功`, 'success')
    } catch (err: any) {
      // 操作失败，回滚 UI
      setAlbums((prev) =>
        prev.map((a) => (a.dirName === dirName ? { ...a, name: oldDisplayName } : a)),
      )
      showToast(err?.message || '重命名失败', 'error')
    }
  }

  const isLocked = batchProgress?.status === 'running' || isSyncing

  return (
    <div className="min-h-full flex flex-col">
      <div className="mx-auto w-full max-w-7xl px-6 pt-8 pb-6">
      {/* 同步进行中提示 */}
      {isSyncing && (
        <div className="mb-5">
          <div className="flex items-center gap-3 px-5 py-3.5 bg-amber-50 border border-amber-200/80 rounded-md text-sm text-amber-700">
            <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin shrink-0" />
            相册目录名同步进行中，请在设置页等待完成后再操作
          </div>
        </div>
      )}

      {/* 页面标题栏 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-slate-800 tracking-tight">我的相册</h1>
          {albums.length > 0 && (
            <p className="text-xs text-slate-400 mt-0.5">{albums.length} 个相册</p>
          )}
        </div>
        {albums.length > 0 && (
          <button
            onClick={() => setShowCreate(true)}
            disabled={isLocked}
            className="btn btn-primary"
          >
            <IconPlus size={15} />
            新建相册
          </button>
        )}
      </div>

      {/* 空状态 — 居中展示 */}
      {!loading && !error && albums.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center text-center -mt-16">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-50 flex items-center justify-center mb-5">
            <IconImage size={36} className="text-slate-300" />
          </div>
          <h2 className="text-xl font-bold text-slate-700 mb-2">还没有相册</h2>
          <p className="text-[13px] text-slate-400 mb-8 max-w-xs leading-relaxed">
            创建你的第一个相册，开始记录美好瞬间
          </p>
          <button onClick={() => setShowCreate(true)} className="btn btn-primary text-[14px] px-7 py-2.5">
            <IconPlus size={18} />
            新建相册
          </button>
        </div>
      )}

      {/* 批量操作进度 */}
      {batchProgress && (
        <div className="mb-6">
          <div
            className={`p-4 rounded-md border ${
              batchProgress.status === 'error'
                ? 'bg-red-50 border-red-200/80'
                : batchProgress.status === 'done'
                ? 'bg-emerald-50 border-emerald-200/80'
                : 'bg-blue-50 border-blue-200/80'
            }`}
          >
            <div className="flex items-center gap-3">
              {batchProgress.status === 'running' && (
                <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              )}
              {batchProgress.status === 'error' && (
                <IconAlertTriangle size={18} className="text-red-500 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm font-medium ${
                    batchProgress.status === 'error'
                      ? 'text-red-700'
                      : batchProgress.status === 'done'
                      ? 'text-emerald-700'
                      : 'text-blue-700'
                  }`}
                >
                  {batchProgress.message}
                </p>
                {batchProgress.status === 'running' && (
                  <div className="mt-2">
                    <div className="progress-bar">
                      <div
                        className="progress-bar-fill bg-blue-500"
                        style={{ width: `${Math.round((batchProgress.currentFile / batchProgress.totalFiles) * 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-blue-500 mt-1">
                      {batchProgress.currentFile} / {batchProgress.totalFiles}
                    </p>
                  </div>
                )}
              </div>
              {batchProgress.status === 'error' && (
                <button
                  onClick={() => setBatchProgress(null)}
                  className="btn btn-ghost shrink-0"
                >
                  <IconX size={14} />
                  关闭
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200/80 rounded-md">
          <div className="flex items-start gap-3">
            <IconAlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-red-700">{error}</p>
              <button onClick={() => loadAlbums(true)} className="btn btn-ghost mt-2 text-red-600">
                重试
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 加载中 - 无数据时居中显示，有数据时显示骨架屏 */}
      {loading && albums.length === 0 && !error && (
        <div className="flex-1 flex flex-col items-center justify-center text-center -mt-12">
          <div className="w-8 h-8 border-3 border-blue-400 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm text-slate-400">正在加载相册…</p>
        </div>
      )}
      {loading && albums.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="card overflow-hidden animate-pulse">
              <div className="aspect-[4/3] bg-slate-100" />
              <div className="p-3 space-y-2">
                <div className="h-3.5 bg-slate-100 rounded w-2/3" />
                <div className="h-3 bg-slate-100 rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 相册网格 */}
      {!loading && albums.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {albums.map((album) => (
            <div
              key={album.dirName}
              className="card overflow-hidden group cursor-pointer"
              onClick={(e) => {
                if (isLongPressRef.current) {
                  isLongPressRef.current = false
                  return
                }
                navigate(`/album/${encodeURIComponent(album.dirName)}`)
              }}
              onTouchStart={() => {
                isLongPressRef.current = false
                longPressTimerRef.current = setTimeout(() => {
                  isLongPressRef.current = true
                  setLongPressAlbum(album)
                }, 500)
              }}
              onTouchEnd={() => {
                if (longPressTimerRef.current) {
                  clearTimeout(longPressTimerRef.current)
                  longPressTimerRef.current = null
                }
              }}
              onTouchMove={() => {
                if (longPressTimerRef.current) {
                  clearTimeout(longPressTimerRef.current)
                  longPressTimerRef.current = null
                }
              }}
            >
              {/* 封面区域 */}
              <div className="aspect-[4/3] bg-gradient-to-br from-slate-100 to-slate-50 flex items-center justify-center relative">
                {album.coverUrl ? (
                  <img
                    src={album.coverUrl}
                    alt={album.name}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-1.5">
                    <IconImage size={32} className="text-slate-300" />
                    {album.fileCount > 0 && (
                      <span className="text-[11px] text-slate-400">{album.fileCount} 张</span>
                    )}
                  </div>
                )}

                {/* 渐变遮罩 */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" />

                {/* 操作按钮组 */}
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-1 group-hover:translate-y-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); openRenameModal(album) }}
                    disabled={isLocked}
                    className="btn btn-icon"
                    title="重命名"
                    style={{ padding: '5px', background: '#fff' }}
                  >
                    <IconPencil size={12} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(album) }}
                    disabled={isLocked}
                    className="btn btn-icon"
                    title="删除"
                    style={{ padding: '5px', background: '#fff', color: 'var(--color-danger)' }}
                  >
                    <IconTrash size={12} />
                  </button>
                </div>
              </div>

              {/* 底部信息 */}
              <div className="px-3 py-2.5">
                <p className="text-[14px] font-bold text-slate-800 truncate leading-tight">{album.name}</p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className="text-[11px] text-slate-400">{album.fileCount > 0 ? `${album.fileCount} 张` : '空'}</span>
                  {album.totalSizeBytes > 0 && (
                    <>
                      <span className="text-[11px] text-slate-300">·</span>
                      <span className="text-[11px] text-slate-400">照片 {formatSize(album.totalSizeBytes)}</span>
                      {album.totalDirSizeBytes > 0 && (
                        <>
                          <span className="text-[11px] text-slate-300">·</span>
                          <span className="text-[11px] text-slate-400">占用 {formatSize(album.totalDirSizeBytes)}</span>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 创建相册弹窗 */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => { setShowCreate(false); setNewAlbumName(''); setCreateError('') }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-800">新建相册</h2>
              <button
                onClick={() => { setShowCreate(false); setNewAlbumName(''); setCreateError('') }}
                className="btn btn-ghost btn-icon"
              >
                <IconX size={16} />
              </button>
            </div>

            <input
              type="text"
              value={newAlbumName}
              onChange={(e) => { setNewAlbumName(e.target.value); setCreateError('') }}
              placeholder="输入相册名称"
              className="input mb-3"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />

            {createError && (
              <p className="text-xs text-red-500 mb-3 flex items-center gap-1.5">
                <IconAlertTriangle size={14} />
                {createError}
              </p>
            )}

            <div className="flex gap-3 justify-end mt-4">
              <button
                onClick={() => { setShowCreate(false); setNewAlbumName(''); setCreateError('') }}
                className="btn btn-secondary"
              >
                取消
              </button>
              <button onClick={handleCreate} className="btn btn-primary">
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 重命名相册弹窗 */}
      {renameTarget && (
        <div className="modal-overlay" onClick={closeRenameModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-800">重命名相册</h2>
              <button onClick={closeRenameModal} className="btn btn-ghost btn-icon">
                <IconX size={16} />
              </button>
            </div>

            <input
              type="text"
              value={renameNewName}
              onChange={(e) => { setRenameNewName(e.target.value); setRenameError('') }}
              placeholder="输入新相册名称"
              className="input mb-3"
              onKeyDown={(e) => e.key === 'Enter' && handleRename()}
              autoFocus
            />

            {renameError && (
              <p className="text-xs text-red-500 mb-3 flex items-center gap-1.5">
                <IconAlertTriangle size={14} />
                {renameError}
              </p>
            )}

            <div className="flex gap-3 justify-end mt-4">
              <button onClick={closeRenameModal} className="btn btn-secondary">
                取消
              </button>
              <button onClick={handleRename} className="btn btn-primary">
                确认
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 长按相册弹出操作菜单（手机端） */}
      {longPressAlbum && (
        <div className="modal-overlay" onClick={() => setLongPressAlbum(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-slate-800 truncate pr-4">{longPressAlbum.name}</h2>
              <button
                onClick={() => setLongPressAlbum(null)}
                className="btn btn-ghost btn-icon shrink-0"
              >
                <IconX size={16} />
              </button>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => { setLongPressAlbum(null); openRenameModal(longPressAlbum) }}
                disabled={isLocked}
                className="btn btn-secondary justify-start px-4 py-2.5 text-[14px]"
              >
                <IconPencil size={15} />
                重命名
              </button>
              <button
                onClick={() => { setLongPressAlbum(null); handleDelete(longPressAlbum) }}
                disabled={isLocked}
                className="btn justify-start px-4 py-2.5 text-[14px]"
                style={{ background: 'var(--color-danger-light)', color: 'var(--color-danger)' }}
              >
                <IconTrash size={15} />
                删除相册
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  )
}
