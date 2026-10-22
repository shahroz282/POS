interface Props {
  onLogin: () => void
}

/** Module 1 — Login. Placeholder until Phase 1 implements auth. */
export default function LoginPage({ onLogin }: Props) {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-gray-900 rounded-2xl shadow-2xl p-10 w-full max-w-sm border border-gray-800">
        <h1 className="text-2xl font-bold text-brand-400 mb-1">Saqib POS</h1>
        <p className="text-gray-500 text-sm mb-8">Photo State — Sign in to continue</p>

        <div className="space-y-4">
          <input
            id="login-username"
            type="text"
            placeholder="Username"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <input
            id="login-password"
            type="password"
            placeholder="Password"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            id="login-submit"
            onClick={onLogin}
            className="w-full bg-brand-600 hover:bg-brand-500 transition-colors text-white font-semibold rounded-lg py-2.5 text-sm"
          >
            Sign In
          </button>
        </div>

        <p className="mt-6 text-xs text-gray-600 text-center">
          Auth not implemented yet — click Sign In to enter
        </p>
      </div>
    </div>
  )
}
