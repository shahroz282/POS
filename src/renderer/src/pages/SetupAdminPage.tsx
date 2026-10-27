import { useState } from 'react'
import type { SessionUser } from '@shared/schemas'

interface Props {
  onSetupComplete: (user: SessionUser) => void
}

/** First-run: create the initial Admin account. No default password. */
export default function SetupAdminPage({ onSetupComplete }: Props) {
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setLoading(true)
    const result = await window.api.authSetupAdmin({ name, username, password })
    setLoading(false)

    if (result.ok) {
      onSetupComplete(result.data)
    } else {
      setError(result.error.message)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-gray-900 rounded-2xl shadow-2xl p-10 w-full max-w-sm border border-gray-800">
        <h1 className="text-2xl font-bold text-brand-400 mb-1">Welcome to Saqib POS</h1>
        <p className="text-gray-500 text-sm mb-6">Create your Admin account to get started</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            id="setup-name"
            type="text"
            placeholder="Full Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <input
            id="setup-username"
            type="text"
            placeholder="Username (min 3 chars)"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <input
            id="setup-password"
            type="password"
            placeholder="Password (min 6 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <input
            id="setup-confirm-password"
            type="password"
            placeholder="Confirm Password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />

          {error && (
            <p id="setup-error" className="text-red-400 text-xs">{error}</p>
          )}

          <button
            id="setup-submit"
            type="submit"
            disabled={loading}
            className="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-50 transition-colors text-white font-semibold rounded-lg py-2.5 text-sm"
          >
            {loading ? 'Creating…' : 'Create Admin Account'}
          </button>
        </form>

        <p className="mt-6 text-xs text-gray-600 text-center">
          This account will have full access to the system
        </p>
      </div>
    </div>
  )
}
