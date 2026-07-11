import { getConfig } from '@/stores/config'
import type { RepoFile, TreeNode, GiteeApiError } from '@/types'

const BASE_URL = 'https://gitee.com/api/v5'

function getApiBase(): string {
  const config = getConfig()
  if (!config) throw new Error('未配置 Gitee 仓库信息')
  return `${BASE_URL}/repos/${config.owner}/${config.repo}`
}

export function getAuthHeaders(): Record<string, string> {
  const config = getConfig()
  if (!config?.token) throw new Error('未配置 Gitee Token')
  return {
    'Content-Type': 'application/json',
  }
}

/**
 * 获取带 access_token 的 URL（Gitee API v5 要求通过查询参数传递 token）
 */
function withToken(url: string): string {
  const token = getConfig()?.token
  if (!token) throw new Error('未配置 Gitee Token')
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}access_token=${token}`
}

/**
 * 编码文件路径用于 URL，分段编码保留 / 分隔符
 * 防止 / 被编码为 %2F 导致服务端路由失败
 */
function encodePath(filePath: string): string {
  return filePath.split('/').map(encodeURIComponent).join('/')
}

/**
 * 获取文件的原始访问 URL（可用于 img/video 标签直接加载）
 * Gitee Raw 格式: https://gitee.com/{owner}/{repo}/raw/{branch}/{path}
 * 通过 access_token 参数传递认证，支持私有仓库
 */
export function getRawUrl(filePath: string): string {
  const config = getConfig()
  if (!config) throw new Error('未配置')
  const encoded = encodePath(filePath)
  return `https://gitee.com/${config.owner}/${config.repo}/raw/${config.branch}/${encoded}?access_token=${config.token}`
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    throw { code: 401, message: 'Token 无效或已过期，请重新配置' } as GiteeApiError
  }
  if (response.status === 429) {
    throw { code: 429, message: 'API 请求过于频繁，请稍后再试' } as GiteeApiError
  }
  if (!response.ok) {
    let errorMsg = `请求失败 (${response.status})`
    try {
      const body = await response.json()
      errorMsg = body.message || body.error || errorMsg
    } catch {
      // 响应体非 JSON，使用默认消息
    }
    throw { code: response.status, message: errorMsg } as GiteeApiError
  }

  // 处理成功响应：检查是否为 JSON 响应，避免空 body 导致 SyntaxError
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return response.json()
  }
  // 非 JSON 响应（如 204 No Content）直接返回 undefined
  return undefined as unknown as T
}

/**
 * 获取仓库目录树（使用 trees API，可递归获取）
 */
export async function getRepoTree(path?: string): Promise<TreeNode[]> {
  const config = getConfig()
  if (!config) throw new Error('未配置')

  const url = `${getApiBase()}/git/trees/${config.branch}${path ? '?recursive=1' : '?recursive=1'}`
  const response = await fetch(withToken(url))
  const data = await handleResponse<{ tree: TreeNode[] }>(response)

  // 如果指定了 path，过滤出该目录下的直接子节点
  if (path) {
    const prefix = path.endsWith('/') ? path : path + '/'
    return data.tree.filter(
      (node) =>
        node.path.startsWith(prefix) &&
        node.path !== prefix &&
        !node.path.substring(prefix.length).includes('/'),
    )
  }

  return data.tree
}

/**
 * 获取目录下的文件列表
 */
export async function getContents(path?: string): Promise<RepoFile[]> {
  const url = path
    ? `${getApiBase()}/contents/${encodePath(path)}`
    : `${getApiBase()}/contents/`

  // 添加时间戳绕过 Gitee CDN 缓存
  const response = await fetch(withToken(`${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`), { cache: 'no-store' })
  return handleResponse<RepoFile[]>(response)
}

/**
 * 获取单个文件内容
 */
export async function getFileContent(filePath: string): Promise<RepoFile> {
  const url = `${getApiBase()}/contents/${encodePath(filePath)}`
  // 添加时间戳绕过 Gitee CDN 缓存
  const response = await fetch(withToken(`${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`), { cache: 'no-store' })
  const data = await handleResponse<RepoFile>(response)
  // Gitee Contents API 不返回 size 字段，从 base64 content 反推文件大小
  if (data && !data.size && data.content && data.encoding === 'base64') {
    const len = data.content.length
    const padding = data.content.endsWith('==') ? 2 : data.content.endsWith('=') ? 1 : 0
    data.size = Math.max(0, Math.floor(len * 3 / 4) - padding)
  }
  return data
}

/**
 * 获取文件大小（字节）
 * 通过 Contents API 获取 base64 content 后反推，不依赖 size 字段
 */
export async function getFileSize(filePath: string): Promise<number> {
  try {
    const info = await getFileContent(filePath)
    return info.size ?? 0
  } catch {
    return 0
  }
}

/**
 * 创建/上传文件
 * content 需为 Base64 编码；为空时自动填充占位内容
 */
export async function createFile(filePath: string, content: string, message?: string): Promise<void> {
  const url = `${getApiBase()}/contents/${encodePath(filePath)}`
  // Gitee API 不允许 content 为空——填充一个换行符作为占位
  const safeContent = content || btoa('\n')
  const body = JSON.stringify({
    access_token: getConfig()?.token,
    content: safeContent,
    message: message || `上传 ${filePath}`,
    branch: getConfig()?.branch,
  })
  const response = await fetch(url, {
    method: 'POST',
    headers: getAuthHeaders(),
    body,
  })
  await handleResponse(response)
}

/**
 * 更新文件（需要提供原始文件的 SHA）
 */
export async function updateFile(
  filePath: string,
  content: string,
  sha: string,
  message?: string,
): Promise<void> {
  const url = `${getApiBase()}/contents/${encodePath(filePath)}`
  const body = JSON.stringify({
    access_token: getConfig()?.token,
    content,
    sha,
    message: message || `更新 ${filePath}`,
    branch: getConfig()?.branch,
  })
  const response = await fetch(url, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body,
  })
  await handleResponse(response)
}

/**
 * 删除文件
 */
export async function deleteFile(filePath: string, sha: string, message?: string): Promise<void> {
  const url = `${getApiBase()}/contents/${encodePath(filePath)}`
  const body = JSON.stringify({
    access_token: getConfig()?.token,
    sha,
    message: message || `删除 ${filePath}`,
    branch: getConfig()?.branch,
  })
  const response = await fetch(url, {
    method: 'DELETE',
    headers: getAuthHeaders(),
    body,
  })
  await handleResponse(response)
}

/**
 * 使用 XMLHttpRequest 上传文件（支持进度回调）
 */
export function uploadFileWithProgress(
  filePath: string,
  content: string,
  onProgress: (progress: number) => void,
  message?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const config = getConfig()
    if (!config) {
      reject(new Error('未配置'))
      return
    }

    const xhr = new XMLHttpRequest()
    const url = `${getApiBase()}/contents/${encodePath(filePath)}`

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        try {
          const body = JSON.parse(xhr.responseText)
          reject({ code: xhr.status, message: body.message || '上传失败' } as GiteeApiError)
        } catch {
          reject({ code: xhr.status, message: `上传失败 (${xhr.status})` } as GiteeApiError)
        }
      }
    })

    xhr.addEventListener('error', () => {
      reject({ code: 0, message: '网络错误' } as GiteeApiError)
    })

    xhr.addEventListener('abort', () => {
      reject({ code: 0, message: '上传已取消' } as GiteeApiError)
    })

    xhr.open('POST', url)
    xhr.setRequestHeader('Authorization', `Bearer ${config.token}`)
    xhr.setRequestHeader('Content-Type', 'application/json')

    const body = JSON.stringify({
      access_token: config.token,
      content,
      message: message || `上传 ${filePath}`,
      branch: config.branch,
    })

    xhr.send(body)
  })
}

/**
 * 将文件读取为 Base64 字符串
 */
export function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // 去掉 "data:xxx;base64," 前缀
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

/**
 * 通过 Contents API 获取图片的 Blob URL（base64 → blob）
 * 用于 <img> 标签加载，解决 raw 端点对私有仓库图片加载失败的问题
 */
const blobUrlCache = new Map<string, string>()

export async function getImageBlobUrl(filePath: string): Promise<string> {
  const cached = blobUrlCache.get(filePath)
  if (cached) return cached

  const config = getConfig()
  if (!config) throw new Error('未配置')

  // 添加时间戳绕过 Gitee CDN 缓存
  const url = `${getApiBase()}/contents/${encodePath(filePath)}?ref=${config.branch}&_t=${Date.now()}`
  const response = await fetch(withToken(url), { cache: 'no-store' })

  if (!response.ok) {
    throw { code: response.status, message: `获取图片失败 (${response.status})` } as GiteeApiError
  }

  const data = await response.json()
  if (!data.content) {
    throw { code: 0, message: '图片内容为空' } as GiteeApiError
  }

  // base64 → binary → blob → blob URL
  const binary = atob(data.content)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  const ext = filePath.split('.').pop()?.toLowerCase() || 'jpg'
  const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }
  const mime = mimeMap[ext] || 'application/octet-stream'

  const blob = new Blob([bytes], { type: mime })
  const blobUrl = URL.createObjectURL(blob)
  blobUrlCache.set(filePath, blobUrl)
  return blobUrl
}

/**
 * 清除指定目录下的所有 blob URL 缓存
 * 用于转移/删除照片后，确保封面等图片重新加载
 */
export function invalidateBlobCache(dirPath: string) {
  const prefix = dirPath + '/'
  for (const key of blobUrlCache.keys()) {
    if (key.startsWith(prefix)) {
      blobUrlCache.delete(key)
    }
  }
}

/**
 * 递归获取目录下所有文件
 */
export async function getAllFiles(dirPath: string): Promise<RepoFile[]> {
  const result: RepoFile[] = []
  const contents = await getContents(dirPath)

  for (const item of contents) {
    if (item.type === 'dir') {
      const subFiles = await getAllFiles(item.path)
      result.push(...subFiles)
    } else {
      result.push(item)
    }
  }

  return result
}
