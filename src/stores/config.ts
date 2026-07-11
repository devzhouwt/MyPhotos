import type { GiteeConfig } from '@/types'

const STORAGE_KEY = 'myphotos_config'

/** 相册在仓库中的根目录 */
export const ALBUM_BASE_DIR = '相册'

export function getConfig(): GiteeConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as GiteeConfig
  } catch {
    return null
  }
}

export function saveConfig(config: GiteeConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

export function clearConfig(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function hasConfig(): boolean {
  return getConfig() !== null
}
