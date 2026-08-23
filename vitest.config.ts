import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/renderer/src/test/setup.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', '**/.vscode-test/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html']
    }
  }
})
