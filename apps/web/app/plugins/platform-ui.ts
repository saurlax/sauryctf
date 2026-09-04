import { publicPlatformSettingsResponseSchema } from '#shared/contracts/platform-settings'

export default defineNuxtPlugin(async () => {
  const { applyPlatformSettings, locale, platformSettings } = usePlatformUi()

  if (!import.meta.prerender) {
    try {
      const fetchPlatformSettings = import.meta.server ? useRequestFetch() : $fetch
      const response = await fetchPlatformSettings('/api/platform/settings')
      applyPlatformSettings(publicPlatformSettingsResponseSchema.parse(response).settings)
    }
    catch {
      // The typed fallback keeps public pages renderable while readiness reports dependency failures.
    }
  }

  const colorMode = useColorMode()
  watch(() => platformSettings.value.theme, (theme) => {
    if (import.meta.server || !localStorage.getItem('nuxt-color-mode')) {
      colorMode.preference = theme
    }
  }, { immediate: true })

  useHead({
    htmlAttrs: { lang: computed(() => locale.value) },
    titleTemplate: title => title
      ? `${title} · ${platformSettings.value.brand_name}`
      : platformSettings.value.brand_name,
  })
})
