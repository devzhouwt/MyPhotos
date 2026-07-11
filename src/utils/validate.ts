/** 支持的图片格式 */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
/** 支持的视频格式 */
const VIDEO_TYPES = ['video/mp4', 'video/quicktime']
/** 支持的文件扩展名 */
const VALID_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov']

/** 最大单文件大小 20MB */
export const MAX_FILE_SIZE = 20 * 1024 * 1024
/** 每个相册最多 500 张 */
export const MAX_ALBUM_FILES = 500

export interface ValidationResult {
  valid: boolean
  error?: string
}

/**
 * 校验文件类型是否支持
 */
export function validateFileType(file: File): ValidationResult {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase()
  if (!VALID_EXTENSIONS.includes(ext)) {
    return {
      valid: false,
      error: `不支持的文件格式（${ext}），支持：JPG、PNG、GIF、WebP、MP4、MOV`,
    }
  }
  const supportedMimes = [...IMAGE_TYPES, ...VIDEO_TYPES]
  if (!supportedMimes.includes(file.type)) {
    return { valid: false, error: `不支持的 MIME 类型：${file.type}` }
  }
  return { valid: true }
}

/**
 * 校验文件大小
 */
export function validateFileSize(file: File): ValidationResult {
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），限制 20MB 以内，请从 Gitee 页面上传`,
    }
  }
  return { valid: true }
}

/**
 * 判断是否为图片文件
 */
export function isImageFile(file: File): boolean {
  return IMAGE_TYPES.includes(file.type)
}

/**
 * 判断是否为视频文件
 */
export function isVideoFile(file: File): boolean {
  return VIDEO_TYPES.includes(file.type)
}
