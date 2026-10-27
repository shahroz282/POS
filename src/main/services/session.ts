import type { SessionUser } from '@shared/schemas'

/**
 * Main-process session store.
 * ARCHITECTURE.md §IPC conventions: "The current user comes from the
 * main-process session, never from the renderer's input."
 */
let _currentUser: SessionUser | null = null

export function setCurrentUser(user: SessionUser | null): void {
  _currentUser = user
}

export function getCurrentUser(): SessionUser | null {
  return _currentUser
}

export function requireCurrentUser(): SessionUser {
  if (!_currentUser) {
    throw new Error('No user logged in')
  }
  return _currentUser
}
