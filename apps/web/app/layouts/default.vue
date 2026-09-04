<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const { authState, isLoggedIn, logout } = useAuth()
const { locale, platformSettings, setLocale, t } = usePlatformUi()
const route = useRoute()

const items = computed<NavigationMenuItem[]>(() => [
  {
    label: t('nav.home'),
    icon: 'i-lucide-house',
    to: '/',
    active: route.path === '/',
  },
  {
    label: t('nav.games'),
    icon: 'i-lucide-flag',
    to: '/games',
    active: route.path.startsWith('/games'),
  },
  {
    label: t('nav.scoreboard'),
    icon: 'i-lucide-trophy',
    to: '/scoreboard',
    active: route.path === '/scoreboard',
  },
  {
    label: t('nav.team'),
    icon: 'i-lucide-users',
    to: '/console/team',
    active: route.path === '/console/team',
  },
  {
    label: t('nav.console'),
    icon: 'i-lucide-layout-dashboard',
    to: '/console',
    active: route.path.startsWith('/console') && route.path !== '/console/team',
  },
])

const authRedirect = computed(() => {
  if (route.path === '/login' || route.path === '/register') {
    return resolveAuthRedirect(route.query.redirect, '/console')
  }

  return route.fullPath
})

const loginTo = computed(() => buildAuthEntryPath('/login', authRedirect.value))

const localeItems = computed(() => [[
  { label: t('locale.zh-CN'), checked: locale.value === 'zh-CN', onSelect: () => setLocale('zh-CN') },
  { label: t('locale.en'), checked: locale.value === 'en', onSelect: () => setLocale('en') },
]])
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
        <UTooltip :text="t('locale.label')">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-languages"
            :aria-label="t('locale.label')"
          />
        </UTooltip>
      </UDropdownMenu>
      <UTooltip :text="t('theme.toggle')">
        <UColorModeButton :aria-label="t('theme.toggle')" />
      </UTooltip>
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
          <UTooltip :text="t('nav.user')">
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-user"
              :aria-label="t('nav.user')"
            />
          </UTooltip>
        </UDropdownMenu>
      </template>
      <template v-else>
        <UTooltip :text="t('nav.login')">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-log-in"
            :to="loginTo"
            :aria-label="t('nav.login')"
          />
        </UTooltip>
      </template>
    </template>
    <template #body>
      <UNavigationMenu :items="items" orientation="vertical" class="-mx-2.5" />
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
