import { sessionCookieOptions } from './shared/contracts/auth-session'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/ui', 'nuxt-auth-utils'],
  css: ['~/assets/css/main.css'],
  fonts: {
    providers: {
      google: false,
      googleicons: false,
    },
  },

  runtimeConfig: {
    session: {
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
  },
})
