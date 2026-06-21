import { useEffect, useState } from 'react'

type HealthStatus = 'checking' | 'ok' | 'down'

export function App() {
  const [status, setStatus] = useState<HealthStatus>('checking')

  useEffect(() => {
    let cancelled = false
    const baseUrl = import.meta.env.VITE_API_BASE_URL

    async function probe() {
      try {
        const res = await fetch(`${baseUrl}/health`)
        if (cancelled) return
        setStatus(res.ok ? 'ok' : 'down')
      } catch {
        if (!cancelled) setStatus('down')
      }
    }

    void probe()
    return () => {
      cancelled = true
    }
  }, [])

  const dotClass =
    status === 'ok'
      ? 'bg-green-500'
      : status === 'down'
        ? 'bg-red-500'
        : 'bg-gray-400'

  const label =
    status === 'ok' ? 'API: ok' : status === 'down' ? 'API: down' : 'API: checking'

  return (
    <main className="min-h-screen p-8">
      <h1>Slykboard</h1>
      <div
        className="mt-4 flex items-center gap-2"
        role="status"
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          className={`inline-block h-3 w-3 rounded-full ${dotClass}`}
        />
        <span>{label}</span>
      </div>
    </main>
  )
}
