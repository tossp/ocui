import { useEffect, useState } from 'react'

export function useDelayedRender(show: boolean, delayMs: number = 320): boolean {
  const [shouldRender, setShouldRender] = useState(show)

  useEffect(() => {
    if (show) {
      setShouldRender(true)
      return
    }

    const timer = setTimeout(() => setShouldRender(false), delayMs)
    return () => clearTimeout(timer)
  }, [show, delayMs])

  return shouldRender
}
