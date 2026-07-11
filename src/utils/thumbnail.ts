/**
 * 使用 Canvas API 生成缩略图 Blob
 * @param file 原始图片文件
 * @param maxWidth 缩略图最大宽度，默认 300px
 * @returns 缩略图 Blob (JPEG 格式)
 */
export function generateThumbnail(file: File, maxWidth = 300): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      const ratio = maxWidth / img.width
      canvas.width = maxWidth
      canvas.height = Math.round(img.height * ratio)

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('无法创建 Canvas 上下文'))
        return
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('缩略图生成失败'))
          }
        },
        'image/jpeg',
        0.7,
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片加载失败'))
    }

    img.src = url
  })
}

/**
 * 获取缩略图文件名（命名规则：原名.thumb.jpg）
 */
export function getThumbnailName(originalName: string): string {
  const dotIndex = originalName.lastIndexOf('.')
  const baseName = dotIndex > 0 ? originalName.substring(0, dotIndex) : originalName
  return `${baseName}.thumb.jpg`
}

/**
 * 判断是否为缩略图文件
 */
export function isThumbnailFile(filename: string): boolean {
  return filename.includes('.thumb.')
}
