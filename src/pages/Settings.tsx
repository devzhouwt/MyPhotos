import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { saveConfig, getConfig, clearConfig, ALBUM_BASE_DIR } from '@/stores/config'
import { getContents, getAllFiles, getFileContent, createFile, updateFile, deleteFile, getRepoTree } from '@/services/gitee'
import { isThumbnailFile } from '@/utils/thumbnail'
import { showToast } from '@/components/Toast'
import { IconArrowLeft, IconTrash, IconCheck, IconEye, IconEyeOff, IconChevronDown, IconAlertTriangle, IconRefreshCw } from '@/components/icons'
import type { GiteeConfig, Album } from '@/types'

interface SettingsProps {
  configured: boolean
  onConfigChange: (configured: boolean) => void
}

export default function Settings({ configured, onConfigChange }: SettingsProps) {
  const navigate = useNavigate()
  const [form, setForm] = useState<GiteeConfig>({
    owner: '',
    repo: '',
    branch: 'master',
    token: '',
  })
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [syncableAlbums, setSyncableAlbums] = useState<{ name: string; dirName: string }[]>([])
  const [syncProgress, setSyncProgress] = useState<{
    status: 'idle' | 'running' | 'done' | 'error'
    current: number
    total: number
    message: string
    detail: string
  } | null>(null)

  useEffect(() => {
    const existing = getConfig()
    if (existing) {
      // 不展示已保存的 token（但不清除存储中的 token）
      setForm({ owner: existing.owner, repo: existing.repo, branch: existing.branch || 'master', token: '' })
      // 如果分支不是默认值，自动展开高级设置
      if (existing.branch && existing.branch !== 'master') {
        setShowAdvanced(true)
      }
    }
  }, [])

  const handleSave = async () => {
    setError('')
    setSaved(false)

    if (!form.owner.trim() || !form.repo.trim()) {
      setError('请填写仓库所有者与仓库名')
      return
    }
    if (form.owner.includes('/')) {
      setError('仓库所有者格式不正确，应为单个用户名')
      return
    }

    // 如果令牌未填写但之前已保存过，复用已有令牌
    const existing = getConfig()
    const token = form.token.trim() || existing?.token || ''
    if (!token) {
      setError('请填写私人访问令牌')
      return
    }
    const configToSave = { ...form, token }

    saveConfig(configToSave)
    onConfigChange(true)
    setSaved(true)
    showToast('配置已保存，正在加载相册…', 'success')

    // 立即跳转，不等待预加载
    navigate('/')

    // 后台预加载相册数据，AlbumList 可通过 sessionStorage 直接使用
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
          albumList.push({ name: dir.name, dirName: dir.name, coverUrl: null, fileCount: mediaFiles.length, totalSizeBytes: 0, totalDirSizeBytes: 0, files: mediaFiles })
        } catch {
          albumList.push({ name: dir.name, dirName: dir.name, coverUrl: null, fileCount: 0, totalSizeBytes: 0, totalDirSizeBytes: 0, files: [] })
        }
      }
      sessionStorage.setItem('myphotos_preloaded_albums', JSON.stringify(albumList))
    } catch {
      // 预加载失败不影响使用，AlbumList 会自行加载
    }
  }

  const handleClear = () => {
    if (window.confirm('确定要清除配置吗？清除后需要重新配置才能使用。')) {
      clearConfig()
      onConfigChange(false)
      setForm({ owner: '', repo: '', branch: 'master', token: '' })
      setError('')
      setSaved(false)
      showToast('配置已清除', 'info')
    }
  }

  /** 加载需要同步的相册（目录名 ≠ 显示名） */
  const loadSyncableAlbums = async () => {
    try {
      const contents = await getContents(ALBUM_BASE_DIR)
      const dirs = contents.filter((item) => item.type === 'dir')
      const list: { name: string; dirName: string }[] = []
      for (const dir of dirs) {
        try {
          const files = await getContents(dir.path)
          const metaFile = files.find((f) => f.name === '.album-meta.json')
          if (metaFile) {
            const metaInfo = await getFileContent(metaFile.path)
            if (metaInfo.content) {
              const meta = JSON.parse(decodeURIComponent(escape(atob(metaInfo.content))))
              if (meta.displayName && meta.displayName !== dir.name) {
                list.push({ name: meta.displayName, dirName: dir.name })
              }
            }
          }
        } catch { /* 忽略 */ }
      }
      setSyncableAlbums(list)
    } catch { /* 忽略 */ }
  }

  useEffect(() => {
    if (configured) loadSyncableAlbums()
  }, [configured])

  /** 执行目录名同步：将旧目录所有文件迁移到新目录（显示名） */
  const handleSync = async () => {
    if (syncProgress?.status === 'running') return
    if (syncableAlbums.length === 0) return

    const totalAlbums = syncableAlbums.length
    sessionStorage.setItem('myphotos_syncing', 'true')
    setSyncProgress({ status: 'running', current: 0, total: totalAlbums, message: '开始同步...', detail: '' })

    let successCount = 0
    let failCount = 0

    for (let i = 0; i < syncableAlbums.length; i++) {
      const album = syncableAlbums[i]
      const oldPath = `${ALBUM_BASE_DIR}/${album.dirName}`
      const newPath = `${ALBUM_BASE_DIR}/${album.name}`

      setSyncProgress({
        status: 'running', current: i, total: totalAlbums,
        message: `正在同步「${album.name}」(${i + 1}/${totalAlbums})`,
        detail: '读取文件列表...',
      })

      try {
        const allFiles = await getAllFiles(oldPath)
        const totalFiles = allFiles.length
        let mediaTotalSize = 0
        let dirTotalSize = 0

        // 通过 Git Trees API 一次性获取所有文件的准确大小
        const treeNodes = await getRepoTree()
        const sizeMap = new Map<string, number>()
        for (const node of treeNodes) {
          if (node.type === 'blob' && node.path.startsWith(oldPath + '/') && node.size != null) {
            sizeMap.set(node.path, node.size)
          }
        }

        // 1. 在新目录创建所有文件（如目标已存在则覆盖）
        for (let j = 0; j < allFiles.length; j++) {
          const file = allFiles[j]
          const relativePath = file.path.substring(oldPath.length + 1)
          const newFilePath = `${newPath}/${relativePath}`

          setSyncProgress({
            status: 'running', current: i, total: totalAlbums,
            message: `「${album.name}」 ${i + 1}/${totalAlbums}`,
            detail: `读取 ${relativePath} (${j + 1}/${totalFiles})`,
          })

          // 必须先读取文件实际内容（getContents 返回的列表不含 content 字段）
          const fileInfo = await getFileContent(file.path)
          const content = fileInfo.content || ''
          // 使用 Git Trees API 的准确大小，而非 base64 反推
          const fileSize = sizeMap.get(file.path) ?? 0
          dirTotalSize += fileSize

          // 累加核心资源大小（排除缩略图和元数据文件）
          if (file.name !== '.gitkeep' && file.name !== '.album-meta.json' && !isThumbnailFile(file.name)) {
            mediaTotalSize += fileSize
          }

          setSyncProgress({
            status: 'running', current: i, total: totalAlbums,
            message: `「${album.name}」 ${i + 1}/${totalAlbums}`,
            detail: `创建 ${relativePath} (${j + 1}/${totalFiles})`,
          })

          try {
            await createFile(newFilePath, content, `同步 ${file.path}`)
          } catch {
            // 文件已存在（目标目录可能已部分存在），用 updateFile 覆盖
            const existing = await getFileContent(newFilePath)
            await updateFile(newFilePath, content, existing.sha, `覆盖同步 ${file.path}`)
          }
        }

        // 2. 删除旧目录所有文件
        for (let j = 0; j < allFiles.length; j++) {
          const file = allFiles[j]
          setSyncProgress({
            status: 'running', current: i, total: totalAlbums,
            message: `「${album.name}」 ${i + 1}/${totalAlbums}`,
            detail: `删除旧文件 ${file.name} (${j + 1}/${totalFiles})`,
          })
          await deleteFile(file.path, file.sha, `删除旧目录文件 ${file.path}`)
        }

        // 3. 校准新目录的相册空间大小（顺便修正增量更新可能产生的累计误差）
        try {
          const metaPath = `${newPath}/.album-meta.json`
          let meta: Record<string, unknown> = {}
          let metaSha: string | undefined
          try {
            const existing = await getFileContent(metaPath)
            metaSha = existing.sha
            if (existing.content) {
              meta = JSON.parse(decodeURIComponent(escape(atob(existing.content))))
            }
          } catch { /* 元数据文件不存在 */ }
          meta.totalSizeBytes = mediaTotalSize
          meta.totalDirSizeBytes = dirTotalSize
          const metaBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(meta))))
          if (metaSha) {
            await updateFile(metaPath, metaBase64, metaSha, '校准相册空间大小')
          } else {
            await createFile(metaPath, metaBase64, '校准相册空间大小')
          }
        } catch { /* 校准失败不影响主流程 */ }

        successCount++
      } catch (err: any) {
        failCount++
        showToast(`同步「${album.name}」失败: ${err?.message}`, 'error')
      }
    }

    if (failCount === 0) {
      setSyncProgress({
        status: 'done', current: totalAlbums, total: totalAlbums,
        message: `全部同步完成（${successCount} 个相册）`, detail: '',
      })
      showToast(`${successCount} 个相册目录名同步完成`, 'success')
      loadSyncableAlbums()
    } else {
      setSyncProgress({
        status: 'error', current: totalAlbums, total: totalAlbums,
        message: `同步完成：${successCount} 成功，${failCount} 失败`, detail: '',
      })
    }

    sessionStorage.removeItem('myphotos_syncing')
    setTimeout(() => setSyncProgress(null), 5000)
  }

  return (
    <div className="min-h-full flex flex-col items-center px-5 py-8 sm:py-12">
      <div className="w-full max-w-[520px]">
        {/* 品牌标识区（首次配置时显示） */}
        {!configured && (
          <div className="text-center mb-8">
            <h1 className="text-xl font-bold text-slate-800">云相册</h1>
            <p className="text-xs text-slate-400 mt-2">将 Gitee 仓库作为个人云端相册</p>
          </div>
        )}

        {/* 已配置时显示返回按钮 */}
        {configured && (
          <div className="mb-6">
            <button onClick={() => navigate('/')} className="btn btn-ghost" disabled={syncProgress?.status === 'running'}>
              <IconArrowLeft size={16} />
              返回
            </button>
          </div>
        )}

        {/* 配置表单卡片 */}
        <div className="bg-white rounded-md border border-[var(--color-border-light)] p-6">
          <div className="mb-6">
            <h2 className="text-base font-bold text-slate-800">
              {configured ? '仓库配置' : '连接 Gitee 仓库'}
            </h2>
            <p className="text-xs text-slate-400 mt-1.5">
              {configured
                ? '修改 Gitee 仓库连接信息，数据即时生效'
                : '配置仅保存在浏览器本地，完全由你掌控'
              }
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">仓库所有者</label>
              <input
                type="text"
                value={form.owner}
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
                placeholder="your-username"
                className="input"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">仓库名</label>
              <input
                type="text"
                value={form.repo}
                onChange={(e) => setForm({ ...form, repo: e.target.value })}
                placeholder="my-photos-data"
                className="input"
              />
            </div>

            {/* 高级设置折叠区 */}
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
              >
                <IconChevronDown size={12} className={`transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`} />
                高级设置
              </button>
              {showAdvanced && (
                <div className="mt-3">
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">分支</label>
                  <input
                    type="text"
                    value={form.branch}
                    onChange={(e) => setForm({ ...form, branch: e.target.value })}
                    placeholder="master"
                    className="input"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">访问令牌</label>
              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={form.token}
                  onChange={(e) => setForm({ ...form, token: e.target.value })}
                  placeholder="Personal Access Token"
                  className="input pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label={showToken ? '隐藏令牌' : '显示令牌'}
                >
                  {showToken ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                前往 Gitee 设置 → 私人令牌 生成，需授予仓库读写权限
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-100 rounded-md text-sm text-red-600">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                {error}
              </div>
            )}

            {saved && (
              <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-md text-sm text-emerald-600">
                <IconCheck size={16} />
                配置已保存，正在跳转…
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex items-center gap-3 pt-2">
              <button onClick={handleSave} className="btn btn-primary flex-1 py-2.5 text-sm">
                保存配置
              </button>
              {configured && (
                <button
                  onClick={handleClear}
                  className="btn btn-ghost btn-icon text-slate-400 hover:text-red-500"
                  title="清除配置"
                >
                  <IconTrash size={14} />
                </button>
              )}
            </div>
          </div>

          {/* 底部说明 */}
          <p className="text-center text-xs text-slate-400 mt-5">配置保存在浏览器本地存储中</p>
        </div>

        {/* 目录名同步区域（仅已配置时显示） */}
        {configured && (
          <div className="mt-6 p-5 bg-white rounded-md border border-[var(--color-border-light)]">
            <div className="flex items-center gap-3 mb-3">
              <IconRefreshCw size={16} className="text-[var(--color-primary)] shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-slate-800">目录名同步</h3>
                <p className="text-xs text-slate-500 mt-0.5">将相册目录名更新为与展示名一致</p>
              </div>
              {syncableAlbums.length > 0 && (
                <span className="ml-auto px-2.5 py-1 text-xs font-semibold text-white bg-[var(--color-primary)] rounded-full">
                  {syncableAlbums.length} 个待同步
                </span>
              )}
            </div>

            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              同步过程会将旧目录所有文件迁移到新目录，期间请勿进行其他操作。
            </p>

            {syncableAlbums.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50/80 rounded-md px-4 py-3 border border-emerald-100">
                <IconCheck size={14} className="shrink-0" />
                所有相册目录名已与展示名一致，无需同步
              </div>
            ) : (
              <>
                <div className="space-y-1.5 mb-4 bg-slate-50 rounded-md p-3.5 border border-slate-100">
                  {syncableAlbums.map((album) => (
                    <div key={album.dirName} className="flex items-center gap-2 text-xs">
                      <span className="text-slate-400 line-through">{album.dirName}</span>
                      <span className="text-blue-400">→</span>
                      <span className="text-slate-700 font-semibold">{album.name}</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleSync}
                  disabled={syncProgress?.status === 'running'}
                  className="btn btn-primary w-full text-sm"
                >
                  {syncProgress?.status === 'running' ? '同步中...' : `立即同步 ${syncableAlbums.length} 个相册`}
                </button>
              </>
            )}

            {syncProgress && (
              <div className={`mt-4 p-4 rounded-md border text-sm ${
                syncProgress.status === 'error'
                  ? 'bg-red-50 border-red-200'
                  : syncProgress.status === 'done'
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-white/80 border-blue-200'
              }`}>
                <div className="flex items-center gap-2">
                  {syncProgress.status === 'running' && (
                    <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
                  )}
                  {syncProgress.status === 'error' && (
                    <IconAlertTriangle size={14} className="text-red-500 shrink-0" />
                  )}
                  {syncProgress.status === 'done' && (
                    <IconCheck size={14} className="text-emerald-500 shrink-0" />
                  )}
                  <span className={
                    syncProgress.status === 'error' ? 'text-red-700' :
                    syncProgress.status === 'done' ? 'text-emerald-700' : 'text-blue-700'
                  }>
                    {syncProgress.message}
                  </span>
                </div>
                {syncProgress.status === 'running' && syncProgress.detail && (
                  <p className="text-xs text-blue-500 mt-1 truncate">{syncProgress.detail}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
