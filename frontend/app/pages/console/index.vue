<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
})

import type { components } from '~/types/api'

const { authState, ensureInitialized } = useAuth()
const toast = useToast()
const { data: securityStatus, refresh: refreshSecurityStatus } = await useAPI('auth-security-status', 'get', '/api/auth/security-status')
const { resolveParticipationMeta } = usePublicGameParticipationState()

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
type PublicGamePhase = 'draft' | 'before_start' | 'active' | 'ended'

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
const now = ref(Date.now())

function getGamePhase(game: GameSummary): PublicGamePhase {
  if (game.status === 'draft') {
    return 'draft'
  }

  const startAt = new Date(game.start_time).getTime()
  const endAt = new Date(game.end_time).getTime()

  if (now.value < startAt) {
    return 'before_start'
  }

  if (now.value > endAt || game.status === 'ended') {
    return 'ended'
  }

  return 'active'
}

function isPubliclyVisibleGame(game: GameSummary) {
  return !!game.is_public && getGamePhase(game) !== 'draft'
}

const publicGames = computed(() => games.value.filter(game => isPubliclyVisibleGame(game)))
const activeGames = computed(() => publicGames.value.filter(game => getGamePhase(game) === 'active'))
const upcomingGames = computed(() => publicGames.value.filter(game => getGamePhase(game) === 'before_start'))
const endedGames = computed(() => publicGames.value.filter(game => getGamePhase(game) === 'ended'))

const recentGames = computed(() =>
  [...publicGames.value]
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    .slice(0, 4),
)

const nextGame = computed(() => {
  return [...publicGames.value]
    .filter(game => getGamePhase(game) !== 'ended')
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())[0] || null
})

const showPasswordSecurityNotice = computed(() => !!securityStatus.value?.password_change_recommended)

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
      await refreshSecurityStatus()
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

type AdminSection = '#participants' | '#writeups' | '#announcements' | '#submissions' | '#clues'

function buildAdminSectionLink(section: AdminSection) {
  return `/console/admin?section=${encodeURIComponent(section)}`
}

function buildAdminGameSectionLink(gameId: number, section: AdminSection, challengeId?: number) {
  const query = new URLSearchParams({
    game_id: String(gameId),
    section,
  })

  if (typeof challengeId === 'number' && Number.isFinite(challengeId) && challengeId > 0) {
    query.set('challenge_id', String(challengeId))
  }

  return `/console/admin?${query.toString()}`
}

const adminParticipantSectionLink = computed(() => {
  const target = adminPendingParticipants.value[0]
  return target ? buildAdminGameSectionLink(target.game.id, '#participants') : buildAdminSectionLink('#participants')
})

const adminWriteupSectionLink = computed(() => {
  const target = adminPendingWriteups.value[0]
  return target ? buildAdminGameSectionLink(target.game.id, '#writeups') : buildAdminSectionLink('#writeups')
})

const adminAnnouncementSectionLink = computed(() => {
  const target = adminLatestAnnouncements.value[0]
  return target ? buildAdminGameSectionLink(target.game.id, '#announcements') : buildAdminSectionLink('#announcements')
})

const adminSubmissionSectionLink = computed(() => {
  const target = adminRecentSubmissions.value[0]
  return target ? buildAdminGameSectionLink(target.game.id, '#submissions', target.challenge_id) : buildAdminSectionLink('#submissions')
})

const adminClueSectionLink = computed(() => {
  const target = adminCheatClues.value[0]
  return target ? buildAdminGameSectionLink(target.game.id, '#clues', target.challenge_id) : buildAdminSectionLink('#clues')
})

const adminPrioritySummaryRows = computed(() => [
  {
    label: '待审核报名',
    value: `${adminPendingParticipants.value.length} 项`,
    to: adminParticipantSectionLink.value,
  },
  {
    label: '待审 Writeup',
    value: `${adminPendingWriteups.value.length} 项`,
    to: adminWriteupSectionLink.value,
  },
])

const adminSignalSummaryRows = computed(() => [
  {
    label: '最新公告',
    value: `${adminLatestAnnouncements.value.length} 条`,
    to: adminAnnouncementSectionLink.value,
  },
  {
    label: '最近提交',
    value: `${adminRecentSubmissions.value.length} 条`,
    to: adminSubmissionSectionLink.value,
  },
  {
    label: '可疑线索',
    value: `${adminCheatClues.value.length} 条`,
    to: adminClueSectionLink.value,
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

const consoleSummaryRows = computed(() => {
  const joinedGame = myGameEntries.value.find(entry => entry.participation?.participated)
  const writeupGame = pendingWriteupGames.value[0]

  return [
    {
      label: '队伍状态',
      value: team.value ? team.value.name : '未加入队伍',
    },
    {
      label: '当前比赛',
      value: joinedGame ? joinedGame.game.name : team.value ? '还未关联比赛' : '准备队伍后可继续报名',
    },
    {
      label: '当前重点',
      value: writeupGame
        ? `${writeupGame.name} 需要补交 Writeup`
        : primaryPendingEntry.value
          ? primaryPendingEntry.value.meta.label
          : '当前没有紧急待办',
    },
  ]
})

const consoleWorkbenchActions = computed(() => {
  const actions: Array<{
    label: string
    icon: string
    to: string
    variant?: 'solid' | 'outline' | 'ghost' | 'soft' | 'subtle' | 'link'
  }> = [
    {
      label: team.value ? '管理我的队伍' : '去准备队伍',
      icon: 'i-lucide-users',
      to: '/console/team',
      variant: 'outline',
    },
    {
      label: '浏览比赛',
      icon: 'i-lucide-trophy',
      to: '/games',
      variant: 'outline',
    },
  ]

  if (nextGame.value) {
    actions.unshift({
      label: `进入比赛：${nextGame.value.name}`,
      icon: 'i-lucide-arrow-right',
      to: `/games/${nextGame.value.id}`,
      variant: 'solid',
    })
  }

  return actions
})

const consoleActionButtons = computed(() => {
  const actions: Array<{
    label: string
    icon?: string
    to: string
    variant?: 'solid' | 'outline' | 'ghost' | 'soft' | 'subtle' | 'link'
  }> = [
    {
      label: consoleNextActionMeta.value.buttonLabel,
      to: consoleNextActionMeta.value.buttonTo,
      variant: consoleNextActionMeta.value.buttonVariant,
    },
  ]

  for (const action of consoleWorkbenchActions.value) {
    const duplicated = actions.some(item => item.to === action.to && item.label === action.label)
    if (!duplicated) {
      actions.push(action)
    }
  }

  return actions
})

const consoleNextActionMeta = computed(() => {
  const writeupGame = pendingWriteupGames.value[0]
  if (writeupGame) {
    return {
      title: '需要补交 Writeup',
      description: `${writeupGame.name} 当前仍需补交 Writeup，请优先回到比赛详情页继续处理。`,
      color: 'warning' as const,
      buttonLabel: '前往补交',
      buttonTo: `/games/${writeupGame.id}`,
      buttonVariant: 'solid' as const,
    }
  }

  if (!team.value) {
    return {
      title: '需要先准备队伍',
      description: '创建队伍或通过邀请码加入队伍后，才能继续报名、启动实例和提交题目。',
      color: 'warning' as const,
      buttonLabel: '去队伍页',
      buttonTo: '/console/team',
      buttonVariant: 'solid' as const,
    }
  }

  if (primaryPendingEntry.value) {
    return {
      title: primaryPendingEntry.value.meta.label,
      description: primaryPendingEntry.value.meta.description,
      color: primaryPendingEntry.value.meta.color,
      buttonLabel: primaryPendingEntry.value.meta.actionLabel,
      buttonTo: primaryPendingEntry.value.meta.actionTo,
      buttonVariant: 'outline' as const,
    }
  }

  return {
    title: '可继续浏览比赛',
    description: '当前队伍和公开比赛入口都已就绪，可继续查看比赛详情、公告和榜单。',
    color: 'success' as const,
    buttonLabel: '浏览比赛',
    buttonTo: '/games',
    buttonVariant: 'outline' as const,
  }
})

function getParticipationPriority(game: GameSummary, participation: GameParticipation | undefined) {
  const phase = getGamePhase(game)

  if (!team.value) {
    return 5
  }

  if (participation?.missing_writeup) {
    return 10
  }

  if (participation?.status === 'pending') {
    return 8
  }

  if (participation?.status === 'rejected') {
    return 7
  }

  if (participation?.writeup_required && participation?.writeup_submitted && participation?.writeup_status === 'submitted') {
    return 6
  }

  if (participation?.participated) {
    return phase === 'active' || (phase === 'ended' && game.practice_mode) ? 9 : 3
  }

  if (phase === 'ended') {
    return 1
  }

  return 4
}

function getParticipationMeta(game: GameSummary) {
  const participation = participationMap.value[game.id]
  const gamePath = `/games/${game.id}`
  const meta = resolveParticipationMeta({
    gameId: game.id,
    gamePhase: getGamePhase(game),
    practiceMode: game.practice_mode,
    isLoggedIn: !!authState.user,
    participation,
    registrationMode: game.registration_mode,
    loginTo: buildAuthEntryPath('/login', gamePath),
    registerTo: buildAuthEntryPath('/register', gamePath),
    teamTo: buildRedirectedPath('/console/team', gamePath),
  })

  return {
    ...meta,
    priority: getParticipationPriority(game, participation),
  }
}

const myGameEntries = computed(() =>
  games.value
    .filter(game => {
      const participation = participationMap.value[game.id]
      return Boolean(team.value) && Boolean(participation?.participated || (isPubliclyVisibleGame(game) && getGamePhase(game) !== 'ended'))
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

function getStatusMeta(input: GameSummary | GameSummary['status']) {
  if (typeof input === 'string') {
    const meta = {
      draft: { label: '草稿', color: 'warning' as const },
      active: { label: '已发布', color: 'info' as const },
      ended: { label: '已结束', color: 'neutral' as const },
    }
    return meta[input] || meta.draft
  }

  const phase = getGamePhase(input)
  const meta = {
    draft: { label: '草稿', color: 'warning' as const },
    before_start: { label: '未开始', color: 'info' as const },
    active: { label: '进行中', color: 'success' as const },
    ended: { label: '已结束', color: 'neutral' as const },
  }

  return meta[phase]
}

const adminManagedGames = computed(() =>
  [...games.value]
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    .slice(0, 5),
)

let nowTimer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  await ensureInitialized()
  await fetchConsoleData()
  nowTimer = window.setInterval(() => {
    now.value = Date.now()
  }, 30000)
})

onBeforeUnmount(() => {
  if (nowTimer) {
    clearInterval(nowTimer)
    nowTimer = null
  }
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
          {{ authState.user?.username || '选手' }} 的当前工作台
        </p>
      </div>
    </div>

    <template v-if="loading">
      <div class="flex justify-center py-16">
        <UIcon name="i-lucide-loader-2" class="animate-spin size-8 text-muted" />
      </div>
    </template>

    <template v-else>
      <div
        v-if="showPasswordSecurityNotice"
        class="mb-6 rounded-lg border border-default bg-elevated/50 px-4 py-3"
      >
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="min-w-0">
            <div class="flex items-center gap-2 font-medium text-highlighted">
              <UIcon name="i-lucide-key-round" class="size-4" />
              <span>请尽快更新管理员密码</span>
            </div>
            <p class="mt-2 text-sm text-muted leading-6">
              当前管理员账号仍在使用高风险口令。请先前往账号安全页修改密码，再继续长期使用管理端。
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton
              label="前往修改密码"
              color="warning"
              variant="outline"
              size="sm"
              to="/console/account"
            />
          </div>
        </div>
      </div>

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
          <UPageCard v-if="isAdmin" title="管理入口" icon="i-lucide-shield-check">
            <div class="space-y-3">
              <div class="flex flex-wrap gap-2">
                <UButton label="进入管理端" icon="i-lucide-settings-2" to="/console/admin" variant="outline" />
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
                      <UBadge :color="getStatusMeta(game).color" variant="soft">
                        {{ getStatusMeta(game).label }}
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
                      v-if="getGamePhase(game) === 'draft'"
                      size="sm"
                      icon="i-lucide-play"
                      :loading="adminActionGameId === game.id"
                      @click="updateGameStatusQuick(game, 'active')"
                    >
                      立即开赛
                    </UButton>
                    <UButton
                      v-else-if="getGamePhase(game) === 'active' || getGamePhase(game) === 'before_start'"
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
                title="当前没有可管理的比赛"
                description="创建比赛后，这里会汇总最近使用的管理入口。"
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

          <UPageCard title="当前工作台" icon="i-lucide-list-checks">
            <div class="space-y-3">
              <div class="rounded-lg border border-default px-3 py-3 text-sm">
                <div
                  v-for="row in consoleSummaryRows"
                  :key="row.label"
                  class="flex items-center justify-between gap-3 py-2"
                >
                  <span class="text-muted">{{ row.label }}</span>
                  <span class="text-right">{{ row.value }}</span>
                </div>
              </div>

              <div class="rounded-lg border border-default bg-elevated/50 px-3 py-3">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-medium text-highlighted">
                      {{ consoleNextActionMeta.title }}
                    </div>
                    <p class="mt-1 text-sm text-muted leading-6">
                      {{ consoleNextActionMeta.description }}
                    </p>
                  </div>
                  <UBadge :color="consoleNextActionMeta.color" variant="soft" size="sm">
                    当前重点
                  </UBadge>
                </div>

                <div class="mt-3 flex flex-wrap gap-2">
                  <UButton
                    v-for="action in consoleActionButtons"
                    :key="`${action.label}-${action.to}`"
                    size="sm"
                    :label="action.label"
                    :icon="action.icon"
                    :to="action.to"
                    :variant="action.variant || 'outline'"
                  />
                </div>
              </div>
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
                  <UBadge :color="getStatusMeta(game).color" variant="soft">
                    {{ getStatusMeta(game).label }}
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
              title="当前没有可浏览的公开比赛"
              :description="isAdmin ? '比赛公开后，这里会显示当前可浏览的公开比赛。' : '当前还没有公开中的比赛，稍后再来查看即可。'"
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
                    <span>{{ getStatusMeta(entry.game).label }}</span>
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
              title="当前没有关联比赛"
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
              title="当前没有可跟进的比赛公告"
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

        </div>

        <div class="space-y-6">
          <UPageCard v-if="isAdmin" title="管理待办" icon="i-lucide-list-todo">
            <div v-if="loadingAdminTodo" class="flex justify-center py-8">
              <UIcon name="i-lucide-loader-2" class="animate-spin size-6 text-muted" />
            </div>
            <div v-else class="space-y-4">
              <div class="rounded-lg border border-default px-3 py-3 text-sm text-muted">
                <div class="flex items-center justify-between gap-3 flex-wrap">
                  <div class="font-medium text-highlighted">
                    当前优先处理
                  </div>
                  <UButton size="sm" variant="ghost" icon="i-lucide-settings-2" :to="adminParticipantSectionLink">
                    进入管理端
                  </UButton>
                </div>
                <div
                  v-for="row in adminPrioritySummaryRows"
                  :key="row.label"
                  class="flex items-center justify-between gap-3 py-2"
                >
                  <ULink :to="row.to" class="font-medium text-highlighted">
                    {{ row.label }}
                  </ULink>
                  <ULink :to="row.to" class="text-right text-muted">
                    {{ row.value }}
                  </ULink>
                </div>
              </div>

              <div class="grid gap-4 xl:grid-cols-2">
                <div class="rounded-lg border border-default px-3 py-3">
                  <div class="mb-3 flex items-center justify-between gap-2">
                    <div class="font-medium">
                      待审核报名
                    </div>
                    <UButton size="sm" variant="ghost" icon="i-lucide-settings-2" :to="adminParticipantSectionLink">
                      去管理
                    </UButton>
                  </div>
                  <div v-if="adminPendingParticipants.length" class="space-y-2">
                    <ULink
                      v-for="item in adminPendingParticipants"
                      :key="`${item.game.id}-${item.team_id}`"
                      :to="buildAdminGameSectionLink(item.game.id, '#participants')"
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
                    </ULink>
                  </div>
                  <UEmpty
                    v-else
                    icon="i-lucide-hourglass"
                    title="当前没有待审核报名"
                    description="最近 5 场比赛里没有仍待处理的报名申请。新的报名提交后会自动出现在这里。"
                    :actions="[{
                      label: '进入管理端',
                      icon: 'i-lucide-settings-2',
                      to: adminParticipantSectionLink,
                      color: 'neutral',
                      variant: 'outline',
                    }]"
                  />
                </div>

                <div class="rounded-lg border border-default px-3 py-3">
                  <div class="mb-3 flex items-center justify-between gap-2">
                    <div class="font-medium">
                      待审 Writeup
                    </div>
                    <UButton size="sm" variant="ghost" icon="i-lucide-file-text" :to="adminWriteupSectionLink">
                      去处理
                    </UButton>
                  </div>
                  <div v-if="adminPendingWriteups.length" class="space-y-2">
                    <ULink
                      v-for="item in adminPendingWriteups"
                      :key="`${item.game.id}-${item.team_id}`"
                      :to="buildAdminGameSectionLink(item.game.id, '#writeups')"
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
                    </ULink>
                  </div>
                  <UEmpty
                    v-else
                    icon="i-lucide-file-clock"
                    title="当前没有待审 Writeup"
                    description="最近 5 场比赛里没有等待管理员处理的 Writeup。新的提交完成后会自动出现在这里。"
                    :actions="[{
                      label: '进入管理端',
                      icon: 'i-lucide-file-text',
                      to: adminWriteupSectionLink,
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
                  <UButton size="sm" variant="ghost" icon="i-lucide-settings-2" :to="adminAnnouncementSectionLink">
                    打开管理端
                  </UButton>
                </div>

                <div class="mb-4 rounded-lg border border-default px-3 py-3 text-sm text-muted">
                  <div
                    v-for="row in adminSignalSummaryRows"
                    :key="row.label"
                    class="flex items-center justify-between gap-3 py-2"
                  >
                    <ULink :to="row.to" class="font-medium text-highlighted">
                      {{ row.label }}
                    </ULink>
                    <ULink :to="row.to" class="text-right text-muted">
                      {{ row.value }}
                    </ULink>
                  </div>
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
                      <ULink
                        v-for="item in adminLatestAnnouncements.slice(0, 3)"
                        :key="item.id"
                        :to="buildAdminGameSectionLink(item.game.id, '#announcements')"
                        class="rounded-md bg-elevated/60 px-3 py-2"
                      >
                        <div class="text-sm font-medium">
                          {{ item.game.name }}
                        </div>
                        <div class="mt-1 line-clamp-2 text-xs text-muted">
                          {{ item.content }}
                        </div>
                      </ULink>
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
                      <ULink
                        v-for="item in adminRecentSubmissions.slice(0, 3)"
                        :key="`${item.game_id}-${item.team_id}-${item.challenge_id}-${item.submitted_at}`"
                        :to="buildAdminGameSectionLink(item.game.id, '#submissions', item.challenge_id)"
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
                      </ULink>
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
                      <ULink
                        v-for="item in adminCheatClues.slice(0, 3)"
                        :key="`${item.game_id}-${item.challenge_id}-${item.submitted_flag}`"
                        :to="buildAdminGameSectionLink(item.game.id, '#clues', item.challenge_id)"
                        class="rounded-md bg-elevated/60 px-3 py-2"
                      >
                        <div class="text-sm font-medium">
                          {{ item.challenge_title }}
                        </div>
                        <div class="text-xs text-muted">
                          {{ item.game.name }} · {{ item.team_count }} 队重复
                        </div>
                      </ULink>
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

          <UPageCard :title="isAdmin ? '账号与导航' : '账号入口'" :icon="isAdmin ? 'i-lucide-shield-check' : 'i-lucide-navigation'">
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
