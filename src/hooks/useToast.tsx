import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface ToastItem {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

interface ToastContextValue {
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} })

let toastId = 0
let globalSetToasts: ((updater: (prev: ToastItem[]) => ToastItem[]) => void) | null = null

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  globalSetToasts = setToasts as typeof globalSetToasts

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = ++toastId
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 3000)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

export function getGlobalToast(): ToastContextValue {
  return {
    showToast: (message, type) => {
      if (globalSetToasts) {
        const id = ++toastId
        globalSetToasts((prev) => [...prev, { id, message, type: type || 'info' }])
        setTimeout(() => {
          globalSetToasts?.((prev) => prev.filter((t) => t.id !== id))
        }, 3000)
      }
    },
  }
}
