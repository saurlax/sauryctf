import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // PostgreSQL integration suites create their own databases and include two
    // deliberate high-connection capacity tests. Keep files parallel for the
    // dependency-free unit run, but serialize them when the shared integration
    // server is enabled so their connection budgets cannot overlap.
    fileParallelism: !process.env.TEST_DATABASE_ADMIN_URL,
  },
})
