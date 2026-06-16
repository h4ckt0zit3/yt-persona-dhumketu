import { useEffect, useRef } from 'react'

// Run `fn` immediately, then on an interval — but PAUSE while the browser tab
// is hidden, and fire once immediately when it becomes visible again. Keeps
// background tabs from hammering the (free-tier) database forever. `fn` is held
// in a ref so callers don't need to memoize it to avoid resetting the timer.
export function usePolledEffect(fn: () => void, intervalMs: number, enabled = true) {
  const saved = useRef(fn)
  saved.current = fn

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setInterval> | undefined

    const run = () => saved.current()
    const start = () => {
      if (timer) return
      run()
      timer = setInterval(run, intervalMs)
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = undefined
    }
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop())

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs, enabled])
}
