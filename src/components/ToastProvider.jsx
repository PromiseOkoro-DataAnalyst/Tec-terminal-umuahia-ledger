import { useCallback, useState } from 'react'
import { ToastContext } from './toast'
import Icon from './Icon'

export default function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const toast = useCallback((text, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((list) => [...list, { id, text, tone }])
    setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), tone === 'error' ? 6000 : 3200)
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`toast toast-${item.tone}`}>
            <Icon name={item.tone === 'error' ? 'close' : 'check'} size={16} />
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
