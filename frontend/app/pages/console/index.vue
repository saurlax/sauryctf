<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
})

import type { components } from '~/types/api'

const { authState, ensureInitialized } = useAuth()
const toast = useToast()
const route = useRoute()

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
  registration_mode?: 'review' | 'auto_accept'
  practice_mode?: boolean
  writeup_required?: boolean
}

type GameParticipation = components['schemas']['GameParticipation']

const isAdmin = computed(() => ['admin', 'super_admin'].includes(authState.user?.role || ''))
const { fetchParticipationMap } = useGameParticipationMap()
const loading = ref(true)
const adminActionGameId = ref<number | null>(null)
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

const onboardingMode = computed(() => {
  const value = route.query.onboarding
  return typeof value === 'string' ? value : ''
})

const showTeamOnboarding = computed(() => onboardingMode.value === 'team' && !team.value)

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
      $api('get', '/api/games', {
        query: isAdmin.value
          ? { all: true }
          : undefined,
      }),
    ])

    if (teamRes.status === 'fulfilled') {
      team.value = teamRes.value.team
    }
    else {
      team.value = null
    }

    if (gamesRes.status === 'fulfilled') {
      games.value = gamesRes.value
      participationMap.value = await fetchParticipationMap(games.value.map(game => game.id))
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

async function updateGameStatusQuick(game: GameSummary, status: GameSummary['status']) {
  adminActionGameId.value = game.id
  try {
    await $api('put', '/api/games/{id}', {
      params: {
        id: game.id,
      },
      body: {
        status,
      },
    })
    toast.add({
      title: '比赛状态已更新',
      description: `${game.name} 已切换为 ${getStatusMeta(status).label}。`,
      color: 'success',
    })
    await fetchConsoleData()
  }
  catch (e: any) {
    toast.add({ title: '比赛状态更新失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    adminActionGameId.value = null
  }
}

const pendingWriteupGames = computed(() =>
  games.value.filter(game => participationMap.value[game.id]?.missing_writeup),
)

const primaryPendingEntry = computed(() => myGameEntries.value[0] || null)

const nextStepItems = computed(() => {
  const items = [
    {
      key: 'team',
      title: '准备队伍',
      description: team.value
        ? `当前队伍为 ${team.value.name}，已经可以进入比赛报名流程。`
        : '先创建自己的队伍，或使用邀请码加入队伍，这是后续报名和提交 Flag 的前提。',
      done: Boolean(team.value),
      buttonLabel: team.value ? '管理队伍' : '去队伍页',
      buttonTo: '/console/team',
      buttonVariant: team.value ? 'outline' as const : 'solid' as const,
    },
  ]

  const joinedGame = myGameEntries.value.find(entry => entry.participation?.participated)
  items.push({
    key: 'game',
    title: '选择比赛',
    description: joinedGame
      ? `你已经和队伍关联到 ${joinedGame.game.name}，现在可以继续查看当前报名状态。`
      : team.value
        ? '接下来进入公开比赛详情页完成报名；自动通过比赛会直接获得参赛资格。'
        : '准备好队伍后，再去公开比赛列表选择目标比赛并完成报名。',
    done: Boolean(joinedGame),
    buttonLabel: joinedGame ? '查看比赛' : '浏览比赛',
    buttonTo: joinedGame ? `/games/${joinedGame.game.id}` : '/games',
    buttonVariant: joinedGame ? 'outline' as const : 'solid' as const,
  })

  const writeupGame = pendingWriteupGames.value[0]
  items.push({
    key: 'writeup',
    title: '处理当前待办',
    description: writeupGame
      ? `${writeupGame.name} 当前还需要补交 Writeup，请优先进入比赛详情页处理。`
      : primaryPendingEntry.value
        ? `${primaryPendingEntry.value.meta.label}：${primaryPendingEntry.value.meta.description}`
        : '当比赛进入审核、开赛或 Writeup 阶段后，这里会优先提示你下一步该处理的事项。',
    done: !writeupGame && !primaryPendingEntry.value,
    buttonLabel: writeupGame
      ? '去补交'
      : primaryPendingEntry.value
        ? primaryPendingEntry.value.meta.actionLabel
        : '查看控制台',
    buttonTo: writeupGame
      ? `/games/${writeupGame.id}`
      : primaryPendingEntry.value?.meta.actionTo || '/console',
    buttonVariant: writeupGame ? 'solid' as const : 'outline' as const,
  })

  return items
})

function getParticipationMeta(game: GameSummary) {
  const participation = participationMap.value[game.id]

  if (!team.value) {
    return {
      label: '未加入队伍',
      color: 'warning' as const,
      description: '先创建或加入队伍，之后才能报名比赛。',
      actionLabel: '去队伍页',
      actionTo: '/console/team',
      priority: 5,
    }
  }

  if (!participation?.participated) {
    if (game.status === 'ended') {
      return {
        label: '比赛已结束',
        color: 'neutral' as const,
        description: '当前无法再报名，但仍可查看题目与排行榜。',
        actionLabel: '查看详情',
        actionTo: `/games/${game.id}`,
        priority: 1,
      }
    }

    return {
      label: '尚未报名',
      color: 'info' as const,
      description: game.registration_mode === 'auto_accept'
        ? '进入详情页后可直接完成报名并获得参赛资格。'
        : '进入详情页后可提交报名，等待管理员审核。',
      actionLabel: '前往报名',
      actionTo: `/games/${game.id}`,
      priority: 4,
    }
  }

  if (participation.missing_writeup) {
    return {
      label: '待补 Writeup',
      color: 'warning' as const,
      description: '当前队伍已通过比赛报名，但还需要在截止前补交 Writeup。',
      actionLabel: '前往补交',
      actionTo: `/games/${game.id}`,
      priority: 10,
    }
  }

  if (participation.status === 'pending') {
    return {
      label: '待审核',
      color: 'warning' as const,
      description: '报名已提交，等待管理员审核通过。',
      actionLabel: '查看详情',
      actionTo: `/games/${game.id}`,
      priority: 8,
    }
  }

  if (participation.status === 'rejected') {
    return {
      label: '已拒绝',
      color: 'error' as const,
      description: '这场比赛的报名未通过，可以进入详情页重新确认。',
      actionLabel: '查看详情',
      actionTo: `/games/${game.id}`,
      priority: 7,
    }
  }

  if (participation.writeup_required && participation.writeup_submitted && participation.writeup_status === 'submitted') {
    return {
      label: 'Writeup 待审核',
      color: 'info' as const,
      description: 'Writeup 已提交，等待管理员审核。',
      actionLabel: '查看详情',
      actionTo: `/games/${game.id}`,
      priority: 6,
    }
  }

  return {
    label: '已报名',
    color: 'success' as const,
    description: game.status === 'active'
      ? '当前队伍已拥有参赛资格，可以直接进入比赛。'
      : '当前队伍已报名这场比赛，可继续关注比赛状态。',
    actionLabel: game.status === 'active' ? '进入比赛' : '查看详情',
    actionTo: `/games/${game.id}`,
    priority: game.status === 'active' ? 9 : 3,
  }
}

const myGameEntries = computed(() =>
  games.value
    .filter(game => {
      const participation = participationMap.value[game.id]
      return Boolean(team.value) && Boolean(participation?.participated || game.status !== 'ended')
    })
    .map(game => ({
      game,
      participation: participationMap.value[game.id],
      meta: getParticipationMeta(game),
    }))
    .sort((a, b) => {
      if (b.meta.priority !== a.meta.priority) {
        return b.meta.priority - a.meta.priority
      }
      return new Date(a.game.start_time).getTime() - new Date(b.game.start_time).getTime()
    })
    .slice(0, 6),
)

function getStatusMeta(status: GameSummary['status']) {
  const meta = {
    draft: { label: '未开始', color: 'warning' as const },
    active: { label: '进行中', color: 'success' as const },
    ended: { label: '已结束', color: 'neutral' as const },
  }
  return meta[status] || meta.draft
}

const adminManagedGames = computed(() =>
  [...games.value]
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    .slice(0, 5),
)

onMounted(async () => {
  await ensureInitialized()
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
      <UAlert
        v-if="showTeamOnboarding"
        class="mb-6"
        color="info"
        variant="soft"
        icon="i-lucide-flag"
        title="账号已经创建完成，下一步先准备队伍"
        description="CTF 的报名、提 Flag 和排行榜都基于队伍进行。先创建自己的队伍，或使用邀请码加入队伍，再回来选择比赛会最顺。"
      >
        <template #actions>
          <UButton
            label="立即去队伍页"
            color="info"
            variant="outline"
            size="sm"
            to="/console/team"
          />
        </template>
      </UAlert>

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
          <UPageCard v-if="isAdmin" title="管理员快捷操作" icon="i-lucide-shield-check">
            <div class="space-y-3">
              <div class="flex flex-wrap gap-2">
                <UButton label="打开管理端" icon="i-lucide-settings-2" to="/console/admin" variant="outline" />
                <UButton label="浏览公开页" icon="i-lucide-arrow-up-right" to="/games" variant="outline" />
              </div>

              <div
                v-for="game in adminManagedGames"
                :key="game.id"
                class="rounded-lg border border-default px-3 py-3"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <div class="font-medium">
                        {{ game.name }}
                      </div>
                      <UBadge :color="getStatusMeta(game.status).color" variant="soft">
                        {{ getStatusMeta(game.status).label }}
                      </UBadge>
                      <UBadge :color="game.is_public ? 'info' : 'neutral'" variant="soft">
                        {{ game.is_public ? '公开' : '私有' }}
                      </UBadge>
                    </div>
                    <div class="mt-2 text-sm text-muted">
                      {{ new Date(game.start_time).toLocaleString() }} - {{ new Date(game.end_time).toLocaleString() }}
                    </div>
                    <div class="mt-1 text-sm text-muted">
                      {{ game.registration_mode === 'auto_accept' ? '自动通过报名' : '人工审核报名' }} · {{ game.practice_mode ? '赛后练习开启' : '仅正赛' }} · {{ game.writeup_required ? '需要 Writeup' : '不要求 Writeup' }}
                    </div>
                  </div>

                  <div class="flex flex-wrap justify-end gap-2">
                    <UButton
                      size="sm"
                      variant="ghost"
                      icon="i-lucide-settings-2"
                      to="/console/admin"
                    >
                      管理
                    </UButton>
                    <UButton
                      size="sm"
                      variant="ghost"
                      icon="i-lucide-arrow-up-right"
                      :to="`/games/${game.id}`"
                    >
                      打开
                    </UButton>
                    <UButton
                      v-if="game.status === 'draft'"
                      size="sm"
                      icon="i-lucide-play"
                      :loading="adminActionGameId === game.id"
                      @click="updateGameStatusQuick(game, 'active')"
                    >
                      立即开赛
                    </UButton>
                    <UButton
                      v-else-if="game.status === 'active'"
                      size="sm"
                      color="warning"
                      variant="soft"
                      icon="i-lucide-circle-stop"
                      :loading="adminActionGameId === game.id"
                      @click="updateGameStatusQuick(game, 'ended')"
                    >
                      结束比赛
                    </UButton>
                    <UButton
                      v-else
                      size="sm"
                      color="neutral"
                      variant="soft"
                      icon="i-lucide-archive"
                      disabled
                    >
                      已归档
                    </UButton>
                  </div>
                </div>
              </div>

              <div v-if="!adminManagedGames.length" class="text-sm text-muted">
                当前还没有可管理的比赛，先去管理端创建一场比赛。
              </div>
            </div>
          </UPageCard>

          <UPageCard title="下一步" icon="i-lucide-list-checks">
            <div class="space-y-3">
              <div
                v-for="item in nextStepItems"
                :key="item.key"
                class="rounded-lg border border-default px-3 py-3"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <UIcon
                        :name="item.done ? 'i-lucide-circle-check-big' : 'i-lucide-arrow-right-circle'"
                        :class="item.done ? 'text-success' : 'text-primary'"
                        class="size-4 shrink-0"
                      />
                      <div class="font-medium">
                        {{ item.title }}
                      </div>
                    </div>
                    <div class="mt-2 text-sm text-muted">
                      {{ item.description }}
                    </div>
                  </div>
                  <UBadge :color="item.done ? 'success' : 'warning'" variant="soft">
                    {{ item.done ? '已就绪' : '待处理' }}
                  </UBadge>
                </div>

                <div class="mt-3 flex justify-end">
                  <UButton
                    size="sm"
                    :variant="item.buttonVariant"
                    :to="item.buttonTo"
                    :label="item.buttonLabel"
                  />
                </div>
              </div>
            </div>
          </UPageCard>

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

          <UPageCard title="我的比赛" icon="i-lucide-flag">
            <div v-if="myGameEntries.length" class="space-y-3">
              <div
                v-for="entry in myGameEntries"
                :key="entry.game.id"
                class="rounded-lg border border-default px-3 py-3"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="font-medium">
                      {{ entry.game.name }}
                    </div>
                    <div class="mt-1 text-sm text-muted">
                      {{ entry.meta.description }}
                    </div>
                  </div>
                  <UBadge :color="entry.meta.color" variant="soft">
                    {{ entry.meta.label }}
                  </UBadge>
                </div>

                <div class="mt-3 flex items-center justify-between gap-3 flex-wrap text-xs text-muted">
                  <div class="flex items-center gap-3 flex-wrap">
                    <span>{{ getStatusMeta(entry.game.status).label }}</span>
                    <span>{{ new Date(entry.game.start_time).toLocaleString() }}</span>
                    <span v-if="entry.participation?.division">分组：{{ entry.participation.division }}</span>
                    <span v-if="entry.participation?.team?.name">队伍：{{ entry.participation.team.name }}</span>
                  </div>
                  <UButton
                    size="sm"
                    variant="outline"
                    :to="entry.meta.actionTo"
                    :label="entry.meta.actionLabel"
                  />
                </div>
              </div>
            </div>
            <UEmpty
              v-else
              icon="i-lucide-flag"
              title="还没有关联比赛"
              :description="team ? '你已经有队伍了，现在可以去浏览公开比赛并完成报名。' : '先准备队伍，再进入公开比赛详情页完成报名。'"
              :actions="[
                {
                  label: team ? '浏览比赛' : '去队伍页',
                  icon: team ? 'i-lucide-trophy' : 'i-lucide-users',
                  to: team ? '/games' : '/console/team',
                  color: 'neutral',
                  variant: 'outline',
                },
              ]"
            />
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
