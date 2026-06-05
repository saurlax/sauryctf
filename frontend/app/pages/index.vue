<script setup lang="ts">
const { isLoggedIn } = useAuth()
const { data: setupStatus } = await useAPI('landing-auth-setup-status', 'get', '/api/auth/setup-status')

const features = [
  {
    title: '动态容器',
    description: '基于 k3s 的动态题目容器，每队独立实例，自动生命周期管理',
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
    description: 'NetworkPolicy 隔离、资源配额控制、审计日志全程记录',
    icon: 'i-lucide-shield',
  },
]

const firstSteps = [
  {
    title: '管理员首次进入',
    description: '空库首次启动时会开放默认管理员入口；库里已有任意用户后，就只使用现有账号登录管理后台。',
    icon: 'i-lucide-shield-check',
    to: '/login',
  },
  {
    title: '普通选手报名',
    description: '注册账号后会先进入队伍页，创建或加入队伍后再回到比赛详情继续报名和提交 Flag。',
    icon: 'i-lucide-flag',
    to: '/register',
  },
  {
    title: '直接看比赛列表',
    description: '公开比赛支持游客先浏览基础信息、题目标题和排行榜，再决定是否参赛。',
    icon: 'i-lucide-list',
    to: '/games',
  },
]

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
          赛事平台持续完善中
        </UBadge>
      </template>
    </UPageHero>

    <UPageSection title="首次使用" description="第一次把项目跑起来时，按这三个入口最省事。">
      <UAlert
        class="mb-6"
        color="info"
        variant="soft"
        :title="setupStatus?.bootstrap_admin_available ? '当前可使用默认管理员' : '默认管理员仅在空库初始化'"
        :description="setupStatus?.bootstrap_admin_available
          ? `当前库为空，可直接使用 ${setupStatus.default_admin_username} / ${setupStatus.default_admin_password} 登录。`
          : '数据库里已有任意用户，后端不会补建 admin。请使用已有账号登录。'"
      />

      <UPageGrid>
        <UPageCard
          v-for="step in firstSteps"
          :key="step.title"
          :title="step.title"
          :description="step.description"
          :icon="step.icon"
          :to="step.to"
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

    <UPageSection title="推荐本地冒烟顺序" description="先验证管理员链路，再验证选手链路。">
      <UPageGrid>
        <UPageCard
          title="1. 管理员建赛"
          description="登录 admin，创建公开比赛、创建题目、挂载题目并激活比赛。"
          icon="i-lucide-settings-2"
          to="/console/admin"
        />
        <UPageCard
          title="2. 选手参赛"
          description="注册普通账号后先创建队伍，再进入比赛页报名并提交一条正确 Flag。"
          icon="i-lucide-user-round-plus"
          to="/register"
        />
        <UPageCard
          title="3. 查看排行"
          description="回到比赛详情页确认题目状态、分数变化和公开排行榜是否同步更新。"
          icon="i-lucide-trophy"
          to="/games"
        />
      </UPageGrid>
    </UPageSection>
  </div>
</template>
