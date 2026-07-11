import { useEffect, useState } from 'react'
import { IconSuccess, IconAlertTriangle, IconInfo, IconX } from '@/components/icons'

interface ToastMessage {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

let toastId = 0
let addToast: ((msg: Omit<ToastMessage, 'id'>) => void) | null = null

export function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  if (addToast) {
    addToast({ message, type })
  }
}

const iconMap = {
  success: IconSuccess,
  error: IconAlertTriangle,
  info: IconInfo,
}

const styleMap = {
  success: 'bg-emerald-50/95 border-emerald-200/80 text-emerald-800',
  error: 'bg-red-50/95 border-red-200/80 text-red-800',
  info: 'bg-blue-50/95 border-blue-200/80 text-blue-800',
}

const iconColorMap = {
  success: 'text-emerald-500',
  error: 'text-red-500',
  info: 'text-blue-500',
}

export default function ToastContainer() {
  const [messages, setMessages] = useState<ToastMessage[]>([])

  useEffect(() => {
    addToast = (msg) => {
      const id = ++toastId
      setMessages((prev) => [...prev, { ...msg, id }])
      setTimeout(() => {
        setMessages((prev) => prev.filter((m) => m.id !== id))
      }, 3000)
    }
    return () => {
      addToast = null
    }
  }, [])

  if (messages.length === 0) return null

  return (
    <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2.5" style={{ maxWidth: 380, width: '90vw' }}>
      {messages.map((msg) => {
        const Icon = iconMap[msg.type]
        return (
          <div
            key={msg.id}
            className={`flex items-center gap-3 px-5 py-3.5 rounded-2xl border shadow-lg text-sm backdrop-blur-sm ${styleMap[msg.type]}`}
            style={{ animation: 'slideInDown .3s cubic-bezier(.16,1,.3,1)' }}
          >
            <Icon size={18} className={iconColorMap[msg.type]} />
            <span className="flex-1 leading-snug font-medium">{msg.message}</span>
            <button
              onClick={() => setMessages((prev) => prev.filter((m) => m.id !== msg.id))}
              className="shrink-0 p-1 rounded-full hover:bg-black/8 transition-colors cursor-pointer border-none bg-transparent"
            >
              <IconX size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
