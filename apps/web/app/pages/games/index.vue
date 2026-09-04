<script setup lang="ts">
import type { components } from '~/types/api'
import { buildAuthEntryPath } from '~/utils/auth-redirect'

type Game = components['schemas']['Game']
type GameParticipation = components['schemas']['GameParticipation']

const { authState, ensureInitialized } = useAuth()
const { fetchParticipationMap } = useGameParticipationMap()
const { resolveParticipationMeta } = usePublicGameParticipationState()
const { businessContent, status: systemStatus, t } = usePlatformUi()
const games = ref<Game[]>([])
const participationMap = ref<Record<number, GameParticipation>>({})
const loading = ref(true)
const loadFailed = ref(false)
const searchQuery = ref('')
const statusFilter = ref<'all' | 'active' | 'ended'>('all')
const now = ref(Date.now())

async function fetchGames() {
  loading.value = true
  loadFailed.value = false
  try {
    const res = await $api('get', '/api/games')
    games.value = res || []
    await fetchParticipationStates()
  }
  catch {
    games.value = []
    loadFailed.value = true
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
    case 'active': return systemStatus('running')
    case 'draft': return systemStatus('draft')
    case 'ended': return systemStatus('ended')
    default: return status
  }
}

function getGamePhase(game: Game) {
  if (game.status === 'draft') {
    return 'draft' as const
  }

  const startAt = new Date(game.start_time).getTime()
  const endAt = new Date(game.end_time).getTime()

  if (now.value < startAt) {
    return 'before_start' as const
  }

  if (now.value > endAt || game.status === 'ended') {
    return 'ended' as const
  }

  return 'active' as const
}

function getDisplayStatusLabel(game: Game) {
  const phase = getGamePhase(game)
  if (phase === 'before_start') {
    return systemStatus('upcoming')
  }

  return getStatusLabel(phase === 'active' ? game.status : phase)
}

function getDisplayStatusColor(game: Game) {
  const phase = getGamePhase(game)
  if (phase === 'before_start') {
    return 'warning'
  }

  return getStatusColor(phase === 'active' ? game.status : phase)
}

function getParticipationMeta(game: Game) {
  const gamePath = `/games/${game.id}`

  return resolveParticipationMeta({
    gameId: game.id,
    gamePhase: getGamePhase(game),
    practiceMode: game.practice_mode,
    isLoggedIn: !!authState.user,
    participation: participationMap.value[game.id],
    registrationMode: game.registration_mode,
    maxTeamMembers: game.max_team_members,
    loginTo: buildAuthEntryPath('/login', gamePath),
    registerTo: buildAuthEntryPath('/register', gamePath),
    teamTo: buildRedirectedPath('/console/team', gamePath),
  })
}

function getGameSummaryRows(game: Game) {
  return [
    {
      label: '报名方式',
      value: game.registration_mode === 'auto_accept' ? '自动通过' : '人工审核',
    },
    {
      label: '队伍人数',
      value: game.max_team_members ? `上限 ${game.max_team_members} 人` : '不限制',
    },
    {
      label: '比赛分组',
      value: game.divisions?.length ? game.divisions.join(' / ') : '不区分分组',
    },
    {
      label: '赛后策略',
      value: game.practice_mode ? '保留练习入口' : '仅正赛模式',
    },
    {
      label: 'Writeup',
      value: game.writeup_required ? '要求提交' : '不要求',
    },
    ...(game.writeup_deadline
      ? [{
          label: 'Writeup 截止',
          value: new Date(game.writeup_deadline).toLocaleString(),
        }]
      : []),
  ]
}

function getGameContextRows(game: Game) {
  const participation = participationMap.value[game.id]

  return [
    {
      label: '我的状态',
      value: getParticipationMeta(game).label,
    },
    ...(participation?.division
      ? [{
          label: '当前分组',
          value: participation.division,
        }]
      : []),
    ...getGameSummaryRows(game),
  ]
}

const filteredGames = computed(() => {
  const keyword = searchQuery.value.trim().toLowerCase()

  return games.value.filter((game) => {
    const phase = getGamePhase(game)
    if (statusFilter.value === 'active' && phase !== 'active' && phase !== 'before_start') {
      return false
    }

    if (statusFilter.value === 'ended' && phase !== 'ended') {
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

const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '进行中 / 未开始', value: 'active' },
  { label: '已结束', value: 'ended' },
]

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
      <h1 class="text-3xl font-bold">
        比赛
      </h1>
    </div>

    <div v-if="loading" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader" class="size-8 animate-spin text-muted" />
    </div>

    <template v-else>
      <UPageCard v-if="!loadFailed && games.length > 0" class="mb-6" title="筛选" icon="i-lucide-filter">
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
        v-if="loadFailed"
        class="py-16"
        icon="i-lucide-circle-alert"
        title="暂时无法加载比赛"
      />

      <UEmpty
        v-else-if="games.length === 0"
        class="py-16"
        icon="i-lucide-trophy"
        title="暂无比赛"
      />

      <UEmpty
        v-else-if="filteredGames.length === 0"
        class="py-16"
        icon="i-lucide-search-x"
        title="没有匹配的比赛"
        :actions="[
          {
            label: '清空筛选',
            icon: 'i-lucide-refresh-cw',
            color: 'neutral',
            variant: 'outline',
            onClick: resetFilters,
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
              {{ businessContent(game.name) }}
            </h3>
            <UBadge :color="getDisplayStatusColor(game)" size="sm">
              {{ getDisplayStatusLabel(game) }}
            </UBadge>
          </div>
        </template>
        <p class="text-sm text-muted line-clamp-2">
          {{ game.description ? businessContent(game.description) : t('content.no_description') }}
        </p>
        <div class="mt-3 rounded-lg border border-default bg-elevated/50 px-3 py-3 text-xs">
          <div class="mb-2 flex items-center justify-between gap-2">
            <span class="text-sm font-medium text-highlighted">参赛与规则摘要</span>
            <UBadge :color="getParticipationMeta(game).color" variant="soft" size="sm">
              {{ getParticipationMeta(game).label }}
            </UBadge>
          </div>
          <div
            v-for="row in getGameContextRows(game)"
            :key="row.label"
            class="flex items-center justify-between gap-3 py-1.5"
          >
            <span class="text-muted">{{ row.label }}</span>
            <span class="text-right">{{ row.value }}</span>
          </div>
          <p class="text-xs text-muted leading-5">
            {{ getParticipationMeta(game).description }}
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
