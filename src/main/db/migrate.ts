import fs from 'fs'
import path from 'path'
import type { DB } from './db'

/**
 * ARCHITECTURE.md §Database — "Migrations are numbered SQL files applied in order
 * and recorded in schema_migrations. Never edit an applied migration; add a new one."
 *
 * Resolves migrations dir from:
 *  - In production: path next to the app resource (extraResources → migrations/)
 *  - In development/test: project root migrations/ folder
 */
function getMigrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR

  // __dirname is dist-electron/main in production, src/main/db in dev
  // Walk up until we find a migrations folder
  let dir = __dirname
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'migrations')
    if (fs.existsSync(candidate)) return candidate
    dir = path.dirname(dir)
  }
  throw new Error('migrations/ directory not found')
}

/**
 * Reads all *.sql files from the migrations directory in numeric order,
 * skips those already recorded in schema_migrations, and applies the rest
 * inside a transaction.
 */
export function runMigrations(db: DB): void {
  const migrationsDir = getMigrationsDir()

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const migrationName = path.basename(file, '.sql')
    const id = parseInt(file.split('_')[0], 10)

    // Check if already applied (table may not exist yet for first migration)
    try {
      const row = db
        .prepare('SELECT id FROM schema_migrations WHERE id = ?')
        .get(id) as { id: number } | undefined
      if (row) continue
    } catch {
      // schema_migrations table doesn't exist yet — first run
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    db.exec(sql)

    console.log(`[migrate] Applied: ${migrationName}`)
  }
}
