<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
})

import type { components } from '~/types/api'

const { authState, ensureInitialized } = useAuth()
const toast = useToast()
const { data: setupStatus, refresh: refreshSetupStatus } = await useAPI('auth-setup-status', 'get', '/api/auth/setup-status')

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

interface AdminParticipantEntry {
  team_id: number
  team_name: string
  status: 'pending' | 'accepted' | 'rejected'
  division?: string
  joined_at: string
  score: number
  solve_count: number
}

interface AdminWriteupEntry {
  game_id: number
  team_id: number
  team_name: string
  submitted_by: number
  content: string
  status: 'submitted' | 'approved' | 'rejected'
  review_remark?: string
  submitted_at: string
  reviewed_at?: string | null
}

interface AdminAnnouncementEntry {
  id: number
  game_id: number
  game_name: string
  content: string
  created_by: number
  created_at: string
}

interface AdminSubmissionEntry {
  game_id: number
  game_name: string
  challenge_id: number
  challenge_title: string
  team_id: number
  team_name: string
  result: 'accepted' | 'wrong_flag' | 'already_solved' | 'rejected'
  submitted_at: string
}

interface AdminCheatClueEntry {
  game_id: number
  game_name: string
  challenge_id: number
  challenge_title: string
  submitted_flag: string
  team_count: number
  submission_count: number
  last_seen_at: string
}

interface AdminDashboardSummaryResponse {
  games: Array<{
    id: number
    name: string
    start_time: string
    end_time: string
    status: 'draft' | 'active' | 'ended'
    is_public: boolean
    registration_mode: 'review' | 'auto_accept'
    practice_mode: boolean
    writeup_required: boolean
  }>
  pending_participants: Array<AdminParticipantEntry & {
    game_id: number
    game_name: string
  }>
  pending_writeups: Array<AdminWriteupEntry & {
    game_id: number
    game_name: string
  }>
  latest_announcements: AdminAnnouncementEntry[]
  recent_submissions: AdminSubmissionEntry[]
  cheat_clues: AdminCheatClueEntry[]
}

interface PlayerAnnouncementEntry {
  id: number
  game_id: number
  content: string
  created_by: number
  created_at: string
  game: GameSummary
}

const isAdmin = computed(() => ['admin', 'super_admin'].includes(authState.user?.role || ''))
const { fetchParticipationMap } = useGameParticipationMap()
const loading = ref(true)
const loadingAdminTodo = ref(false)
const adminActionGameId = ref<number | null>(null)
const team = ref<TeamSummary | null>(null)
const games = ref<GameSummary[]>([])
const participationMap = ref<Record<number, GameParticipation>>({})
const adminPendingParticipants = ref<Array<AdminParticipantEntry & { game: GameSummary }>>([])
const adminPendingWriteups = ref<Array<AdminWriteupEntry & { game: GameSummary }>>([])
const adminLatestAnnouncements = ref<Array<AdminAnnouncementEntry & { game: GameSummary }>>([])
const adminRecentSubmissions = ref<Array<AdminSubmissionEntry & { game: GameSummary }>>([])
const adminCheatClues = ref<Array<AdminCheatClueEntry & { game: GameSummary }>>([])
const playerAnnouncements = ref<PlayerAnnouncementEntry[]>([])

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

const showPasswordSecurityNotice = computed(() => !!setupStatus.value?.password_change_recommended)

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
      await loadPlayerAnnouncements()
      await loadAdminTodoData()
      await refreshSetupStatus()
    }
    else {
      games.value = []
      participationMap.value = {}
      playerAnnouncements.value = []
      resetAdminTodoData()
      const e = gamesRes.reason as any
      toast.add({ title: '比赛列表加载失败', description: e.data?.message || e.message, color: 'error' })
    }
  }
  finally {
    loading.value = false
  }
}

async function loadPlayerAnnouncements() {
  const joinedGames = games.value.filter((game) => {
    const item = participationMap.value[game.id]
    return item?.participated
  })

  if (!joinedGames.length) {
    playerAnnouncements.value = []
    return
  }

  try {
    const results = await Promise.allSettled(
      joinedGames.map(async game => ({
        game,
        announcements: await $fetch<Array<Omit<PlayerAnnouncementEntry, 'game'>>>(`/api/games/${game.id}/announcements`),
      })),
    )

    playerAnnouncements.value = results
      .filter((result): result is PromiseFulfilledResult<{ game: GameSummary, announcements: Array<Omit<PlayerAnnouncementEntry, 'game'>> }> => result.status === 'fulfilled')
      .flatMap(result =>
        result.value.announcements.map(item => ({
          ...item,
          game: result.value.game,
        })),
      )
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 6)
  }
  catch {
    playerAnnouncements.value = []
  }
}

function resetAdminTodoData() {
  adminPendingParticipants.value = []
  adminPendingWriteups.value = []
  adminLatestAnnouncements.value = []
  adminRecentSubmissions.value = []
  adminCheatClues.value = []
}

async function loadAdminTodoData() {
  if (!isAdmin.value) {
    resetAdminTodoData()
    return
  }

  loadingAdminTodo.value = true
  try {
    const summary = await $fetch<AdminDashboardSummaryResponse>('/api/admin/dashboard/summary')
    const gameById = new Map(games.value.map(game => [game.id, game]))
    const fallbackGame = (id: number, name: string): GameSummary => ({
      id,
      name,
      start_time: '',
      end_time: '',
      status: 'draft',
    })

    adminPendingParticipants.value = summary.pending_participants.map(item => ({
      ...item,
      game: gameById.get(item.game_id) || fallbackGame(item.game_id, item.game_name),
    }))
    adminPendingWriteups.value = summary.pending_writeups.map(item => ({
      ...item,
      game: gameById.get(item.game_id) || fallbackGame(item.game_id, item.game_name),
    }))
    adminLatestAnnouncements.value = summary.latest_announcements.map(item => ({
      ...item,
      game: gameById.get(item.game_id) || fallbackGame(item.game_id, item.game_name),
    }))
    adminRecentSubmissions.value = summary.recent_submissions.map(item => ({
      ...item,
      game: gameById.get(item.game_id) || fallbackGame(item.game_id, item.game_name),
    }))
    adminCheatClues.value = summary.cheat_clues.map(item => ({
      ...item,
      game: gameById.get(item.game_id) || fallbackGame(item.game_id, item.game_name),
    }))
  }
  catch (e: any) {
    resetAdminTodoData()
    toast.add({ title: '管理待办加载失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    loadingAdminTodo.value = false
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

const adminTodoCards = computed(() => [
  {
    label: '待审核报名',
    value: String(adminPendingParticipants.value.length),
    hint: '最近 5 场比赛里仍待审核的队伍报名',
    icon: 'i-lucide-hourglass',
    color: 'warning' as const,
  },
  {
    label: '待审 Writeup',
    value: String(adminPendingWriteups.value.length),
    hint: '最近 5 场比赛里等待管理员处理的 Writeup',
    icon: 'i-lucide-file-clock',
    color: 'info' as const,
  },
  {
    label: '最新公告',
    value: String(adminLatestAnnouncements.value.length),
    hint: '最近 5 场比赛里已发布的最新公告记录',
    icon: 'i-lucide-megaphone',
    color: 'success' as const,
  },
  {
    label: '最近提交',
    value: String(adminRecentSubmissions.value.length),
    hint: '最近 5 场比赛里最新的提交记录',
    icon: 'i-lucide-activity',
    color: 'neutral' as const,
  },
  {
    label: '可疑线索',
    value: String(adminCheatClues.value.length),
    hint: '多队重复错误 Flag 的轻量线索',
    icon: 'i-lucide-shield-alert',
    color: 'error' as const,
  },
])

function getSubmissionResultMeta(result: AdminSubmissionEntry['result']) {
  if (result === 'accepted') {
    return { label: '正确', color: 'success' as const }
  }
  if (result === 'already_solved') {
    return { label: '已解过', color: 'info' as const }
  }
  if (result === 'rejected') {
    return { label: '拒绝', color: 'neutral' as const }
  }
  return { label: '错误', color: 'warning' as const }
}

const primaryPendingEntry = computed(() => myGameEntries.value[0] || null)

const statusItems = computed(() => {
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
      ? `${writeupGame.name} 当前还需要补交 Writeup，请进入比赛详情页处理。`
      : primaryPendingEntry.value
        ? `${primaryPendingEntry.value.meta.label}：${primaryPendingEntry.value.meta.description}`
        : '当比赛进入审核、开赛或 Writeup 阶段后，这里会优先显示当前最需要处理的事项。',
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
        v-if="showPasswordSecurityNotice"
        class="mb-6"
        color="warning"
        variant="soft"
        icon="i-lucide-key-round"
        title="请尽快更新管理员密码"
        description="当前管理员账号仍在使用高风险口令。请先前往账号安全页修改密码，再继续长期使用管理端。"
      >
        <template #actions>
          <UButton
            label="前往修改密码"
            color="warning"
            variant="outline"
            size="sm"
            to="/console/account"
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
                <UButton label="用户管理" icon="i-lucide-users-round" to="/console/admin/users" variant="outline" />
                <UButton label="审计日志" icon="i-lucide-scroll-text" to="/console/admin/audit" variant="outline" />
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

              <UEmpty
                v-if="!adminManagedGames.length"
                icon="i-lucide-calendar-plus"
                title="还没有可管理的比赛"
                description="当前还没有任何比赛进入最近管理列表。创建比赛后，这里会显示最近的管理入口。"
                :actions="[{
                  label: '去创建比赛',
                  icon: 'i-lucide-settings-2',
                  to: '/console/admin',
                  color: 'neutral',
                  variant: 'outline',
                }]"
              />
            </div>
          </UPageCard>

          <UPageCard title="当前状态" icon="i-lucide-list-checks">
            <div class="space-y-3">
              <div
                v-for="item in statusItems"
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

          <UPageCard :title="team ? '常用操作' : '下一步入口'" icon="i-lucide-rocket">
            <div class="flex flex-col gap-3">
              <UButton :label="team ? '管理我的队伍' : '去准备队伍'" icon="i-lucide-users" to="/console/team" variant="outline" block />
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
            <UEmpty
              v-else
              icon="i-lucide-calendar-range"
              title="还没有可浏览的公开比赛"
              :description="isAdmin ? '创建并发布公开比赛后，这里会开始出现内容。' : '当前还没有公开中的比赛，稍后再来查看即可。'"
              :actions="isAdmin
                ? [{
                    label: '去管理端建赛',
                    icon: 'i-lucide-settings-2',
                    to: '/console/admin',
                    color: 'neutral',
                    variant: 'outline',
                  }]
                : []"
            />
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
              :description="team ? '你已经有队伍了，现在可以进入公开比赛页完成报名。' : '准备队伍后，再进入公开比赛详情页完成报名。'"
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

          <UPageCard title="我的比赛公告" icon="i-lucide-megaphone">
            <div v-if="playerAnnouncements.length" class="space-y-3">
              <div
                v-for="announcement in playerAnnouncements"
                :key="`${announcement.game.id}-${announcement.id}`"
                class="rounded-lg border border-default px-3 py-3"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="font-medium">
                      {{ announcement.game.name }}
                    </div>
                    <div class="mt-1 text-xs text-muted">
                      {{ new Date(announcement.created_at).toLocaleString() }}
                    </div>
                  </div>
                  <UButton
                    size="sm"
                    variant="ghost"
                    icon="i-lucide-arrow-up-right"
                    :to="`/games/${announcement.game.id}`"
                  />
                </div>
                <div class="mt-3 text-sm text-muted whitespace-pre-wrap leading-6">
                  {{ announcement.content }}
                </div>
              </div>
            </div>
            <UEmpty
              v-else
              icon="i-lucide-megaphone"
              title="还没有可跟进的比赛公告"
              :description="team ? '加入比赛后，这里会汇总你当前已关联比赛的最新公告。' : '准备队伍并加入比赛后，这里才会出现与你相关的公告通知。'"
              :actions="[{
                label: team ? '查看我的比赛' : '去队伍页',
                icon: team ? 'i-lucide-flag' : 'i-lucide-users',
                to: team ? '/games' : '/console/team',
                color: 'neutral',
                variant: 'outline',
              }]"
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
          <UPageCard v-if="isAdmin" title="管理待办" icon="i-lucide-list-todo">
            <div v-if="loadingAdminTodo" class="flex justify-center py-8">
              <UIcon name="i-lucide-loader-2" class="animate-spin size-6 text-muted" />
            </div>
            <div v-else class="space-y-4">
              <UPageGrid :cols="{ default: 1, sm: 2, xl: 5 }">
                <UPageCard
                  v-for="card in adminTodoCards"
                  :key="card.label"
                  :title="card.value"
                  :description="card.label"
                  :icon="card.icon"
                >
                  <template #footer>
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-xs text-muted">{{ card.hint }}</span>
                      <UBadge :color="card.color" variant="subtle" size="sm">
                        {{ card.label }}
                      </UBadge>
                    </div>
                  </template>
                </UPageCard>
              </UPageGrid>

              <div class="grid gap-4 xl:grid-cols-2">
                <div class="rounded-lg border border-default px-3 py-3">
                  <div class="mb-3 flex items-center justify-between gap-2">
                    <div class="font-medium">
                      最近待审核报名
                    </div>
                    <UButton size="sm" variant="ghost" icon="i-lucide-settings-2" to="/console/admin">
                      去管理
                    </UButton>
                  </div>
                  <div v-if="adminPendingParticipants.length" class="space-y-2">
                    <div
                      v-for="item in adminPendingParticipants"
                      :key="`${item.game.id}-${item.team_id}`"
                      class="rounded-md bg-elevated/60 px-3 py-2"
                    >
                      <div class="flex items-center justify-between gap-3">
                        <div class="min-w-0">
                          <div class="text-sm font-medium">
                            {{ item.team_name }}
                          </div>
                          <div class="text-xs text-muted">
                            {{ item.game.name }} · {{ new Date(item.joined_at).toLocaleString() }}
                          </div>
                        </div>
                        <UBadge color="warning" variant="soft">
                          待审核
                        </UBadge>
                      </div>
                    </div>
                  </div>
                  <UEmpty
                    v-else
                    icon="i-lucide-hourglass"
                    title="当前没有待审核报名"
                    description="最近 5 场比赛里没有仍待处理的报名申请。新的报名提交后会自动出现在这里。"
                    :actions="[{
                      label: '打开管理端',
                      icon: 'i-lucide-settings-2',
                      to: '/console/admin',
                      color: 'neutral',
                      variant: 'outline',
                    }]"
                  />
                </div>

                <div class="rounded-lg border border-default px-3 py-3">
                  <div class="mb-3 flex items-center justify-between gap-2">
                    <div class="font-medium">
                      最近待审 Writeup
                    </div>
                    <UButton size="sm" variant="ghost" icon="i-lucide-file-text" to="/console/admin">
                      去处理
                    </UButton>
                  </div>
                  <div v-if="adminPendingWriteups.length" class="space-y-2">
                    <div
                      v-for="item in adminPendingWriteups"
                      :key="`${item.game.id}-${item.team_id}`"
                      class="rounded-md bg-elevated/60 px-3 py-2"
                    >
                      <div class="flex items-center justify-between gap-3">
                        <div class="min-w-0">
                          <div class="text-sm font-medium">
                            {{ item.team_name }}
                          </div>
                          <div class="text-xs text-muted">
                            {{ item.game.name }} · {{ new Date(item.submitted_at).toLocaleString() }}
                          </div>
                        </div>
                        <UBadge color="info" variant="soft">
                          待审
                        </UBadge>
                      </div>
                    </div>
                  </div>
                  <UEmpty
                    v-else
                    icon="i-lucide-file-clock"
                    title="当前没有待审 Writeup"
                    description="最近 5 场比赛里没有等待管理员处理的 Writeup。新的提交完成后会自动出现在这里。"
                    :actions="[{
                      label: '查看管理端',
                      icon: 'i-lucide-file-text',
                      to: '/console/admin',
                      color: 'neutral',
                      variant: 'outline',
                    }]"
                  />
                </div>
              </div>

              <div class="rounded-lg border border-default px-3 py-3">
                <div class="mb-3 flex items-center justify-between gap-2">
                  <div class="font-medium">
                    赛时摘要
                  </div>
                  <UButton size="sm" variant="ghost" icon="i-lucide-settings-2" to="/console/admin">
                    打开管理端
                  </UButton>
                </div>

                <div class="grid gap-4 xl:grid-cols-3">
                  <div class="space-y-2">
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-sm font-medium text-highlighted">最新公告</span>
                      <UBadge color="success" variant="subtle" size="sm">
                        {{ adminLatestAnnouncements.length }}
                      </UBadge>
                    </div>
                    <div v-if="adminLatestAnnouncements.length" class="space-y-2">
                      <div
                        v-for="item in adminLatestAnnouncements.slice(0, 3)"
                        :key="item.id"
                        class="rounded-md bg-elevated/60 px-3 py-2"
                      >
                        <div class="text-sm font-medium">
                          {{ item.game.name }}
                        </div>
                        <div class="mt-1 line-clamp-2 text-xs text-muted">
                          {{ item.content }}
                        </div>
                      </div>
                    </div>
                    <p v-else class="text-sm text-muted">
                      近期还没有新的比赛公告。
                    </p>
                  </div>

                  <div class="space-y-2">
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-sm font-medium text-highlighted">最近提交</span>
                      <UBadge color="neutral" variant="subtle" size="sm">
                        {{ adminRecentSubmissions.length }}
                      </UBadge>
                    </div>
                    <div v-if="adminRecentSubmissions.length" class="space-y-2">
                      <div
                        v-for="item in adminRecentSubmissions.slice(0, 3)"
                        :key="`${item.game_id}-${item.team_id}-${item.challenge_id}-${item.submitted_at}`"
                        class="rounded-md bg-elevated/60 px-3 py-2"
                      >
                        <div class="flex items-start justify-between gap-2">
                          <div class="min-w-0">
                            <div class="text-sm font-medium">
                              {{ item.team_name }} · {{ item.challenge_title }}
                            </div>
                            <div class="text-xs text-muted">
                              {{ item.game.name }}
                            </div>
                          </div>
                          <UBadge :color="getSubmissionResultMeta(item.result).color" variant="soft" size="sm">
                            {{ getSubmissionResultMeta(item.result).label }}
                          </UBadge>
                        </div>
                      </div>
                    </div>
                    <p v-else class="text-sm text-muted">
                      近期还没有新的提交记录。
                    </p>
                  </div>

                  <div class="space-y-2">
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-sm font-medium text-highlighted">可疑线索</span>
                      <UBadge color="error" variant="subtle" size="sm">
                        {{ adminCheatClues.length }}
                      </UBadge>
                    </div>
                    <div v-if="adminCheatClues.length" class="space-y-2">
                      <div
                        v-for="item in adminCheatClues.slice(0, 3)"
                        :key="`${item.game_id}-${item.challenge_id}-${item.submitted_flag}`"
                        class="rounded-md bg-elevated/60 px-3 py-2"
                      >
                        <div class="text-sm font-medium">
                          {{ item.challenge_title }}
                        </div>
                        <div class="text-xs text-muted">
                          {{ item.game.name }} · {{ item.team_count }} 队重复
                        </div>
                      </div>
                    </div>
                    <p v-else class="text-sm text-muted">
                      近期没有明显的异常提交线索。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </UPageCard>

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
            <UEmpty
              v-else
              icon="i-lucide-users-round"
              title="你还没有加入队伍"
              description="创建或加入队伍后，才可以报名比赛、启动实例并提交题目。"
              :actions="[{
                label: '去创建或加入队伍',
                icon: 'i-lucide-users-round',
                to: '/console/team',
                color: 'neutral',
                variant: 'outline',
              }]"
            />
          </UPageCard>

          <UPageCard :title="isAdmin ? '账号与导航' : '常用入口'" :icon="isAdmin ? 'i-lucide-shield-check' : 'i-lucide-navigation'">
            <div class="space-y-3 text-sm text-muted">
              <UButton
                label="账号安全"
                icon="i-lucide-key-round"
                to="/console/account"
                variant="ghost"
                block
              />
              <UButton
                v-if="isAdmin"
                label="赛事管理"
                icon="i-lucide-settings-2"
                to="/console/admin"
                variant="outline"
                block
              />
              <UButton
                :label="isAdmin ? '浏览公开页' : '浏览比赛'"
                icon="i-lucide-trophy"
                to="/games"
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
