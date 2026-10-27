import { useEffect, useState } from 'react'
import type { Role } from '@shared/constants'
import type { UserRow } from '@shared/schemas'

const ROLES: Role[] = ['ADMIN', 'MANAGER', 'CASHIER']

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('CASHIER')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const loadUsers = async () => {
    setError('')
    const result = await window.api.usersList()
    if (result.ok) {
      setUsers(result.data)
    } else {
      setError(result.error.message)
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadUsers()
  }, [])

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setSaving(true)
    const result = await window.api.usersCreate({ name, username, password, role })
    setSaving(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }

    setName('')
    setUsername('')
    setPassword('')
    await loadUsers()
  }

  const handleRoleChange = async (userId: number, nextRole: Role) => {
    setError('')
    const result = await window.api.usersChangeRole({ userId, role: nextRole })
    if (result.ok) {
      await loadUsers()
    } else {
      setError(result.error.message)
    }
  }

  const handleDeactivate = async (userId: number) => {
    setError('')
    const result = await window.api.usersDeactivate({ userId })
    if (result.ok) {
      await loadUsers()
    } else {
      setError(result.error.message)
    }
  }

  return (
    <section className="space-y-6 p-6">
      <header>
        <h1 className="text-xl font-semibold text-gray-100">Users</h1>
        <p className="mt-1 text-sm text-gray-500">Manage staff accounts and access roles.</p>
      </header>

      {error && <p role="alert" className="border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>}

      <form onSubmit={handleCreate} className="grid gap-3 border border-gray-800 bg-gray-900 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <input
          aria-label="Full name"
          placeholder="Full name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={100}
          className="min-w-0 border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500"
        />
        <input
          aria-label="Username"
          placeholder="Username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
          minLength={3}
          maxLength={50}
          className="min-w-0 border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500"
        />
        <input
          aria-label="Temporary password"
          type="password"
          placeholder="Password (6+ characters)"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={6}
          maxLength={200}
          className="min-w-0 border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500"
        />
        <select
          aria-label="Role"
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
          className="border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
        >
          {ROLES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <button
          type="submit"
          disabled={saving}
          className="bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        >
          {saving ? 'Creating…' : 'Add user'}
        </button>
      </form>

      <div className="overflow-x-auto border border-gray-800">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead className="bg-gray-900 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Username</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800 text-gray-300">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">Loading users…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">No users found.</td></tr>
            ) : users.map((managedUser) => (
              <tr key={managedUser.id} className="bg-gray-950">
                <td className="px-4 py-3">{managedUser.name}</td>
                <td className="px-4 py-3">{managedUser.username}</td>
                <td className="px-4 py-3">
                  <select
                    aria-label={`Role for ${managedUser.name}`}
                    value={managedUser.role}
                    disabled={!managedUser.is_active}
                    onChange={(event) => void handleRoleChange(managedUser.id, event.target.value as Role)}
                    className="border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200 disabled:opacity-50"
                  >
                    {ROLES.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3">{managedUser.is_active ? 'Active' : 'Inactive'}</td>
                <td className="px-4 py-3">
                  {managedUser.is_active && (
                    <button
                      type="button"
                      onClick={() => void handleDeactivate(managedUser.id)}
                      className="text-red-400 hover:text-red-300"
                    >
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}