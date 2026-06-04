<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
})

import type { components } from '~/types/api'

const { authState, fetchUser } = useAuth()
const toast = useToast()

interface TeamSummary {
  id: number
  name: string
  invite_code: string
  members?: Array<{
    id: number
    user_id: number
    role: string
  }>
}

interface GameSummary {
  id: number
  name: string
  description?: string
  start_time: string
  end_time: string
  status: 'draft' | 'active' | 'ended'
  is_public?: boolean
}

type GameParticipation = components['schemas']['GameParticipation']

const isAdmin = computed(() => ['admin', 'super_admin'].includes(authState.user?.role || ''))
const loading = ref(true)
const team = ref<TeamSummary | null>(null)
const games = ref<GameSummary[]>([])
const participationMap = ref<Record<number, GameParticipation>>({})

const activeGames = computed(() => games.value.filter(game => game.status === 'active'))
const upcomingGames = computed(() => games.value.filter(game => game.status === 'draft'))
const endedGames = computed(() => games.value.filter(game => game.status === 'ended'))

const recentGames = computed(() =>
  [...games.value]
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    .slice(0, 4),
)

const nextGame = computed(() => {
  const now = Date.now()
  return [...games.value]
    .filter(game => new Date(game.end_time).getTime() >= now)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())[0] || null
})

const stats = computed(() => [
  { label: '我的队伍', value: team.value?.name || '未加入', icon: 'i-lucide-users' },
  { label: '进行中比赛', value: String(activeGames.value.length), icon: 'i-lucide-trophy' },
  { label: '即将开始', value: String(upcomingGames.value.length), icon: 'i-lucide-timer-reset' },
  { label: '历史比赛', value: String(endedGames.value.length), icon: 'i-lucide-archive' },
])

async function fetchConsoleData() {
  loading.value = true
  try {
    const [teamRes, gamesRes] = await Promise.allSettled([
      $api('get', '/api/teams/my'),
      $api('get', '/api/games'),
    ])

    if (teamRes.status === 'fulfilled') {
      team.value = teamRes.value.team
    }
    else {
      team.value = null
    }

    if (gamesRes.status === 'fulfilled') {
      games.value = gamesRes.value
      if (authState.user && games.value.length > 0) {
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
    }
    else {
      games.value = []
      participationMap.value = {}
      const e = gamesRes.reason as any
      toast.add({ title: '比赛列表加载失败', description: e.data?.message || e.message, color: 'error' })
    }
  }
  finally {
    loading.value = false
  }
}

const pendingWriteupGames = computed(() =>
  games.value.filter(game => participationMap.value[game.id]?.missing_writeup),
)

function getStatusMeta(status: GameSummary['status']) {
  const meta = {
    draft: { label: '未开始', color: 'warning' as const },
    active: { label: '进行中', color: 'success' as const },
    ended: { label: '已结束', color: 'neutral' as const },
  }
  return meta[status] || meta.draft
}

onMounted(async () => {
  if (!authState.user) {
    await fetchUser()
  }

  await fetchConsoleData()
})
</script>

<template>
  <div class="py-8">
    <div class="mb-8 flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-3xl font-bold">
          控制台
        </h1>
        <p class="text-muted mt-1">
          欢迎回来，{{ authState.user?.username || '选手' }}
        </p>
      </div>

      <UButton
        v-if="isAdmin"
        label="赛事管理"
        icon="i-lucide-settings-2"
        to="/console/admin"
        variant="outline"
      />
    </div>

    <template v-if="loading">
      <div class="flex justify-center py-16">
        <UIcon name="i-lucide-loader-2" class="animate-spin size-8 text-muted" />
      </div>
    </template>

    <template v-else>
      <UPageGrid :cols="{ default: 1, sm: 2, lg: 4 }">
        <UPageCard
          v-for="stat in stats"
          :key="stat.label"
          :title="stat.value"
          :description="stat.label"
          :icon="stat.icon"
        />
      </UPageGrid>

      <div class="mt-8 grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6">
        <div class="space-y-6">
          <UPageCard title="快捷操作" icon="i-lucide-rocket">
            <div class="flex flex-col gap-3">
              <UButton label="我的队伍" icon="i-lucide-users" to="/console/team" variant="outline" block />
              <UButton label="浏览比赛" icon="i-lucide-trophy" to="/games" variant="outline" block />
              <UButton
                v-if="nextGame"
                :label="`进入比赛：${nextGame.name}`"
                icon="i-lucide-arrow-right"
                :to="`/games/${nextGame.id}`"
                block
              />
            </div>
          </UPageCard>

          <UPageCard title="最近比赛" icon="i-lucide-calendar-range">
            <div v-if="recentGames.length" class="space-y-3">
              <div
                v-for="game in recentGames"
                :key="game.id"
                class="flex items-start justify-between gap-3 rounded-lg border border-default px-3 py-3"
              >
                <div class="min-w-0">
                  <div class="font-medium">
                    {{ game.name }}
                  </div>
                  <div class="text-sm text-muted">
                    {{ new Date(game.start_time).toLocaleString() }}
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <UBadge :color="getStatusMeta(game.status).color" variant="soft">
                    {{ getStatusMeta(game.status).label }}
                  </UBadge>
                  <UButton
                    size="sm"
                    variant="ghost"
                    icon="i-lucide-arrow-up-right"
                    :to="`/games/${game.id}`"
                  />
                </div>
              </div>
            </div>
            <div v-else class="text-sm text-muted">
              当前还没有可浏览的公开比赛。
            </div>
          </UPageCard>

          <UPageCard v-if="pendingWriteupGames.length" title="待补交 Writeup" icon="i-lucide-file-warning">
            <div class="space-y-3">
              <div
                v-for="game in pendingWriteupGames"
                :key="game.id"
                class="flex items-start justify-between gap-3 rounded-lg border border-default px-3 py-3"
              >
                <div class="min-w-0">
                  <div class="font-medium">
                    {{ game.name }}
                  </div>
                  <div class="text-sm text-muted">
                    比赛已要求补交 Writeup，请尽快进入详情页处理。
                  </div>
                </div>
                <UButton
                  size="sm"
                  icon="i-lucide-arrow-up-right"
                  :to="`/games/${game.id}`"
                >
                  前往补交
                </UButton>
              </div>
            </div>
          </UPageCard>
        </div>

        <div class="space-y-6">
          <UPageCard :title="team ? '我的队伍概览' : '队伍状态'" icon="i-lucide-users-round">
            <div v-if="team" class="space-y-3 text-sm">
              <div class="flex items-center justify-between gap-3">
                <span class="text-muted">队伍名称</span>
                <span>{{ team.name }}</span>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-muted">邀请码</span>
                <code class="rounded bg-elevated px-2 py-1 text-xs">{{ team.invite_code }}</code>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-muted">成员数量</span>
                <span>{{ team.members?.length || 0 }}</span>
              </div>
              <UButton label="管理队伍" to="/console/team" variant="outline" block />
            </div>
            <div v-else class="space-y-3">
              <p class="text-sm text-muted">
                你还没有加入队伍。创建或加入队伍后，就可以报名比赛并提交题目。
              </p>
              <UButton label="去创建或加入队伍" to="/console/team" block />
            </div>
          </UPageCard>

          <UPageCard :title="isAdmin ? '管理提示' : '参赛提示'" :icon="isAdmin ? 'i-lucide-shield-check' : 'i-lucide-info'">
            <div class="space-y-3 text-sm text-muted">
              <p v-if="isAdmin">
                你当前拥有管理权限，已经可以在管理端创建比赛、创建题目、挂载题目并移除比赛题目。
              </p>
              <p v-else>
                建议先准备队伍，再进入目标比赛详情页完成报名，比赛开始后即可提交 Flag。
              </p>
              <UButton
                v-if="isAdmin"
                label="打开管理端"
                icon="i-lucide-settings-2"
                to="/console/admin"
                variant="outline"
                block
              />
            </div>
          </UPageCard>
        </div>
      </div>
    </template>
  </div>
</template>
