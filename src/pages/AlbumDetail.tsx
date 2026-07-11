import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { hasConfig, ALBUM_BASE_DIR } from '@/stores/config'
import { getContents, getFileContent, fileToBase64, uploadFileWithProgress, createFile, updateFile, deleteFile, getRawUrl, getImageBlobUrl, invalidateBlobCache, getRepoTree } from '@/services/gitee'
import { generateThumbnail, getThumbnailName, isThumbnailFile } from '@/utils/thumbnail'
import { validateFileType, validateFileSize, isImageFile, MAX_ALBUM_FILES } from '@/utils/validate'
import { showToast } from '@/components/Toast'
import { saveAs } from 'file-saver'
import JSZip from 'jszip'
import {
  IconArrowLeft,
  IconGrid,
  IconList,
  IconUpload,
  IconDownload,
  IconTrash,
  IconStar,
  IconStarFilled,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconX,
  IconPlay,
  IconPlus,
  IconAlertTriangle,
  IconMove,
  IconFolder,
} from '@/components/icons'
import type { RepoFile, UploadTask } from '@/types'

/** 通过文件名后缀判断是否为视频文件 */
function isVideoByName(name: string): boolean {
  return /\.(mp4|mov)$/i.test(name)
}

/** 通过文件名后缀判断是否为图片文件 */
function isImageByName(name: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(name)
}

/** 根据文件扩展名推断 MIME 类型 */
function getMimeType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
  }
  return map[ext] || 'application/octet-stream'
}

/** 将 base64 字符串解码为 Blob */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteString = atob(base64)
  const bytes = new Uint8Array(byteString.length)
  for (let i = 0; i < byteString.length; i++) {
    bytes[i] = byteString.charCodeAt(i)
  }
  return new Blob([bytes], { type: mimeType })
}

type ViewMode = 'grid' | 'timeline'

export default function AlbumDetail() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const albumName = decodeURIComponent(name || '')

  /** 获取文件缩略图的 raw URL（不存在时回退原图） */
  const getThumbRawUrl = (file: RepoFile): string => {
    const thumbName = getThumbnailName(file.name)
    const dir = file.path.substring(0, file.path.lastIndexOf('/') + 1)
    const thumbPath = dir + thumbName
    // 先尝试缩略图URL，如果加载失败会在img的onError中回退到原图
    return getRawUrl(thumbPath)
  }

  /** 检查缩略图是否存在 */
  const [thumbnailExists, setThumbnailExists] = useState<Record<string, boolean>>({})

  /** 检查缩略图是否存在 */
  const checkThumbnailExists = async (file: RepoFile): Promise<boolean> => {
    const thumbName = getThumbnailName(file.name)
    const dir = file.path.substring(0, file.path.lastIndexOf('/') + 1)
    const thumbPath = dir + thumbName
    
    try {
      // 尝试获取缩略图文件信息
      await getFileContent(thumbPath)
      return true
    } catch {
      return false
    }
  }

  const [files, setFiles] = useState<RepoFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')

  // 检测设置页同步状态（通过 sessionStorage 跨页面通信）
  const [isSyncing, setIsSyncing] = useState(() => sessionStorage.getItem('myphotos_syncing') === 'true')
  useEffect(() => {
    const timer = setInterval(() => {
      setIsSyncing(sessionStorage.getItem('myphotos_syncing') === 'true')
    }, 500)
    return () => clearInterval(timer)
  }, [])

  // 上传相关
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 多选相关
  const [selectMode, setSelectMode] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())

  // 图片 blob URL 缓存（替代 raw URL，解决 403 问题）
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({})

  // 当前封面文件名
  const [coverFileName, setCoverFileName] = useState<string | null>(null)

  // 相册显示名称（来自 .album-meta.json）
  const [displayName, setDisplayName] = useState<string | null>(null)

  // 相册文件总大小（字节，来自 .album-meta.json 缓存）
  const [albumTotalSize, setAlbumTotalSize] = useState<number>(0)
  // 相册目录总占用空间（字节，包含缩略图等所有文件）
  const [albumTotalDirSize, setAlbumTotalDirSize] = useState<number>(0)

  // 转移相关
  const [showMoveModal, setShowMoveModal] = useState(false)
  const [moveAlbums, setMoveAlbums] = useState<{ name: string; dirName: string }[]>([])
  const [isLoadingMoveAlbums, setIsLoadingMoveAlbums] = useState(false)
  const [isMoving, setIsMoving] = useState(false)

  // 灯箱相关
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string>('')

  // 加载灯箱图片URL
  useEffect(() => {
    if (lightboxIndex !== null && files[lightboxIndex]) {
      const file = files[lightboxIndex]
      if (!isVideoByName(file.name)) {
        // 对于图片，使用getImageBlobUrl确保加载
        getImageBlobUrl(file.path)
          .then(url => setLightboxImageUrl(url))
          .catch(() => {
            // 如果blob URL加载失败，回退到raw URL
            setLightboxImageUrl(getRawUrl(file.path))
          })
      } else {
        // 对于视频，使用raw URL
        setLightboxImageUrl(getRawUrl(file.path))
      }
    }
  }, [lightboxIndex, files])

  // 路由守卫
  useEffect(() => {
    if (!hasConfig()) navigate('/settings')
  }, [navigate])

  const loadFiles = useCallback(async (showLoading = true) => {
    if (!hasConfig() || !albumName) return
    if (showLoading) setLoading(true)
    setError('')
    try {
      const contents = await getContents(`${ALBUM_BASE_DIR}/${albumName}`)
      const mediaFiles = contents.filter(
        (f) => f.type === 'file' && f.name !== '.gitkeep' && f.name !== '.album-meta.json' && !isThumbnailFile(f.name),
      )
      setFiles(mediaFiles)

      // 读取当前元数据（含缓存的 totalSizeBytes）
      const metaFile = contents.find((f) => f.name === '.album-meta.json')
      let meta: Record<string, unknown> = {}
      let metaSha: string | undefined
      if (metaFile) {
        try {
          const metaInfo = await getFileContent(metaFile.path)
          metaSha = metaInfo.sha
          if (metaInfo.content) {
            meta = JSON.parse(decodeURIComponent(escape(atob(metaInfo.content))))
            if (meta.coverFile) setCoverFileName(meta.coverFile as string)
            if (meta.displayName) setDisplayName(meta.displayName as string)
          }
        } catch { /* 忽略 */ }
      }

      // 通过 Git Trees API 一次性获取所有文件的准确大小（1次API调用）
      const albumPrefix = `${ALBUM_BASE_DIR}/${albumName}/`
      const treeNodes = await getRepoTree()
      const sizeMap = new Map<string, number>()
      for (const node of treeNodes) {
        if (node.type === 'blob' && node.path.startsWith(albumPrefix) && node.size != null) {
          sizeMap.set(node.path, node.size)
        }
      }

      // 核心资源大小：仅用户可见的媒体文件
      let coreTotal = 0
      for (const f of mediaFiles) {
        coreTotal += sizeMap.get(f.path) ?? 0
      }

      // 目录总占用：所有文件（含缩略图、元数据等）
      let dirTotal = 0
      for (const f of contents) {
        if (f.type === 'file' && f.name !== '.gitkeep') {
          dirTotal += sizeMap.get(f.path) ?? 0
        }
      }

      setAlbumTotalSize(coreTotal)
      setAlbumTotalDirSize(dirTotal)
      // 写入 .album-meta.json 缓存（供 AlbumList 使用）
      try {
        const metaPath = `${ALBUM_BASE_DIR}/${albumName}/.album-meta.json`
        const newMeta = { ...meta, totalSizeBytes: coreTotal, totalDirSizeBytes: dirTotal }
        const metaBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(newMeta))))
        if (metaSha) {
          await updateFile(metaPath, metaBase64, metaSha, '缓存相册空间大小')
        } else {
          await createFile(metaPath, metaBase64, '缓存相册空间大小')
        }
      } catch { /* 写入失败不影响主流程 */ }
      
      // 检查每个文件的缩略图是否存在
      const thumbExistenceMap: Record<string, boolean> = {}
      await Promise.all(
        mediaFiles.map(async (file) => {
          if (isImageByName(file.name)) {
            thumbExistenceMap[file.path] = await checkThumbnailExists(file)
          } else {
            thumbExistenceMap[file.path] = false // 视频文件没有缩略图
          }
        })
      )
      setThumbnailExists(thumbExistenceMap)

      // 为每个图片文件加载 blob URL（缩略图优先，回退原图）
      const urlMap: Record<string, string> = {}
      await Promise.all(
        mediaFiles.map(async (file) => {
          if (!isImageByName(file.name)) return
          const thumbName = getThumbnailName(file.name)
          const thumbPath = file.path.substring(0, file.path.lastIndexOf('/') + 1) + thumbName
          try {
            // 优先使用缩略图
            urlMap[file.path] = await getImageBlobUrl(thumbPath)
          } catch {
            try {
              // 回退到原图
              urlMap[file.path] = await getImageBlobUrl(file.path)
            } catch { /* 加载失败，不设置 */ }
          }
        })
      )
      setBlobUrls(urlMap)
    } catch (err: any) {
      setError(err?.message || '加载文件列表失败')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [albumName])

  useEffect(() => { loadFiles() }, [loadFiles])

  // 上传处理
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || [])
    if (selectedFiles.length > 0) processUpload(selectedFiles)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length > 0) processUpload(droppedFiles)
  }

  const processUpload = async (fileList: File[]) => {
    const validFiles: File[] = []
    const errors: string[] = []

    if (files.length + fileList.length > MAX_ALBUM_FILES) {
      showToast(`相册最多容纳 ${MAX_ALBUM_FILES} 张照片，当前已有 ${files.length} 张`, 'error')
      return
    }

    for (const file of fileList) {
      const typeResult = validateFileType(file)
      if (!typeResult.valid) { errors.push(`${file.name}: ${typeResult.error}`); continue }
      const sizeResult = validateFileSize(file)
      if (!sizeResult.valid) { errors.push(`${file.name}: ${sizeResult.error}`); continue }
      validFiles.push(file)
    }

    if (errors.length > 0) showToast(errors.join('\n'), 'error')
    if (validFiles.length === 0) return

    const newTasks: UploadTask[] = validFiles.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file, albumName,
      status: 'pending' as const, progress: 0,
    }))

    setUploadTasks((prev) => [...prev, ...newTasks])

    let uploadedCoreSize = 0
    for (const task of newTasks) {
      await uploadSingleFile(task)
      uploadedCoreSize += task.file.size
    }

    if (uploadedCoreSize > 0) {
      const newCoreTotal = albumTotalSize + uploadedCoreSize
      // dirSize 也加上原始文件大小（缩略图部分较小，由后续同步校准）
      const newDirTotal = albumTotalDirSize + uploadedCoreSize
      setAlbumTotalSize(newCoreTotal)
      setAlbumTotalDirSize(newDirTotal)
      persistAlbumTotalSize(newCoreTotal, newDirTotal)
    }

    // 静默刷新文件列表
    loadFiles(false)
  }

  const uploadSingleFile = async (task: UploadTask) => {
    setUploadTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: 'uploading' as const } : t)))

    try {
      const file = task.file
      const isImage = isImageFile(file)

      let thumbBlob: Blob | null = null
      if (isImage) {
        try { thumbBlob = await generateThumbnail(file) } catch {}
      }

      const originalBase64 = await fileToBase64(file)
      const originalPath = `${ALBUM_BASE_DIR}/${albumName}/${file.name}`

      await uploadFileWithProgress(
        originalPath, originalBase64,
        (progress) => setUploadTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, progress: Math.round(progress * 0.7) } : t)),
        ),
        `上传 ${originalPath}`,
      )

      if (thumbBlob) {
        const thumbBase64 = await fileToBase64(thumbBlob)
        const thumbPath = `${ALBUM_BASE_DIR}/${albumName}/${getThumbnailName(file.name)}`
        await uploadFileWithProgress(
          thumbPath, thumbBase64,
          (progress) => setUploadTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, progress: 70 + Math.round(progress * 0.3) } : t)),
          ),
          `上传缩略图 ${thumbPath}`,
        )
      }

      setUploadTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: 'done' as const, progress: 100 } : t)))
    } catch (err: any) {
      setUploadTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: 'error' as const, error: err?.message || '上传失败' } : t)),
      )
    }
  }

  // 多选
  const toggleSelect = (filePath: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(filePath)) next.delete(filePath); else next.add(filePath)
      return next
    })
  }
  const selectAll = () => setSelectedPaths(new Set(files.map((f) => f.path)))
  const deselectAll = () => setSelectedPaths(new Set())

  /** 将当前大小缓存持久化到 .album-meta.json */
  const persistAlbumTotalSize = async (newCoreTotal: number, newDirTotal: number) => {
    try {
      const metaPath = `${ALBUM_BASE_DIR}/${albumName}/.album-meta.json`
      const existing = await getFileContent(metaPath)
      let meta: Record<string, unknown> = {}
      if (existing.content) {
        meta = JSON.parse(decodeURIComponent(escape(atob(existing.content))))
      }
      meta.totalSizeBytes = newCoreTotal
      meta.totalDirSizeBytes = newDirTotal
      const metaBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(meta))))
      await updateFile(metaPath, metaBase64, existing.sha, '更新相册空间大小')
    } catch { /* 写入失败不影响主流程 */ }
  }

  /** 下载单个文件的 Blob（用于打包 ZIP） */
  const downloadFileBlob = async (file: RepoFile): Promise<{ blob: Blob; name: string }> => {
    const mimeType = getMimeType(file.name)

    // 方式1：通过 Contents API 获取 base64 内容（适用于 <1MB 文件）
    try {
      const fileInfo = await getFileContent(file.path)
      if (fileInfo.content) {
        const blob = base64ToBlob(fileInfo.content, mimeType)
        return { blob, name: file.name }
      }
    } catch {
      // API 调用失败，继续尝试其他方式
    }

    // 方式2：通过 raw URL 获取文件内容（适用于大文件）
    const rawUrl = getRawUrl(file.path)
    try {
      const response = await fetch(rawUrl)
      if (response.ok) {
        const blob = await response.blob()
        // 检查是否为有效文件（非 HTML 错误页面）
        if (blob.size > 0 && !blob.type.includes('text/html')) {
          return { blob, name: file.name }
        }
      }
    } catch {
      // fetch 失败（CORS 等），继续尝试 download_url
    }

    // 方式3：通过 fileInfo.download_url 尝试
    try {
      const fileInfo = await getFileContent(file.path)
      if (fileInfo.download_url) {
        const response = await fetch(fileInfo.download_url)
        if (response.ok) {
          const blob = await response.blob()
          if (blob.size > 0) {
            return { blob, name: file.name }
          }
        }
      }
    } catch {
      // 所有方式均失败
    }

    throw new Error(`无法获取 ${file.name}`)
  }

  const downloadSingle = async (file: RepoFile) => {
    try {
      const fileInfo = await getFileContent(file.path)

      if (fileInfo.content) {
        const mimeType = getMimeType(file.name)
        const blob = base64ToBlob(fileInfo.content, mimeType)
        saveAs(blob, file.name)
      } else if (fileInfo.download_url) {
        const rawUrl = getRawUrl(file.path)
        try {
          const response = await fetch(rawUrl)
          if (response.ok) {
            const blob = await response.blob()
            saveAs(blob, file.name)
            return
          }
        } catch {
          // fetch 失败，回退到新标签页打开
        }
        const a = document.createElement('a')
        a.href = rawUrl
        a.target = '_blank'
        a.rel = 'noopener'
        a.click()
        showToast('已在新标签页打开，请手动保存', 'info')
      } else {
        throw new Error('无法获取文件内容')
      }
    } catch (err: any) { showToast(err?.message || '下载失败', 'error') }
  }

  /** 打包下载指定文件列表为 ZIP */
  const downloadAsZip = async (targetFiles: RepoFile[], zipName: string) => {
    if (targetFiles.length === 0) return

    const total = targetFiles.length
    showToast(`正在打包 ${total} 个文件...`, 'info')

    try {
      const zip = new JSZip()
      let successCount = 0
      let failCount = 0
      const errors: string[] = []

      for (let i = 0; i < total; i++) {
        const file = targetFiles[i]
        try {
          const { blob, name } = await downloadFileBlob(file)
          zip.file(name, blob)
          successCount++
        } catch (err: any) {
          failCount++
          errors.push(err?.message || file.name)
        }
        // 每处理 5 个文件更新一次进度
        if (total > 5 && (i + 1) % 5 === 0 && failCount < total) {
          showToast(`正在打包... ${i + 1}/${total}`, 'info')
        }
      }

      if (successCount === 0) {
        showToast(`所有文件下载失败：${errors.slice(0, 3).join('、')}`, 'error')
        return
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      saveAs(zipBlob, `${zipName}.zip`)

      if (failCount > 0) {
        showToast(`已下载 ${successCount} 个文件，${failCount} 个失败`, 'info')
      } else {
        showToast(`${successCount} 个文件打包完成`, 'success')
      }
    } catch (err: any) {
      showToast(err?.message || '打包失败', 'error')
    }
  }

  /** 批量下载选中文件：5张及以下直接下载，超过5张打包ZIP */
  const downloadBatch = async () => {
    if (selectedPaths.size === 0) return
    const selectedFiles = files.filter((f) => selectedPaths.has(f.path))

    if (selectedFiles.length <= 5) {
      // 优先使用 File System Access API，只让用户选择一次目录
      if ('showDirectoryPicker' in window) {
        try {
          const dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' })
          showToast(`正在保存 ${selectedFiles.length} 个文件...`, 'info')
          let successCount = 0
          let failCount = 0
          for (const file of selectedFiles) {
            try {
              const { blob, name } = await downloadFileBlob(file)
              const fileHandle = await dirHandle.getFileHandle(name, { create: true })
              const writable = await fileHandle.createWritable()
              await writable.write(blob)
              await writable.close()
              successCount++
            } catch {
              failCount++
            }
          }
          if (failCount > 0) {
            showToast(`已保存 ${successCount} 个文件，${failCount} 个失败`, 'info')
          } else {
            showToast(`${successCount} 个文件保存完成`, 'success')
          }
        } catch (err: any) {
          // 用户取消选择目录时不提示错误
          if (err?.name !== 'AbortError') {
            showToast('选择目录失败，改用逐个下载', 'info')
            // 回退到逐个 saveAs
            for (const file of selectedFiles) {
              try {
                const { blob, name } = await downloadFileBlob(file)
                saveAs(blob, name)
              } catch {}
            }
          }
        }
      } else {
        // 不支持 File System Access API，回退到逐个 saveAs
        showToast(`正在下载 ${selectedFiles.length} 个文件...`, 'info')
        let successCount = 0
        let failCount = 0
        for (const file of selectedFiles) {
          try {
            const { blob, name } = await downloadFileBlob(file)
            saveAs(blob, name)
            successCount++
          } catch {
            failCount++
          }
        }
        if (failCount > 0) {
          showToast(`已下载 ${successCount} 个文件，${failCount} 个失败`, 'info')
        } else {
          showToast(`${successCount} 个文件下载完成`, 'success')
        }
      }
    } else {
      await downloadAsZip(selectedFiles, `${albumName}_选中文件`)
    }
  }

  /** 下载全部文件 */
  const downloadAll = async () => {
    if (files.length === 0) return
    await downloadAsZip(files, albumName)
  }

  const deleteBatch = async () => {
    if (selectedPaths.size === 0) return
    if (!window.confirm(`确定要删除选中的 ${selectedPaths.size} 张照片吗？`)) return

    // 先获取待删除文件的大小（用于更新总大小缓存）
    const deletedSizes = await Promise.all(
      Array.from(selectedPaths).map(async (path) => {
        try { const info = await getFileContent(path); return info.size ?? 0 } catch { return 0 }
      })
    )
    const deletedCoreTotal = deletedSizes.reduce((s, n) => s + n, 0)
    let deletedThumbTotal = 0

    // 乐观更新：立即从列表中移除
    setFiles((prev) => prev.filter((f) => !selectedPaths.has(f.path)))
    setSelectedPaths(new Set())
    setSelectMode(false)

    for (const path of selectedPaths) {
      const file = files.find((f) => f.path === path)
      if (!file) continue
      try {
        await deleteFile(path, file.sha, `删除 ${path}`)
        const thumbPath = path.substring(0, path.lastIndexOf('/') + 1) + getThumbnailName(path.split('/').pop() || '')
        try {
          const thumbInfo = await getFileContent(thumbPath)
          deletedThumbTotal += thumbInfo.size ?? 0
          await deleteFile(thumbPath, thumbInfo.sha, `删除缩略图 ${thumbPath}`)
        } catch {}
      } catch (err: any) { showToast(`删除 ${path} 失败: ${err?.message}`, 'error') }
    }

    // 更新相册大小（核心资源 + 目录总占用）
    const deletedDirTotal = deletedCoreTotal + deletedThumbTotal
    const newCoreTotal = Math.max(0, albumTotalSize - deletedCoreTotal)
    const newDirTotal = Math.max(0, albumTotalDirSize - deletedDirTotal)
    setAlbumTotalSize(newCoreTotal)
    setAlbumTotalDirSize(newDirTotal)
    persistAlbumTotalSize(newCoreTotal, newDirTotal)

    // 静默从 API 同步最新数据
    loadFiles(false)
  }

  /** 打开转移弹窗：立即显示，后台加载相册列表 */
  const openMoveModal = async () => {
    if (selectedPaths.size === 0) return
    setShowMoveModal(true)
    setMoveAlbums([])
    setIsLoadingMoveAlbums(true)
    try {
      const contents = await getContents(ALBUM_BASE_DIR)
      const dirs = contents.filter((item) => item.type === 'dir' && item.name !== albumName)
      const albumList: { name: string; dirName: string }[] = []
      for (const dir of dirs) {
        let displayName: string | null = null
        try {
          const files = await getContents(dir.path)
          const metaFile = files.find((f) => f.name === '.album-meta.json')
          if (metaFile) {
            const metaInfo = await getFileContent(metaFile.path)
            if (metaInfo.content) {
              const meta = JSON.parse(decodeURIComponent(escape(atob(metaInfo.content))))
              if (meta.displayName) displayName = meta.displayName as string
            }
          }
        } catch { /* 忽略 */ }
        albumList.push({ name: displayName || dir.name, dirName: dir.name })
      }
      setMoveAlbums(albumList)
    } catch (err: any) {
      showToast(err?.message || '加载相册列表失败', 'error')
      setShowMoveModal(false)
    } finally {
      setIsLoadingMoveAlbums(false)
    }
  }

  /** 执行转移：将选中文件移动到目标相册 */
  const handleMove = async (targetDirName: string) => {
    if (selectedPaths.size === 0) return
    setIsMoving(true)
    const selectedFiles = files.filter((f) => selectedPaths.has(f.path))
    const total = selectedFiles.length
    showToast(`正在转移 ${total} 个文件...`, 'info')

    // 乐观更新：立即从列表中移除
    setFiles((prev) => prev.filter((f) => !selectedPaths.has(f.path)))
    setSelectedPaths(new Set())
    setSelectMode(false)
    setShowMoveModal(false)

    let successCount = 0
    let failCount = 0
    let transferredCoreSize = 0
    let transferredDirSize = 0

    for (const file of selectedFiles) {
      try {
        // 1. 读取源文件内容（同时获取文件大小）
        const fileInfo = await getFileContent(file.path)
        if (!fileInfo.content) throw new Error(`无法读取 ${file.name}`)

        // 2. 在目标相册创建文件
        const targetPath = `${ALBUM_BASE_DIR}/${targetDirName}/${file.name}`
        await createFile(targetPath, fileInfo.content, `转移 ${file.name}`)

        // 3. 删除源文件
        await deleteFile(file.path, file.sha, `删除已转移的 ${file.name}`)

        // 4. 处理缩略图（如果存在）
        const thumbName = getThumbnailName(file.name)
        const thumbPath = file.path.substring(0, file.path.lastIndexOf('/') + 1) + thumbName
        try {
          const thumbInfo = await getFileContent(thumbPath)
          transferredDirSize += thumbInfo.size ?? 0
          if (thumbInfo.content) {
            const targetThumbPath = `${ALBUM_BASE_DIR}/${targetDirName}/${thumbName}`
            await createFile(targetThumbPath, thumbInfo.content, `转移缩略图 ${thumbName}`)
          }
          await deleteFile(thumbPath, thumbInfo.sha, `删除已转移的缩略图 ${thumbName}`)
        } catch { /* 缩略图不存在，忽略 */ }

        transferredCoreSize += fileInfo.size ?? 0
        transferredDirSize += fileInfo.size ?? 0
        successCount++
      } catch (err: any) {
        failCount++
        showToast(`转移 ${file.name} 失败: ${err?.message}`, 'error')
      }
    }

    // 检查被转移的照片中是否包含当前封面（手动设置或默认第一张）
    const movedFileNames = new Set(selectedFiles.map((f) => f.name))
    const coverIsMoved = coverFileName ? movedFileNames.has(coverFileName) : false
    // 默认封面：没有手动设置封面时，第一张图片即为封面
    const defaultCoverName = !coverFileName
      ? files.find((f) => isImageByName(f.name))?.name ?? null
      : null
    const defaultCoverIsMoved = defaultCoverName ? movedFileNames.has(defaultCoverName) : false

    if (coverIsMoved || defaultCoverIsMoved) {
      // 封面被转移，需要更新封面设置
      const remainingImages = files.filter(
        (f) => !selectedPaths.has(f.path) && isImageByName(f.name),
      )
      const newCoverName = remainingImages.length > 0 ? remainingImages[0].name : null
      try {
        const metaPath = `${ALBUM_BASE_DIR}/${albumName}/.album-meta.json`
        const existing = await getFileContent(metaPath)
        let meta: Record<string, unknown> = {}
        if (existing.content) {
          meta = JSON.parse(decodeURIComponent(escape(atob(existing.content))))
        }
        if (newCoverName) {
          meta.coverFile = newCoverName
        } else {
          delete meta.coverFile
        }
        const metaBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(meta))))
        await updateFile(metaPath, metaBase64, existing.sha, `更新封面为 ${newCoverName || '无'}`)
        setCoverFileName(newCoverName)
      } catch { /* 封面更新失败不影响主流程 */ }

      // 将新封面信息写入 sessionStorage，绕过 Gitee CDN 缓存，确保返回相册列表时立即生效
      try {
        const updates = JSON.parse(sessionStorage.getItem('myphotos_cover_updates') || '{}')
        updates[albumName] = newCoverName  // null 表示清除封面设置
        sessionStorage.setItem('myphotos_cover_updates', JSON.stringify(updates))
      } catch { /* 忽略 */ }
    }

    // 清除当前相册的 blob URL 缓存，确保返回相册列表时封面重新加载
    invalidateBlobCache(`${ALBUM_BASE_DIR}/${albumName}`)

    setIsMoving(false)
    if (failCount === 0) {
      showToast(`${successCount} 个文件转移成功`, 'success')
    } else {
      showToast(`转移完成：${successCount} 成功，${failCount} 失败`, 'error')
    }

    // 更新相册大小（核心资源 + 目录总占用）
    if (transferredCoreSize > 0 || transferredDirSize > 0) {
      const newCoreTotal = Math.max(0, albumTotalSize - transferredCoreSize)
      const newDirTotal = Math.max(0, albumTotalDirSize - transferredDirSize)
      setAlbumTotalSize(newCoreTotal)
      setAlbumTotalDirSize(newDirTotal)
      persistAlbumTotalSize(newCoreTotal, newDirTotal)
    }

    // 刷新文件列表
    loadFiles(false)
  }

  const setAsCover = async (file: RepoFile) => {
    const metaPath = `${ALBUM_BASE_DIR}/${albumName}/.album-meta.json`
    const metaContent = JSON.stringify({ coverFile: file.name })
    const metaBase64 = btoa(unescape(encodeURIComponent(metaContent)))

    // 乐观更新：立即切换五角星状态
    const prevCoverFileName = coverFileName
    setCoverFileName(file.name)

    try {
      // 检查文件是否已存在（已存在需用 updateFile + SHA）
      try {
        const existing = await getFileContent(metaPath)
        await updateFile(metaPath, metaBase64, existing.sha, `设置封面为 ${file.name}`)
      } catch {
        // 文件不存在，创建新文件
        await createFile(metaPath, metaBase64, `设置封面为 ${file.name}`)
      }
      showToast('封面设置成功', 'success')
    } catch (err: any) {
      // 操作失败，回滚封面状态
      setCoverFileName(prevCoverFileName)
      showToast(err?.message || '设置封面失败', 'error')
    }
  }

  // 灯箱
  const openLightbox = (index: number) => setLightboxIndex(index)
  const closeLightbox = () => setLightboxIndex(null)
  const lightboxPrev = () => { if (lightboxIndex !== null && lightboxIndex > 0) setLightboxIndex(lightboxIndex - 1) }
  const lightboxNext = () => { if (lightboxIndex !== null && lightboxIndex < files.length - 1) setLightboxIndex(lightboxIndex + 1) }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (lightboxIndex !== null) {
        if (e.key === 'ArrowLeft') lightboxPrev()
        else if (e.key === 'ArrowRight') lightboxNext()
        else if (e.key === 'Escape') closeLightbox()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [lightboxIndex])

  // 时间线分组
  const timelineGroups = () => {
    const groups: { label: string; files: RepoFile[] }[] = []
    const sorted = [...files].sort((a, b) => b.name.localeCompare(a.name))
    const grouped = new Map<string, RepoFile[]>()
    for (const file of sorted) {
      const key = file.name.charAt(0).toUpperCase()
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(file)
    }
    for (const [key, fs] of grouped) groups.push({ label: key, files: fs })
    return groups
  }

  const activeUploadCount = uploadTasks.filter((t) => t.status === 'uploading' || t.status === 'pending').length

  return (
    <div className="flex flex-col h-full">
      {/* ===== 顶部工具栏 ===== */}
      <div className="flex items-center gap-2.5 px-6 py-3 bg-white border-b border-[var(--color-border)] shrink-0 sticky top-0 z-20">
        <button onClick={() => navigate('/')} className="btn btn-ghost shrink-0">
          <IconArrowLeft size={16} />
          返回
        </button>

        <div className="flex-1 min-w-0 flex items-baseline gap-2.5 ml-1">
          <h1 className="text-[15px] font-bold text-slate-800 truncate">{displayName || albumName}</h1>
          <span className="text-xs text-slate-400 shrink-0">{files.length} 张</span>
        </div>

        {/* 右侧操作区 */}
        {!selectMode ? (
          <div className="flex items-center gap-2">
            {/* 视图切换 */}
            <button
              onClick={() => setViewMode(viewMode === 'grid' ? 'timeline' : 'grid')}
              className="btn btn-secondary btn-icon"
              title={viewMode === 'grid' ? '时间线视图' : '网格视图'}
            >
              {viewMode === 'grid' ? <IconList size={16} /> : <IconGrid size={16} />}
            </button>

            {/* 选择按钮 */}
            <button onClick={() => setSelectMode(true)} className="btn btn-secondary" disabled={isSyncing}>
              选择
            </button>

            {/* 上传按钮 */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn btn-primary"
              disabled={isSyncing}
            >
              <IconUpload size={15} />
              上传
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => selectedPaths.size === files.length ? deselectAll() : selectAll()}
              className="btn btn-ghost text-xs"
              disabled={isSyncing}
            >
              {selectedPaths.size === files.length && files.length > 0 ? '全不选' : '全选'}
            </button>
            <span className="text-xs text-slate-400 px-1">{selectedPaths.size}/{files.length}</span>
            <button
              onClick={downloadBatch}
              disabled={selectedPaths.size === 0}
              className="btn btn-secondary"
            >
              <IconDownload size={14} />
              下载
            </button>
            <button
              onClick={openMoveModal}
              disabled={selectedPaths.size === 0 || isSyncing}
              className="btn btn-secondary"
            >
              <IconMove size={14} />
              转移
            </button>
            <button
              onClick={deleteBatch}
              disabled={selectedPaths.size === 0 || isSyncing}
              className="btn btn-danger"
            >
              <IconTrash size={14} />
              删除
            </button>
            <button
              onClick={() => { setSelectMode(false); deselectAll() }}
              className="btn btn-primary"
            >
              取消
            </button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* ===== 同步进行中提示 ===== */}
      {isSyncing && (
        <div className="flex items-center gap-3 px-5 py-3 bg-amber-50 border-b border-amber-200/60 text-sm text-amber-700 shrink-0">
          <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin shrink-0" />
          相册目录名同步进行中，请在设置页等待完成后再操作
        </div>
      )}

      {/* ===== 上传进度 ===== */}
      {activeUploadCount > 0 && (
        <div className="bg-slate-50/80 border-b border-slate-200/50 px-5 py-3 space-y-2.5 shrink-0 max-h-48 overflow-y-auto">
          <p className="text-xs font-medium text-slate-500">正在上传 {activeUploadCount} 个文件</p>
          {uploadTasks.filter((t) => t.status !== 'done').map((task) => (
            <div key={task.id} className="flex items-center gap-3">
              <span className="text-xs text-slate-600 w-36 truncate">{task.file.name}</span>
              <div className="flex-1 progress-bar">
                <div
                  className={`progress-bar-fill ${task.status === 'error' ? 'bg-red-400' : 'bg-blue-500'}`}
                  style={{ width: `${task.progress}%` }}
                />
              </div>
              <span className={`text-xs w-12 text-right ${
                task.status === 'error' ? 'text-red-500' : 'text-slate-500'
              }`}>
                {task.status === 'error' ? '失败' : `${task.progress}%`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ===== 错误 ===== */}
      {error && (
        <div className="m-5 p-4 bg-red-50 border border-red-200/80 rounded-md">
          <div className="flex items-start gap-3">
            <IconAlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-red-700">{error}</p>
              <button onClick={() => loadFiles(true)} className="btn btn-ghost mt-1 text-red-600">重试</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 加载中 ===== */}
      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-400">加载中...</p>
          </div>
        </div>
      )}

      {/* ===== 空状态 ===== */}
      {!loading && !error && files.length === 0 && (
        <div
          className={`flex-1 flex flex-col items-center justify-center transition-colors ${isDragging ? 'bg-blue-50/80' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <div className={`w-24 h-24 rounded-3xl flex items-center justify-center mb-6 transition-colors ${
            isDragging ? 'bg-blue-100' : 'bg-slate-100'
          }`}>
            <IconUpload size={36} className={isDragging ? 'text-blue-400' : 'text-slate-300'} />
          </div>
          <h2 className="text-lg font-bold text-slate-700 mb-1.5">相册为空</h2>
          <p className="text-[13px] text-slate-400 mb-7">
            {isDragging ? '松开开始上传' : '拖拽文件到此处或点击上传按钮'}
          </p>
          <button onClick={() => fileInputRef.current?.click()} className="btn btn-primary">
            <IconPlus size={16} />
            上传照片
          </button>
        </div>
      )}

      {/* ===== 网格视图 ===== */}
      {!loading && files.length > 0 && viewMode === 'grid' && (
        <div
          className={`flex-1 overflow-auto p-5 transition-colors ${isDragging ? 'bg-blue-50/50' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2.5 sm:gap-3">
            {files.map((file, index) => (
              <div
                key={file.path}
                className={`relative aspect-square bg-slate-100 rounded-xl overflow-hidden cursor-pointer group transition-all duration-150 ${
                  selectMode && selectedPaths.has(file.path)
                    ? 'ring-2 ring-[var(--color-primary)] ring-offset-2'
                    : 'hover:shadow-lg hover:ring-1 hover:ring-slate-200'
                }`}
                onClick={() => {
                  if (selectMode) toggleSelect(file.path)
                  else openLightbox(index)
                }}
              >
                {/* 缩略图/视频 */}
                {isVideoByName(file.name) ? (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-slate-800">
                    <IconPlay size={32} className="text-white/80 mb-1" />
                    <span className="text-[10px] text-white/60 px-1 truncate max-w-full">{file.name}</span>
                  </div>
                ) : (
                  <img
                    src={blobUrls[file.path] || ''}
                    alt={file.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                )}

                {/* 选择标记 */}
                {selectMode && (
                  <div className={`absolute top-2 left-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-150 ${
                    selectedPaths.has(file.path)
                      ? 'bg-[var(--color-primary)] border-[var(--color-primary)]'
                      : 'border-white/80 bg-black/20 backdrop-blur-sm'
                  }`}>
                    {selectedPaths.has(file.path) && <IconCheck size={12} className="text-white" />}
                  </div>
                )}

                {/* 视频标记 */}
                {isVideoByName(file.name) && !selectMode && (
                  <div className="absolute bottom-1.5 left-1.5 bg-black/60 backdrop-blur-sm text-white text-[10px] px-1.5 py-0.5 rounded-md flex items-center gap-1">
                    <IconPlay size={10} />
                    视频
                  </div>
                )}

                {/* 悬停操作栏 */}
                {!selectMode && (
                  <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/50 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex justify-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); downloadSingle(file) }}
                      className="btn btn-icon"
                      style={{ padding: '6px', background: 'rgba(255,255,255,.2)', color: 'white', borderRadius: 'var(--radius-sm)' }}
                      title="下载"
                    >
                      <IconDownload size={14} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setAsCover(file) }}
                      className="btn btn-icon"
                      disabled={isSyncing}
                      style={{ padding: '6px', background: 'rgba(255,255,255,.2)', color: coverFileName === file.name ? '#fbbf24' : 'white', borderRadius: 'var(--radius-sm)' }}
                      title={coverFileName === file.name ? '当前封面' : '设为封面'}
                    >
                      {coverFileName === file.name ? <IconStarFilled size={14} /> : <IconStar size={14} />}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== 时间线视图 ===== */}
      {!loading && files.length > 0 && viewMode === 'timeline' && (
        <div className="flex-1 overflow-auto p-5">
          {timelineGroups().map((group) => (
            <div key={group.label} className="mb-6">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 sticky top-0 bg-slate-50/90 backdrop-blur-sm py-1.5 px-2 rounded-lg">
                {group.label}
              </h3>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2.5 sm:gap-3">
                {group.files.map((file) => {
                  const fileIndex = files.findIndex((f) => f.path === file.path)
                  return (
                    <div
                      key={file.path}
                      className="aspect-square bg-slate-100 rounded-xl overflow-hidden cursor-pointer hover:shadow-lg hover:ring-1 hover:ring-slate-200 transition-all duration-150"
                      onClick={() => openLightbox(fileIndex)}
                    >
                      <img
                        src={blobUrls[file.path] || ''}
                        alt={file.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ===== 转移相册弹窗 ===== */}
      {showMoveModal && (
        <div className="modal-overlay" onClick={() => !isMoving && setShowMoveModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-800">转移到相册</h2>
              <button onClick={() => setShowMoveModal(false)} disabled={isMoving} className="btn btn-ghost btn-icon">
                <IconX size={16} />
              </button>
            </div>

            <p className="text-[13px] text-slate-500 mb-3.5">
              将选中的 {selectedPaths.size} 张照片转移到：
            </p>

            {isLoadingMoveAlbums ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
                <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin" />
                加载相册列表中...
              </div>
            ) : moveAlbums.length === 0 ? (
              <div className="text-center py-6 text-sm text-slate-400">
                没有其他相册可选
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {moveAlbums.map((album) => (
                  <button
                    key={album.dirName}
                    disabled={isMoving}
                    onClick={() => handleMove(album.dirName)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-md border border-slate-200 hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)] transition-all duration-150 text-left disabled:opacity-50"
                  >
                    <IconFolder size={18} className="text-slate-400 shrink-0" />
                    <span className="text-[13.5px] font-medium text-slate-700 truncate">{album.name}</span>
                  </button>
                ))}
              </div>
            )}

            {isMoving && (
              <div className="mt-3 flex items-center gap-2 text-sm text-blue-500">
                <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                正在转移中...
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== 灯箱 ===== */}
      {lightboxIndex !== null && files[lightboxIndex] && (
        <div className="fixed inset-0 bg-black/95 z-50 flex flex-col" onClick={closeLightbox}>
          {/* 顶部信息栏 */}
          <div className="flex items-center justify-between px-5 py-3.5 text-white/80 text-sm shrink-0 bg-black/20 backdrop-blur-sm">
            <span className="font-medium">
              {lightboxIndex + 1} / {files.length}
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={(e) => { e.stopPropagation(); downloadSingle(files[lightboxIndex]) }}
                className="btn btn-ghost"
                style={{ color: 'rgba(255,255,255,.85)' }}
              >
                <IconDownload size={16} />
                下载
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setAsCover(files[lightboxIndex]) }}
                className="btn btn-ghost"
                disabled={isSyncing}
                style={{ color: coverFileName === files[lightboxIndex].name ? '#fbbf24' : 'rgba(255,255,255,.85)' }}
              >
                {coverFileName === files[lightboxIndex].name ? <IconStarFilled size={16} /> : <IconStar size={16} />}
                {coverFileName === files[lightboxIndex].name ? '当前封面' : '设为封面'}
              </button>
              <button
                onClick={closeLightbox}
                className="btn btn-ghost btn-icon"
                style={{ color: 'rgba(255,255,255,.85)' }}
              >
                <IconX size={20} />
              </button>
            </div>
          </div>

          {/* 内容 */}
          <div className="flex-1 flex items-center justify-center relative" onClick={(e) => e.stopPropagation()}>
            {lightboxIndex > 0 && (
              <button
                onClick={lightboxPrev}
                className="absolute left-4 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-full w-11 h-11 flex items-center justify-center border-none cursor-pointer transition-all duration-150 z-10 backdrop-blur-sm"
              >
                <IconChevronLeft size={24} />
              </button>
            )}

            {isVideoByName(files[lightboxIndex].name) ? (
              <video
                src={lightboxImageUrl}
                controls autoPlay
                className="max-w-full max-h-full"
              />
            ) : (
              <img
                src={lightboxImageUrl}
                alt={files[lightboxIndex].name}
                className="max-w-full max-h-full object-contain"
              />
            )}

            {lightboxIndex < files.length - 1 && (
              <button
                onClick={lightboxNext}
                className="absolute right-4 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-full w-11 h-11 flex items-center justify-center border-none cursor-pointer transition-all duration-150 z-10 backdrop-blur-sm"
              >
                <IconChevronRight size={24} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
