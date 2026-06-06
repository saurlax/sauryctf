<script setup lang="ts">
const { isLoggedIn } = useAuth()
const { data: setupStatus } = await useAPI('landing-auth-setup-status', 'get', '/api/auth/setup-status')

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

const firstSteps = computed(() => [
  {
    title: setupStatus.value?.bootstrap_admin_available ? '空库管理入口' : '管理入口',
    description: setupStatus.value?.bootstrap_admin_available
      ? `当前仍处于空库首次启动阶段，可直接用 ${setupStatus.value.default_admin_username} / ${setupStatus.value.default_admin_password} 登录后完成建赛。`
      : '数据库里已经有用户时，请直接使用现有账号登录管理后台，不再依赖默认管理员口令。',
    icon: 'i-lucide-shield-check',
    to: '/login',
  },
  {
    title: '选手入场',
    description: '注册账号后会先进入队伍页，创建或加入队伍后，再继续回到比赛详情完成报名、提交 Flag 或补交 Writeup。',
    icon: 'i-lucide-flag',
    to: '/register',
  },
  {
    title: '先看公开比赛',
    description: '公开比赛支持游客先浏览基础信息、题目标题和排行榜，再决定是否登录或正式参赛。',
    icon: 'i-lucide-list',
    to: '/games',
  },
])

const landingGuideMeta = computed(() => {
  if (isLoggedIn.value) {
    return {
      title: '当前下一步：进入控制台继续处理',
      description: '你已经处于登录状态。现在最值得先进入控制台确认队伍、比赛待办和管理入口，再决定是继续建赛还是去公开比赛页参赛。',
      color: 'success' as const,
      icon: 'i-lucide-layout-dashboard',
      actionLabel: '进入控制台',
      actionTo: '/console',
      secondaryLabel: '浏览比赛',
      secondaryTo: '/games',
    }
  }

  if (setupStatus.value?.bootstrap_admin_available) {
    return {
      title: '当前下一步：先用初始管理员打通建赛闭环',
      description: `当前数据库为空，可直接使用 ${setupStatus.value.default_admin_username} / ${setupStatus.value.default_admin_password} 登录。建议先创建一场公开比赛，再用普通账号走一遍报名参赛链路。`,
      color: 'info' as const,
      icon: 'i-lucide-shield-check',
      actionLabel: '去登录',
      actionTo: '/login',
      secondaryLabel: '先看公开比赛',
      secondaryTo: '/games',
    }
  }

  return {
    title: '当前下一步：先挑一场公开比赛，或直接注册选手账号',
    description: '如果你是普通选手，可以先浏览公开比赛再决定是否参赛；如果已经准备好实际使用，也可以直接注册并进入队伍准备流程。',
    color: 'neutral' as const,
    icon: 'i-lucide-rocket',
    actionLabel: '浏览比赛',
    actionTo: '/games',
    secondaryLabel: '去注册',
    secondaryTo: '/register',
  }
})

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
        :color="landingGuideMeta.color"
        variant="soft"
        :icon="landingGuideMeta.icon"
        :title="landingGuideMeta.title"
        :description="landingGuideMeta.description"
      >
        <template #actions>
          <div class="flex flex-wrap gap-2">
            <UButton
              size="sm"
              :to="landingGuideMeta.actionTo"
              :label="landingGuideMeta.actionLabel"
              variant="outline"
            />
            <UButton
              v-if="landingGuideMeta.secondaryLabel && landingGuideMeta.secondaryTo"
              size="sm"
              :to="landingGuideMeta.secondaryTo"
              :label="landingGuideMeta.secondaryLabel"
              variant="ghost"
            />
          </div>
        </template>
      </UAlert>

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

    <UPageSection title="推荐使用顺序" description="建议先完成管理配置，再进入选手侧流程。">
      <UPageGrid>
        <UPageCard
          title="1. 管理员建赛"
          description="登录管理员账号，创建公开比赛、创建题目、挂载题目并激活比赛。"
          icon="i-lucide-settings-2"
          to="/console/admin"
        />
        <UPageCard
          title="2. 选手参赛"
          description="注册普通账号后先创建队伍，再进入比赛页完成报名、答题和提交 Flag。"
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
