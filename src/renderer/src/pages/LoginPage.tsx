import { useState } from 'react'
import type { SessionUser } from '@shared/schemas'

interface Props {
  onLogin: (user: SessionUser) => void
}

/** Module 1 — Login with username + password. */
export default function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const result = await window.api.authLogin({ username, password })
    setLoading(false)

    if (result.ok) {
      onLogin(result.data)
    } else {
      setError(result.error.message)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-gray-900 rounded-2xl shadow-2xl p-10 w-full max-w-sm border border-gray-800">
        <h1 className="text-2xl font-bold text-brand-400 mb-1">Saqib POS</h1>
        <p className="text-gray-500 text-sm mb-8">Photo State — Sign in to continue</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            id="login-username"
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <input
            id="login-password"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />

          {error && (
            <p id="login-error" className="text-red-400 text-xs">{error}</p>
          )}

          <button
            id="login-submit"
            type="submit"
            disabled={loading}
            className="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-50 transition-colors text-white font-semibold rounded-lg py-2.5 text-sm"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
