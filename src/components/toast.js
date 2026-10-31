import { createContext, useContext } from 'react'

export const ToastContext = createContext(() => {})
// toast('Lead added') or toast('Couldn’t save', 'error')
export const useToast = () => useContext(ToastContext)
