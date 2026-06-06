<script setup lang="ts">
const { authState, isLoggedIn, logout } = useAuth()
const route = useRoute()

const items = computed(() => {
  const nav = [
    { label: '首页', to: '/' },
    { label: '比赛', to: '/games' },
  ]
  if (isLoggedIn.value) {
    nav.push({ label: '控制台', to: '/console' })
  }
  return nav
})

const authRedirect = computed(() => {
  if (route.path === '/login' || route.path === '/register') {
    const redirect = route.query.redirect
    if (typeof redirect === 'string' && redirect.startsWith('/')) {
      return redirect
    }

    return '/console'
  }

  return route.fullPath
})

const loginTo = computed(() => `/login?redirect=${encodeURIComponent(authRedirect.value)}`)
const registerTo = computed(() => `/register?redirect=${encodeURIComponent(authRedirect.value)}`)
</script>

<template>
  <UHeader>
    <template #title>
      <span class="text-xl font-bold">SauryCTF</span>
    </template>
    <UNavigationMenu :items="items" />
    <template #right>
      <template v-if="isLoggedIn">
        <UDropdownMenu
          :items="
            [
              [
                { label: authState.user?.username || '用户', icon: 'i-lucide-user', disabled: true },
              ],
              [
                { label: '控制台', icon: 'i-lucide-layout-dashboard', to: '/console' },
                { label: '我的队伍', icon: 'i-lucide-users', to: '/console/team' },
                { label: '账号安全', icon: 'i-lucide-key-round', to: '/console/account' },
                ...(['admin', 'super_admin'].includes(authState.user?.role || '')
                  ? [
                      { label: '用户管理', icon: 'i-lucide-users-round', to: '/console/admin/users' },
                      { label: '审计日志', icon: 'i-lucide-scroll-text', to: '/console/admin/audit' },
                    ]
                  : []),
              ],
              [
                { label: '退出登录', icon: 'i-lucide-log-out', onSelect: logout },
              ],
            ]"
        >
          <UButton variant="ghost" icon="i-lucide-user" />
        </UDropdownMenu>
      </template>
      <template v-else>
        <div class="flex items-center gap-2">
          <UButton label="登录" icon="i-lucide-log-in" variant="ghost" :to="loginTo" />
          <UButton label="注册" icon="i-lucide-user-round-plus" :to="registerTo" />
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
      <p class="text-sm text-muted">&copy; {{ new Date().getFullYear() }} SauryCTF</p>
    </template>
  </UFooter>
</template>
