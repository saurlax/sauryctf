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
  return resolveParticipationMeta({
    gameId: game.id,
    gamePhase: game.status === 'ended' ? 'ended' : game.status === 'draft' ? 'draft' : 'active',
    isLoggedIn: !!authState.user,
    participation: participationMap.value[game.id],
    registrationMode: game.registration_mode,
    maxTeamMembers: game.max_team_members,
  })
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

    <div v-else-if="games.length === 0" class="text-center py-16">
      <UIcon name="i-lucide-trophy" class="size-12 text-muted mx-auto mb-4" />
      <p class="text-muted">
        暂无比赛
      </p>
    </div>

    <div v-else class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <UPageCard
        v-for="game in games"
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
  </UContainer>
</template>
