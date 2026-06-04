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

      <UPageCard class="mb-6" title="筛选比赛" icon="i-lucide-filter">
        <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <UFormField label="搜索比赛" name="search">
            <UInput
              v-model="searchQuery"
              class="w-full"
              icon="i-lucide-search"
              placeholder="按比赛名、描述、公告或分组搜索"
            />
          </UFormField>

          <UFormField label="状态筛选" name="status">
            <USelect v-model="statusFilter" :items="statusOptions" class="w-full" />
          </UFormField>
        </div>
      </UPageCard>

      <div v-if="games.length === 0" class="text-center py-16">
        <UIcon name="i-lucide-trophy" class="size-12 text-muted mx-auto mb-4" />
        <p class="text-muted">
          暂无比赛
        </p>
      </div>

      <div v-else-if="filteredGames.length === 0" class="text-center py-16">
        <UIcon name="i-lucide-search-x" class="size-12 text-muted mx-auto mb-4" />
        <p class="text-muted">
          当前筛选条件下没有匹配的比赛
        </p>
      </div>

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
          </div>
        </template>
      </UPageCard>
      </div>
    </template>
  </UContainer>
</template>
