import { useCallback, useEffect, useRef, useState } from 'react'

// Runs an async loader, keeps the last result, and exposes reload().
// The loader should throw on error (use `must()` around Supabase calls).
export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const latest = useRef(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(loader, deps)

  const reload = useCallback(async () => {
    const ticket = ++latest.current
    try {
      const data = await run()
      if (ticket === latest.current) setState({ data, error: null, loading: false })
    } catch (error) {
      if (ticket === latest.current) setState((previous) => ({ ...previous, error: error.message || String(error), loading: false }))
    }
  }, [run])

  useEffect(() => {
    reload()
  }, [reload])

  return { ...state, reload }
}

// Unwrap a Supabase response or throw its error
export const must = async (request) => {
  const { data, error } = await request
  if (error) throw error
  return data
}
