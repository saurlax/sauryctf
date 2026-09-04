import type { PublicPlatformSettings } from '#shared/contracts/platform-settings'
import type { SystemMessageKey } from '#shared/i18n/system'
import {
  isPlatformLocale,
  originalBusinessContent,
  systemErrorMessage,
  systemMessage,
  systemStatus,
} from '#shared/i18n/system'

const fallbackSettings: PublicPlatformSettings = {
  brand_name: 'SauryCTF',
  logo_object_id: null,
  logo_url: null,
  theme: 'dark',
  default_locale: 'zh-CN',
  public_registration_enabled: true,
  authentication_mode: 'password_only',
  version: 1,
}

export function usePlatformUi() {
  const platformSettings = useState<PublicPlatformSettings>('platform-ui.settings', () => ({ ...fallbackSettings }))
  const localeCookie = useCookie<string | null>('sauryctf-locale', {
    sameSite: 'lax',
    maxAge: 365 * 24 * 60 * 60,
  })
  const locale = useState<'zh-CN' | 'en'>('platform-ui.locale', () => (
    isPlatformLocale(localeCookie.value) ? localeCookie.value : platformSettings.value.default_locale
  ))

  function applyPlatformSettings(settings: PublicPlatformSettings) {
    platformSettings.value = settings
    if (!isPlatformLocale(localeCookie.value)) locale.value = settings.default_locale
  }

  function setLocale(nextLocale: 'zh-CN' | 'en') {
    locale.value = nextLocale
    localeCookie.value = nextLocale
  }

  function t(key: SystemMessageKey, values?: Record<string, string | number>) {
    return systemMessage(locale.value, key, values)
  }

  function status(value: string) {
    return systemStatus(locale.value, value)
  }

  function errorMessage(error: unknown) {
    let code: string | undefined
    if (typeof error === 'object' && error !== null) {
      const candidate = error as { data?: { error?: { code?: unknown } } }
      if (typeof candidate.data?.error?.code === 'string') code = candidate.data.error.code
    }
    return systemErrorMessage(locale.value, code)
  }

  return {
    applyPlatformSettings,
    businessContent: originalBusinessContent,
    errorMessage,
    locale,
    platformSettings,
    setLocale,
    status,
    t,
  }
}
