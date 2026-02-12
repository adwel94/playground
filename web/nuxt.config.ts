// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint', '@nuxtjs/tailwindcss'],
  nitro: {
    experimental: { websocket: true },
  },
  runtimeConfig: {
    // Server-only keys (not exposed to client)
    googleApiKey: '',
    visionSafariModel: 'gemini-3-flash-preview',
  },
})
