<script setup lang="ts">
const { authState, isLoggedIn, logout } = useAuth()

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
        <UButton label="登录/注册" to="/login" />
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
