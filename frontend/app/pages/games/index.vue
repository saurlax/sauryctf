<script setup lang="ts">
import type { components } from '~/types/api'

type Game = components['schemas']['Game']
type GameParticipation = components['schemas']['GameParticipation']

const toast = useToast()
const { authState, ensureInitialized } = useAuth()
const { fetchParticipationMap } = useGameParticipationMap()
const { resolveParticipationMeta } = usePublicGameParticipationState()
const games = ref<Game[]>([])
const participationMap = ref<Record<number, GameParticipation>>({})
const loading = ref(true)
const searchQuery = ref('')
const statusFilter = ref<'all' | 'active' | 'ended'>('all')

const firstVisibleGame = computed(() => games.value[0] || null)
const firstVisibleGameRedirect = computed(() => firstVisibleGame.value ? encodeURIComponent(`/games/${firstVisibleGame.value.id}`) : encodeURIComponent('/games'))
const hasTeam = computed(() => Object.values(participationMap.value).some(participation => !!participation?.has_team))
const joinedGames = computed(() => games.value.filter(game => participationMap.value[game.id]?.participated))
const firstJoinedGame = computed(() => joinedGames.value[0] || null)
const firstJoinableGame = computed(() =>
  games.value.find(game =>
    game.status === 'active'
    && participationMap.value[game.id]?.has_team
    && !participationMap.value[game.id]?.participated,
  ) || null,
)

const listGuideMeta = computed(() => {
  if (!authState.user) {
    return {
      title: '游客可先挑一场公开比赛，再决定是否登录',
      description: firstVisibleGame.value
        ? '当前可以先打开比赛详情页浏览基础信息、题目标题和排行榜；如果准备参赛，登录或注册后会自动带你回到原比赛继续操作。'
        : '当前还没有公开比赛，但后续一旦有比赛开放，登录或注册后都会保留比赛返回路径。',
      color: 'info' as const,
      icon: 'i-lucide-log-in',
      actionLabel: '去登录',
      actionTo: `/login?redirect=${firstVisibleGameRedirect.value}`,
      secondaryLabel: '去注册',
      secondaryTo: `/register?redirect=${firstVisibleGameRedirect.value}`,
    }
  }

  if (!hasTeam.value) {
    return {
      title: '当前状态：需要队伍',
      description: '比赛报名、提交 Flag 和排行榜都按队伍进行。先创建或加入队伍，再回到这里继续选赛。',
      color: 'warning' as const,
      icon: 'i-lucide-users',
      actionLabel: '去队伍页',
      actionTo: `/console/team?redirect=${firstVisibleGameRedirect.value}`,
      secondaryLabel: firstVisibleGame.value ? '先看比赛详情' : '回控制台',
      secondaryTo: firstVisibleGame.value ? `/games/${firstVisibleGame.value.id}` : '/console',
    }
  }

  if (firstJoinedGame.value) {
    return {
      title: '当前已经有可继续处理的比赛',
      description: `你的队伍已经和 ${firstJoinedGame.value.name} 建立了参赛关系。现在最值得先回到比赛详情页，继续查看报名状态、题目、排行榜或 Writeup。`,
      color: 'success' as const,
      icon: 'i-lucide-badge-check',
      actionLabel: '打开当前比赛',
      actionTo: `/games/${firstJoinedGame.value.id}`,
      secondaryLabel: '浏览全部比赛',
      secondaryTo: '/games',
    }
  }

  if (firstJoinableGame.value) {
    return {
      title: '当前状态：可继续报名',
      description: firstJoinableGame.value.registration_mode === 'auto_accept'
        ? `${firstJoinableGame.value.name} 当前使用自动通过报名。进入详情页后，确认报名就能直接获得参赛资格。`
        : `${firstJoinableGame.value.name} 当前使用审核制报名。进入详情页提交报名后，再等待管理员通过即可。`,
      color: 'info' as const,
      icon: 'i-lucide-flag',
      actionLabel: '前往报名',
      actionTo: `/games/${firstJoinableGame.value.id}`,
      secondaryLabel: '回队伍页',
      secondaryTo: '/console/team',
    }
  }

  return {
    title: '当前可先浏览比赛，再决定下一场要参加哪一场',
    description: '如果暂时没有可直接报名的进行中比赛，可以先看比赛规则、分组和赛后练习配置，等目标比赛开放后再继续参赛。',
    color: 'neutral' as const,
    icon: 'i-lucide-compass',
    actionLabel: firstVisibleGame.value ? '打开一场比赛' : '回控制台',
    actionTo: firstVisibleGame.value ? `/games/${firstVisibleGame.value.id}` : '/console',
    secondaryLabel: '查看队伍',
    secondaryTo: '/console/team',
  }
})

async function fetchGames() {
  loading.value = true
  try {
    const res = await $api('get', '/api/games')
    games.value = res || []
    await fetchParticipationStates()
  }
  catch (e: any) {
    toast.add({ title: '获取比赛列表失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    loading.value = false
  }
}

async function fetchParticipationStates() {
  participationMap.value = await fetchParticipationMap(games.value.map(game => game.id))
}

function getStatusColor(status: string) {
  switch (status) {
    case 'active': return 'success'
    case 'draft': return 'neutral'
    case 'ended': return 'error'
    default: return 'neutral'
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'active': return '进行中'
    case 'draft': return '草稿'
    case 'ended': return '已结束'
    default: return status
  }
}

function getParticipationMeta(game: Game) {
  const redirect = encodeURIComponent(`/games/${game.id}`)

  return resolveParticipationMeta({
    gameId: game.id,
    gamePhase: game.status === 'ended' ? 'ended' : game.status === 'draft' ? 'draft' : 'active',
    practiceMode: game.practice_mode,
    isLoggedIn: !!authState.user,
    participation: participationMap.value[game.id],
    registrationMode: game.registration_mode,
    maxTeamMembers: game.max_team_members,
    loginTo: `/login?redirect=${redirect}`,
    registerTo: `/register?redirect=${redirect}`,
    teamTo: `/console/team?redirect=${redirect}`,
  })
}

const filteredGames = computed(() => {
  const keyword = searchQuery.value.trim().toLowerCase()

  return games.value.filter((game) => {
    if (statusFilter.value !== 'all' && game.status !== statusFilter.value) {
      return false
    }

    if (!keyword) {
      return true
    }

    return [
      game.name,
      game.description || '',
      game.notice || '',
      ...(game.divisions || []),
    ].some(value => value.toLowerCase().includes(keyword))
  })
})

const listStats = computed(() => [
  {
    label: '公开比赛',
    value: String(games.value.length),
    hint: '当前可浏览的比赛总数',
    icon: 'i-lucide-trophy',
    color: 'info' as const,
  },
  {
    label: '进行中',
    value: String(games.value.filter(game => game.status === 'active').length),
    hint: '当前仍可继续参赛或查看实时榜单的比赛',
    icon: 'i-lucide-activity',
    color: 'success' as const,
  },
  {
    label: '已结束',
    value: String(games.value.filter(game => game.status === 'ended').length),
    hint: '适合复盘、补题和查看历史榜单的比赛',
    icon: 'i-lucide-archive',
    color: 'neutral' as const,
  },
  {
    label: '我的已报名',
    value: String(games.value.filter(game => participationMap.value[game.id]?.participated).length),
    hint: authState.user ? '当前账号已经关联到的比赛数量' : '登录后这里会显示你的已报名比赛数',
    icon: 'i-lucide-badge-check',
    color: 'warning' as const,
  },
])

const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '进行中', value: 'active' },
  { label: '已结束', value: 'ended' },
]

const emptyStateMeta = computed(() => {
  if (authState.user && ['admin', 'super_admin'].includes(authState.user.role || '')) {
    return {
      title: '当前还没有公开比赛',
      description: '这通常说明你还没有创建比赛，或者比赛仍处于 draft / 私有状态。先去管理端创建一场公开比赛并切到 active，再回这里查看公开页展示。',
      icon: 'i-lucide-shield-check',
      actions: [
        {
          label: '去管理端建赛',
          icon: 'i-lucide-settings-2',
          to: '/console/admin',
          color: 'neutral' as const,
        },
        {
          label: '回控制台',
          icon: 'i-lucide-layout-dashboard',
          to: '/console',
          color: 'neutral' as const,
          variant: 'outline' as const,
        },
      ],
    }
  }

  return {
    title: '当前还没有公开比赛',
    description: '这通常说明管理员还没有发布比赛，或者目标比赛仍在准备中。你可以稍后再来，或先登录查看自己的队伍与控制台入口。',
    icon: 'i-lucide-trophy',
    actions: authState.user
      ? [
          {
            label: '回控制台',
            icon: 'i-lucide-layout-dashboard',
            to: '/console',
            color: 'neutral' as const,
          },
        ]
      : [
          {
            label: '去登录',
            icon: 'i-lucide-log-in',
            to: '/login?redirect=%2Fgames',
            color: 'neutral' as const,
          },
          {
            label: '去注册',
            icon: 'i-lucide-user-round-plus',
            to: '/register?redirect=%2Fgames',
            color: 'neutral' as const,
            variant: 'outline' as const,
          },
        ],
  }
})

const filteredEmptyStateMeta = computed(() => {
  if (!games.value.length) {
    return null
  }

  const hasKeyword = searchQuery.value.trim().length > 0
  const hasStatusFilter = statusFilter.value !== 'all'
  const filterSummary = [
    hasKeyword ? `关键词“${searchQuery.value.trim()}”` : '',
    hasStatusFilter ? `状态“${statusFilter.value === 'active' ? '进行中' : '已结束'}”` : '',
  ].filter(Boolean).join(' + ')

  return {
    title: '当前筛选条件下没有匹配的比赛',
    description: filterSummary
      ? `还没有比赛同时满足 ${filterSummary}。你可以先清空筛选，或直接回到全部公开比赛继续浏览。`
      : '当前没有匹配的比赛。你可以先清空筛选，再继续浏览全部公开比赛。',
  }
})

function resetFilters() {
  searchQuery.value = ''
  statusFilter.value = 'all'
}

onMounted(async () => {
  await ensureInitialized()
  await fetchGames()
})
</script>

<template>
  <UContainer class="py-8">
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-3xl font-bold mb-2">
          比赛列表
        </h1>
        <p class="text-muted">
          浏览所有公开且已开放展示的比赛
        </p>
      </div>
    </div>

    <div v-if="loading" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader" class="size-8 animate-spin text-muted" />
    </div>

    <template v-else>
      <UAlert
        class="mb-6"
        :color="listGuideMeta.color"
        variant="soft"
        :icon="listGuideMeta.icon"
        :title="listGuideMeta.title"
        :description="listGuideMeta.description"
      >
        <template #actions>
          <div class="flex flex-wrap gap-2">
            <UButton
              size="sm"
              :to="listGuideMeta.actionTo"
              :label="listGuideMeta.actionLabel"
              variant="outline"
            />
            <UButton
              v-if="listGuideMeta.secondaryLabel && listGuideMeta.secondaryTo"
              size="sm"
              :to="listGuideMeta.secondaryTo"
              :label="listGuideMeta.secondaryLabel"
              variant="ghost"
            />
          </div>
        </template>
      </UAlert>

      <UPageGrid :cols="{ default: 1, sm: 2, xl: 4 }" class="mb-6">
        <UPageCard
          v-for="stat in listStats"
          :key="stat.label"
          :title="stat.value"
          :description="stat.label"
          :icon="stat.icon"
        >
          <template #footer>
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs text-muted">{{ stat.hint }}</span>
              <UBadge :color="stat.color" variant="subtle" size="sm">
                {{ stat.label }}
              </UBadge>
            </div>
          </template>
        </UPageCard>
      </UPageGrid>

      <UPageCard class="mb-6" title="筛选" icon="i-lucide-filter">
        <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <UFormField label="搜索比赛" name="search">
            <UInput
              v-model="searchQuery"
              class="w-full"
              icon="i-lucide-search"
              placeholder="按比赛名、描述或分组搜索"
            />
          </UFormField>

          <UFormField label="状态筛选" name="status">
            <USelect v-model="statusFilter" :items="statusOptions" class="w-full" />
          </UFormField>
        </div>
      </UPageCard>

      <UEmpty
        v-if="games.length === 0"
        class="py-16"
        :icon="emptyStateMeta.icon"
        :title="emptyStateMeta.title"
        :description="emptyStateMeta.description"
        :actions="emptyStateMeta.actions"
      />

      <UEmpty
        v-else-if="filteredGames.length === 0"
        class="py-16"
        icon="i-lucide-search-x"
        :title="filteredEmptyStateMeta?.title || '当前筛选条件下没有匹配的比赛'"
        :description="filteredEmptyStateMeta?.description || '可以先清空筛选，再继续浏览全部公开比赛。'"
        :actions="[
          {
            label: '清空筛选',
            icon: 'i-lucide-refresh-cw',
            color: 'neutral',
            variant: 'outline',
            onClick: resetFilters,
          },
          {
            label: authState.user ? '回控制台' : '去登录',
            icon: authState.user ? 'i-lucide-layout-dashboard' : 'i-lucide-log-in',
            to: authState.user ? '/console' : '/login?redirect=%2Fgames',
            color: 'neutral',
            variant: 'ghost',
          },
        ]"
      />

      <div v-else class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <UPageCard
        v-for="game in filteredGames"
        :key="game.id"
        :to="`/games/${game.id}`"
      >
        <template #header>
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold">
              {{ game.name }}
            </h3>
            <UBadge :color="getStatusColor(game.status)" size="sm">
              {{ getStatusLabel(game.status) }}
            </UBadge>
          </div>
        </template>
        <p class="text-sm text-muted line-clamp-2">
          {{ game.description || '暂无描述' }}
        </p>
        <p class="mt-2 text-xs text-muted">
          报名方式：{{ game.registration_mode === 'auto_accept' ? '自动通过' : '人工审核' }}
        </p>
        <p class="mt-1 text-xs text-muted">
          {{ game.max_team_members ? `队伍人数上限：${game.max_team_members} 人` : '队伍人数不限' }}
        </p>
        <p class="mt-1 text-xs text-muted">
          {{ game.divisions?.length ? `比赛分组：${game.divisions.join(' / ')}` : '当前不区分分组榜' }}
        </p>
        <p class="mt-1 text-xs text-muted">
          {{ game.practice_mode ? '支持赛后练习' : '仅正赛模式' }} · {{ game.writeup_required ? '要求 Writeup' : '不要求 Writeup' }}
        </p>
        <p v-if="game.writeup_deadline" class="mt-1 text-xs text-muted">
          Writeup 截止：{{ new Date(game.writeup_deadline).toLocaleString() }}
        </p>
        <div class="mt-4 rounded-lg border border-default bg-elevated/50 px-3 py-3">
          <div class="mb-2 flex items-center justify-between gap-2">
            <span class="text-sm font-medium">我的参赛状态</span>
            <UBadge :color="getParticipationMeta(game).color" variant="soft" size="sm">
              {{ getParticipationMeta(game).label }}
            </UBadge>
          </div>
          <p class="text-xs text-muted leading-5">
            {{ getParticipationMeta(game).description }}
          </p>
          <p v-if="participationMap[game.id]?.division" class="mt-2 text-xs text-muted">
            当前分组：{{ participationMap[game.id]?.division }}
          </p>
        </div>
        <template #footer>
          <div class="space-y-3">
            <div class="text-xs text-muted space-y-1">
              <div class="flex items-center gap-1">
                <UIcon name="i-lucide-clock" class="size-3" />
                <span>{{ new Date(game.start_time).toLocaleString() }}</span>
              </div>
              <div class="flex items-center gap-1">
                <UIcon name="i-lucide-flag" class="size-3" />
                <span>{{ new Date(game.end_time).toLocaleString() }}</span>
              </div>
            </div>
            <UButton
              :label="getParticipationMeta(game).actionLabel"
              :to="getParticipationMeta(game).actionTo"
              variant="outline"
              block
            />
            <UButton
              v-if="getParticipationMeta(game).secondaryLabel && getParticipationMeta(game).secondaryTo"
              :label="getParticipationMeta(game).secondaryLabel"
              :to="getParticipationMeta(game).secondaryTo"
              variant="ghost"
              block
            />
          </div>
        </template>
      </UPageCard>
      </div>
    </template>
  </UContainer>
</template>
