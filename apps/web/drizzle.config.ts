import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/infrastructure/db/schema.ts',
  out: './db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://sauryctf:sauryctf-dev@127.0.0.1:15432/sauryctf',
  },
  strict: true,
  verbose: true,
})
