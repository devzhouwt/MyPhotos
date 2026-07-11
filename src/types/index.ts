/** Gitee 仓库配置 */
export interface GiteeConfig {
  owner: string
  repo: string
  branch: string
  token: string
}

/** 相册元数据（存储在 .album-meta.json 中） */
export interface AlbumMeta {
  coverFile?: string
  displayName?: string
  order?: 'name' | 'date'
  /** 核心资源大小（字节）：仅用户可见的照片文件，不含缩略图/元数据 */
  totalSizeBytes?: number
  /** 目录总占用空间（字节）：包含缩略图、元数据等所有文件 */
  totalDirSizeBytes?: number
}

/** 仓库中的文件信息 */
export interface RepoFile {
  name: string
  path: string
  sha: string
  type: 'file' | 'dir'
  size?: number
  download_url?: string
  content?: string
  encoding?: string
}

/** 目录树中的节点 */
export interface TreeNode {
  path: string
  type: 'tree' | 'blob'
  sha: string
  /** 文件大小（字节），仅 blob 节点有值 */
  size?: number
}

/** 相册 */
export interface Album {
  /** 显示名称（来自 .album-meta.json，回退为目录名） */
  name: string
  /** 目录名（不可变 ID，用于 API 路径和路由） */
  dirName: string
  coverUrl: string | null
  fileCount: number
  /** 核心资源大小（字节）：仅用户可见的照片 */
  totalSizeBytes: number
  /** 目录总占用空间（字节）：包含缩略图等所有文件 */
  totalDirSizeBytes: number
  files: RepoFile[]
}

/** 上传任务状态 */
export type UploadStatus = 'pending' | 'uploading' | 'done' | 'error' | 'cancelled'

/** 上传任务 */
export interface UploadTask {
  id: string
  file: File
  albumName: string
  status: UploadStatus
  progress: number
  error?: string
}

/** Gitee API 错误 */
export interface GiteeApiError {
  code: number
  message: string
}

/** 批量操作状态 */
export type BatchStatus = 'idle' | 'running' | 'paused' | 'done' | 'error'

export interface BatchProgress {
  status: BatchStatus
  currentBatch: number
  totalBatches: number
  currentFile: number
  totalFiles: number
  message: string
}
