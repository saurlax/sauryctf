import { sessionCookieOptions } from './shared/contracts/auth-session'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  ignore: ['.data/**'],
  modules: ['@nuxthub/core', '@nuxt/ui', 'nuxt-auth-utils'],
  hub: {
    db: {
      dialect: 'postgresql',
      driver: 'postgres-js',
      // Keep the connection runtime-only. NuxtHub otherwise resolves DATABASE_URL
      // while building and serializes it into the Nitro runtime configuration.
      connection: { url: '' },
      applyMigrationsDuringBuild: false,
      applyMigrationsDuringDev: false,
    },
    blob: false,
  },
  css: ['~/assets/css/main.css'],
  fonts: {
    providers: {
      google: false,
      googleicons: false,
    },
  },

  runtimeConfig: {
    session: {
      password: '',
      name: 'sauryctf-session',
      cookie: sessionCookieOptions(process.env.NODE_ENV === 'production'),
    },
    public: {
      apiBase: '/api',
      turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',
    },
  },

  routeRules: {
    '/': { prerender: true },
  },

  nitro: {
    preset: 'node-server',
    errorHandler: './server/error-handler.ts',
    ignore: ['.data/**'],
  },
})
