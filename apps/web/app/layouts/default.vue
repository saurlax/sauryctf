<script setup lang="ts">
const { authState, isLoggedIn, logout } = useAuth()
const { locale, platformSettings, setLocale, t } = usePlatformUi()
const route = useRoute()

const items = computed(() => {
  const nav = [
    { label: t('nav.home'), to: '/' },
    { label: t('nav.games'), to: '/games' },
  ]
  if (isLoggedIn.value) {
    nav.push({ label: t('nav.console'), to: '/console' })
  }
  return nav
})

const authRedirect = computed(() => {
  if (route.path === '/login' || route.path === '/register') {
    return resolveAuthRedirect(route.query.redirect, '/console')
  }

  return route.fullPath
})

const loginTo = computed(() => buildAuthEntryPath('/login', authRedirect.value))
const registerTo = computed(() => buildAuthEntryPath('/register', authRedirect.value))

const localeItems = computed(() => [[
  { label: t('locale.zh-CN'), checked: locale.value === 'zh-CN', onSelect: () => setLocale('zh-CN') },
  { label: t('locale.en'), checked: locale.value === 'en', onSelect: () => setLocale('en') },
]])
const localeLabel = computed(() => t(locale.value === 'en' ? 'locale.en' : 'locale.zh-CN'))
</script>

<template>
  <UHeader>
    <template #title>
      <div class="flex items-center gap-2">
        <img v-if="platformSettings.logo_url" :src="platformSettings.logo_url" alt="" class="size-7 object-contain">
        <span class="text-xl font-bold">{{ platformSettings.brand_name }}</span>
      </div>
    </template>
    <UNavigationMenu :items="items" />
    <template #right>
      <UDropdownMenu :items="localeItems">
        <UButton
          variant="ghost"
          icon="i-lucide-languages"
          :label="localeLabel"
          :aria-label="t('locale.label')"
        />
      </UDropdownMenu>
      <template v-if="isLoggedIn">
        <UDropdownMenu
          :items="
            [
              [
                { label: authState.user?.username || t('nav.user'), icon: 'i-lucide-user', disabled: true },
              ],
              [
                { label: t('nav.console'), icon: 'i-lucide-layout-dashboard', to: '/console' },
                { label: t('nav.team'), icon: 'i-lucide-users', to: '/console/team' },
                { label: t('nav.account'), icon: 'i-lucide-key-round', to: '/console/account' },
                ...(authState.user?.role === 'admin'
                  ? [
                      { label: t('nav.users'), icon: 'i-lucide-users-round', to: '/console/admin/users' },
                      { label: t('nav.audit'), icon: 'i-lucide-scroll-text', to: '/console/admin/audit' },
                    ]
                  : []),
              ],
              [
                { label: t('nav.logout'), icon: 'i-lucide-log-out', onSelect: logout },
              ],
            ]"
        >
          <UButton variant="ghost" icon="i-lucide-user" />
        </UDropdownMenu>
      </template>
      <template v-else>
        <div class="flex items-center gap-2">
          <UButton :label="t('nav.login')" icon="i-lucide-log-in" variant="ghost" :to="loginTo" />
          <UButton
            v-if="platformSettings.public_registration_enabled"
            :label="t('nav.register')"
            icon="i-lucide-user-round-plus"
            variant="outline"
            :to="registerTo"
          />
        </div>
      </template>
    </template>
  </UHeader>

  <UMain>
    <UContainer>
      <slot />
    </UContainer>
  </UMain>

  <UFooter>
    <template #left>
      <p class="text-sm text-muted">&copy; {{ new Date().getFullYear() }} {{ platformSettings.brand_name }}</p>
    </template>
  </UFooter>
</template>
