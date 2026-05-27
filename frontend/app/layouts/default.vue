<script setup lang="ts">
const items = [
  { label: '首页', to: '/' },
  { label: '比赛', to: '/games' },
  { label: '登录', to: '/login' },
]
</script>

<template>
  <UHeader>
    <template #logo>
      <span class="text-xl font-bold">SauryCTF</span>
    </template>
    <UNavigationMenu :items="items" />
    <template #right>
      <UButton label="登录" variant="ghost" to="/login" />
      <UButton label="注册" to="/register" />
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
