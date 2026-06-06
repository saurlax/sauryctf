<script setup lang="ts">
const { isLoggedIn } = useAuth()

const accessCards = computed(() => [
  {
    title: isLoggedIn.value ? '控制台' : '登录',
    description: isLoggedIn.value ? '进入控制台维护比赛、队伍与账号。' : '使用现有账号进入控制台、队伍页和比赛页面。',
    icon: isLoggedIn.value ? 'i-lucide-layout-dashboard' : 'i-lucide-log-in',
    to: isLoggedIn.value ? '/console' : '/login',
  },
  {
    title: '注册',
    description: '创建账号后，可继续完成组队、报名与参赛。',
    icon: 'i-lucide-flag',
    to: '/register',
  },
  {
    title: '公开比赛',
    description: '查看公开比赛、比赛详情和排行榜。',
    icon: 'i-lucide-list',
    to: '/games',
  },
])


type HeroLink = {
  label: string
  to: string
  icon: string
  variant?: 'outline' | 'subtle'
}

const heroLinks = computed(() => {
  const links: HeroLink[] = [
    { label: '开始比赛', to: '/games', icon: 'i-lucide-rocket' },
  ]

  if (isLoggedIn.value) {
    links.push({ label: '进入控制台', to: '/console', icon: 'i-lucide-layout-dashboard', variant: 'outline' })
  }
  else {
    links.push({ label: '登录', to: '/login', icon: 'i-lucide-log-in', variant: 'outline' })
    links.push({ label: '注册', to: '/register', icon: 'i-lucide-user-round-plus', variant: 'subtle' })
  }

  return links
})
</script>

<template>
  <div>
    <UPageHero
      title="SauryCTF"
      description="面向赛事组织与参赛协作的 CTF 平台，提供公开比赛浏览、队伍管理、比赛运行与题目交付能力。"
      :links="heroLinks"
    >
      <template #top>
        <UBadge variant="subtle" color="info">
          Go + Nuxt 赛事平台
        </UBadge>
      </template>
    </UPageHero>

    <UPageSection title="平台入口" description="公开访问、账号入口和控制台入口集中展示。">
      <UPageGrid>
        <UPageCard
          v-for="card in accessCards"
          :key="card.title"
          :title="card.title"
          :description="card.description"
          :icon="card.icon"
          :to="card.to"
        />
      </UPageGrid>
    </UPageSection>

    <UPageSection v-if="isLoggedIn" title="当前入口" description="继续进入控制台或公开比赛页。">
      <div class="flex flex-wrap gap-3">
        <UButton label="进入控制台" icon="i-lucide-layout-dashboard" to="/console" />
        <UButton label="浏览比赛" icon="i-lucide-trophy" to="/games" variant="outline" />
      </div>
    </UPageSection>
  </div>
</template>
