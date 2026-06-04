<script setup lang="ts">
import type { components } from '~/types/api'

type Game = components['schemas']['Game']
type GameParticipation = components['schemas']['GameParticipation']

const toast = useToast()
const { authState, fetchUser } = useAuth()
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
  if (!authState.user || games.value.length === 0) {
    participationMap.value = {}
    return
  }

  const entries = await Promise.all(
    games.value.map(async (game) => {
      try {
        const participation = await $api('get', '/api/games/{id}/participation', {
          params: { id: game.id },
        })
        return [game.id, participation] as const
      }
      catch {
        return [game.id, { has_team: false, participated: false } as GameParticipation] as const
      }
    }),
  )

  participationMap.value = Object.fromEntries(entries)
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
  const participation = participationMap.value[game.id]
  const registrationMode = game.registration_mode || 'review'

  if (!authState.user) {
    return {
      label: '登录后可查看报名状态',
      color: 'neutral' as const,
      description: '先登录，再决定创建队伍或直接进入比赛详情页。',
      actionLabel: '去登录',
      actionTo: '/login',
    }
  }

  if (!participation?.has_team) {
    return {
      label: '未加入队伍',
      color: 'warning' as const,
      description: '需要先创建或加入队伍，才能报名比赛并提交 Flag。',
      actionLabel: '去队伍页',
      actionTo: '/console/team',
    }
  }

  if (participation.participated) {
    if (participation.status === 'pending') {
      return {
        label: '待审核',
        color: 'warning' as const,
        description: `当前队伍 ${participation.team?.name || ''} 已提交报名，等待管理员审核。`,
        actionLabel: '查看详情',
        actionTo: `/games/${game.id}`,
      }
    }

    if (participation.status === 'rejected') {
      return {
        label: '已拒绝',
        color: 'error' as const,
        description: `当前队伍 ${participation.team?.name || ''} 的报名未通过，可进入详情页重新确认。`,
        actionLabel: '重新报名',
        actionTo: `/games/${game.id}`,
      }
    }

    return {
      label: '已报名',
      color: 'success' as const,
      description: `当前队伍 ${participation.team?.name || ''} 已进入该比赛。`,
      actionLabel: '进入比赛',
      actionTo: `/games/${game.id}`,
    }
  }

  if (game.status === 'ended') {
    return {
      label: '比赛已结束',
      color: 'error' as const,
      description: '当前无法再报名，但仍可进入查看题目与排行榜。',
      actionLabel: '查看详情',
      actionTo: `/games/${game.id}`,
    }
  }

  return {
    label: '可报名',
    color: 'info' as const,
    description: registrationMode === 'auto_accept'
      ? `当前队伍 ${participation.team?.name || ''} 尚未报名，进入详情页后可直接完成参赛确认。`
      : `当前队伍 ${participation.team?.name || ''} 尚未报名，可进入详情页完成操作。`,
    actionLabel: '前往报名',
    actionTo: `/games/${game.id}`,
  }
}

onMounted(async () => {
  if (!authState.user) {
    await fetchUser()
  }

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
