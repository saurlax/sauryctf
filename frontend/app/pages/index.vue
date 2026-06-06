<script setup lang="ts">
const { isLoggedIn } = useAuth()

const features = [
  {
    title: '动态容器',
    description: '支持按队伍分配实例入口，覆盖租约续期与生命周期回收等关键能力。',
    icon: 'i-lucide-server',
  },
  {
    title: '实时排行',
    description: '提供动态计分、三血记录、分组榜与时间线回放能力。',
    icon: 'i-lucide-trophy',
  },
  {
    title: '队伍协作',
    description: '支持队伍创建、邀请码加入、比赛分组与队伍锁定。',
    icon: 'i-lucide-users',
  },
  {
    title: '安全隔离',
    description: '围绕账号、队伍、比赛与实例链路建立清晰的权限与隔离边界。',
    icon: 'i-lucide-shield',
  },
]

const accessCards = computed(() => [
  {
    title: '管理控制台',
    description: '使用现有管理账号进入控制台，维护比赛、题目与平台运行配置。',
    icon: 'i-lucide-shield-check',
    to: '/login',
  },
  {
    title: '选手入口',
    description: '登录或创建选手账号后，可继续处理组队、报名与参赛操作。',
    icon: 'i-lucide-flag',
    to: '/register',
  },
  {
    title: '公开比赛',
    description: '公开比赛页提供比赛基础信息、题目列表与排行榜视图。',
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
      description="基于 Go + Gin + GORM + Nuxt 4 的极简 CTF 平台，覆盖公开浏览、队伍协作、比赛管理与题目交付。"
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

    <UPageSection id="features" title="平台能力" description="围绕比赛组织、公开展示与参赛流程提供基础能力。">
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
