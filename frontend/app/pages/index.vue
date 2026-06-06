<script setup lang="ts">
const { isLoggedIn } = useAuth()

const features = [
  {
    title: '动态容器',
    description: '支持动态题目实例链路，覆盖独立入口、租约续期与生命周期回收等核心流程',
    icon: 'i-lucide-server',
  },
  {
    title: '实时排行',
    description: '动态计分系统，支持三血奖励、分组榜、时间线回放',
    icon: 'i-lucide-trophy',
  },
  {
    title: '队伍协作',
    description: '队伍创建、邀请、审核，支持比赛分组和队伍锁定',
    icon: 'i-lucide-users',
  },
  {
    title: '安全隔离',
    description: '围绕账号、队伍、比赛与实例链路提供清晰的权限边界与运行隔离能力',
    icon: 'i-lucide-shield',
  },
]

const accessCards = computed(() => [
  {
    title: '管理入口',
    description: '使用现有管理账号进入控制台，维护比赛、题目与平台配置。',
    icon: 'i-lucide-shield-check',
    to: '/login',
  },
  {
    title: '选手入场',
    description: '创建选手账号后即可进入队伍页，继续完成组队、报名与参赛操作。',
    icon: 'i-lucide-flag',
    to: '/register',
  },
  {
    title: '先看公开比赛',
    description: '公开比赛页可查看基础信息、题目列表与排行榜。',
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
      description="基于 Go + Gin + GORM + Nuxt 4 的极简 CTF/AWD 平台，优先打通可真实跑起来的比赛闭环。"
      :links="heroLinks"
    >
      <template #top>
        <UBadge variant="subtle" color="info">
          Go + Nuxt 赛事平台
        </UBadge>
      </template>
    </UPageHero>

    <UPageSection title="主要入口" description="平台的公开访问、账号入口和管理入口集中展示。">
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

    <UPageSection id="features" title="平台特色" description="为 CTF 竞赛打造的一站式平台">
      <UPageGrid>
        <UPageCard
          v-for="feature in features"
          :key="feature.title"
          :title="feature.title"
          :description="feature.description"
          :icon="feature.icon"
        />
      </UPageGrid>
    </UPageSection>

    <UPageSection v-if="isLoggedIn" title="常用入口" description="继续进入控制台或公开比赛页。">
      <div class="flex flex-wrap gap-3">
        <UButton label="进入控制台" icon="i-lucide-layout-dashboard" to="/console" />
        <UButton label="浏览比赛" icon="i-lucide-trophy" to="/games" variant="outline" />
      </div>
    </UPageSection>
  </div>
</template>
