import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
