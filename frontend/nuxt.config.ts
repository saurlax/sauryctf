// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  fonts: {
    providers: {
      google: false,
      googleicons: false,
    },
  },

  runtimeConfig: {
    apiBase: 'http://127.0.0.1:8080/api',
    public: {
      apiBase: '/api',
    },
  },

  nitro: {
    devProxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
