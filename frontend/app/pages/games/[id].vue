<script setup lang="ts">
import type { components } from '~/types/api'

type Game = components['schemas']['Game']
type GameChallengeDetail = components['schemas']['GameChallengeDetail']
type ScoreboardEntry = components['schemas']['ScoreboardEntry']
type GameParticipation = components['schemas']['GameParticipation']
type ScoreboardChallengeStat = components['schemas']['ScoreboardChallengeStat']
type GameWriteupView = components['schemas']['GameWriteup']

const route = useRoute()
const toast = useToast()
const { authState, ensureInitialized } = useAuth()
const { resolveParticipationHints, resolveParticipationMeta } = usePublicGameParticipationState()
const isAdmin = computed(() => ['admin', 'super_admin'].includes(authState.user?.role || ''))

const game = ref<Game | null>(null)
const challenges = ref<GameChallengeDetail[]>([])
const scoreboard = ref<ScoreboardEntry[]>([])
const scoreboardChallenges = ref<ScoreboardChallengeStat[]>([])
const scoreboardFrozen = ref(false)
const scoreboardFreezeTime = ref<string | null>(null)
const selectedDivision = ref('')
const availableDivisions = ref<string[]>([])
const participation = ref<GameParticipation | null>(null)
const writeup = ref<GameWriteupView | null>(null)
const loading = ref(true)
const participationLoading = ref(false)
const joining = ref(false)
const leaving = ref(false)
const activeTab = ref('challenges')
const submitting = ref<number | null>(null) // challenge id being submitted
const writeupSubmitting = ref(false)
const flagInputs = reactive<Record<number, string>>({})
const writeupForm = reactive({
  content: '',
})
const now = ref(Date.now())

const gameId = route.params.id as string

const hasChallengeContent = computed(() =>
  challenges.value.some(ch =>
    Boolean(ch.description)
    || parseStringList(ch.hints).length > 0
    || parseStringList(ch.attachments).length > 0,
  ),
)

async function fetchAll() {
  loading.value = true
  try {
    const gameRequest = $api('get', '/api/games/{id}', { params: { id: Number(gameId) } })
    const challengesRequest = $api('get', '/api/games/{id}/challenges', { params: { id: Number(gameId) } })
    const participationRequest = authState.user
      ? $api('get', '/api/games/{id}/participation', { params: { id: Number(gameId) } })
      : Promise.resolve(null)
    const writeupRequest = authState.user
      ? $api('get', '/api/games/{id}/writeup', { params: { id: Number(gameId) } })
      : Promise.resolve(null)

    const [gameRes, challengesRes, participationRes] = await Promise.all([
      gameRequest,
      challengesRequest,
      participationRequest,
    ])
    const writeupRes = await writeupRequest
    game.value = gameRes
    challenges.value = challengesRes
    participation.value = participationRes
    availableDivisions.value = gameRes.divisions || []
    if (selectedDivision.value && !availableDivisions.value.includes(selectedDivision.value)) {
      selectedDivision.value = ''
    }
    writeup.value = writeupRes
    writeupForm.content = writeupRes?.content || ''
  }
  catch (e: any) {
    toast.add({ title: '获取比赛信息失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    loading.value = false
  }
}

async function fetchParticipation() {
  if (!authState.user) {
    participation.value = null
    return
  }

  participationLoading.value = true
  try {
    participation.value = await $api('get', '/api/games/{id}/participation', {
      params: { id: Number(gameId) },
    })
  }
  catch (e: any) {
    participation.value = null
    toast.add({ title: '获取报名状态失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    participationLoading.value = false
  }
}

async function fetchWriteup() {
  if (!authState.user) {
    writeup.value = null
    writeupForm.content = ''
    return
  }

  try {
    writeup.value = await $api('get', '/api/games/{id}/writeup', {
      params: { id: Number(gameId) },
    })
    writeupForm.content = writeup.value?.content || ''
  }
  catch (e: any) {
    toast.add({ title: '获取 Writeup 失败', description: e.data?.message || e.message, color: 'error' })
  }
}

async function fetchScoreboard() {
  try {
    const res = await $api('get', '/api/games/{id}/scoreboard', {
      params: { id: Number(gameId) },
      query: selectedDivision.value ? { division: selectedDivision.value } : {},
    })
    scoreboard.value = res.entries || []
    scoreboardChallenges.value = res.challenges || []
    scoreboardFrozen.value = !!res.is_frozen
    scoreboardFreezeTime.value = res.freeze_time || null
    availableDivisions.value = res.divisions || availableDivisions.value
    if (selectedDivision.value && !availableDivisions.value.includes(selectedDivision.value)) {
      selectedDivision.value = ''
    }
  }
  catch (e: any) {
    toast.add({ title: '获取排行榜失败', description: e.data?.message || e.message, color: 'error' })
  }
}

async function submitFlag(challengeId: number) {
  const flag = flagInputs[challengeId]
  if (!flag) return

  const teamId = participation.value?.team?.id
  if (!teamId || !participation.value?.participated) {
    toast.add({ title: '请先加入队伍再提交', color: 'warning' })
    return
  }
  if (participation.value.status !== 'accepted') {
    toast.add({ title: '当前还不能提交', description: submitHint.value, color: 'warning' })
    return
  }

  submitting.value = challengeId
  try {
    const res = await $api('post', '/api/games/{id}/challenges/{challengeId}/submit', {
      params: { id: Number(gameId), challengeId: challengeId },
      body: { flag, team_id: teamId },
    })
    if (res.correct) {
      toast.add({ title: '🎉 Flag 正确！', description: `+${res.score} 分${res.blood_type ? ` (${res.blood_type === 'first' ? '一血' : res.blood_type === 'second' ? '二血' : '三血'})` : ''}`, color: 'success' })
      flagInputs[challengeId] = ''
      await fetchAll()
    }
    else {
      toast.add({ title: 'Flag 错误', description: res.message, color: 'error' })
    }
  }
  catch (e: any) {
    toast.add({ title: '提交失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    submitting.value = null
  }
}

async function joinGame() {
  const teamId = participation.value?.team?.id
  if (!teamId) {
    toast.add({ title: '请先创建或加入队伍', color: 'warning' })
    return
  }

  joining.value = true
  try {
    await $api('post', '/api/games/{id}/join', {
      params: { id: Number(gameId) },
      body: { team_id: teamId },
    })
    toast.add({
      title: game.value?.registration_mode === 'auto_accept' ? '报名成功' : '报名申请已提交',
      description: game.value?.registration_mode === 'auto_accept'
        ? '当前比赛已自动通过报名，队伍现在可以按比赛状态直接参赛。'
        : '等待管理员审核通过后即可正式参赛。',
      color: 'success',
    })
    await Promise.all([fetchParticipation(), fetchAll()])
  }
  catch (e: any) {
    toast.add({ title: '报名失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    joining.value = false
  }
}

async function leaveGame() {
  const teamId = participation.value?.team?.id
  if (!teamId) {
    return
  }

  leaving.value = true
  try {
    await $api('delete', '/api/games/{id}/leave', {
      params: { id: Number(gameId) },
      body: { team_id: teamId },
    })
    toast.add({ title: '已退出比赛', color: 'success' })
    await Promise.all([fetchParticipation(), fetchAll()])
  }
  catch (e: any) {
    toast.add({ title: '退出失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    leaving.value = false
  }
}

async function submitWriteup() {
  writeupSubmitting.value = true
  try {
    writeup.value = await $api('put', '/api/games/{id}/writeup', {
      params: { id: Number(gameId) },
      body: {
        content: writeupForm.content,
      },
    })
    toast.add({ title: 'Writeup 已提交', color: 'success' })
  }
  catch (e: any) {
    toast.add({ title: 'Writeup 提交失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    writeupSubmitting.value = false
  }
}

function getCategoryColor(cat: string): 'info' | 'error' | 'warning' | 'success' | 'neutral' {
  const map: Record<string, 'info' | 'error' | 'warning' | 'success' | 'neutral'> = {
    web: 'info', pwn: 'error', crypto: 'warning', reverse: 'success',
    misc: 'neutral', forensics: 'info', awd: 'error',
  }
  return map[cat] || 'neutral'
}

function getDifficultyColor(d: string): 'success' | 'warning' | 'error' | 'neutral' {
  const map: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
    easy: 'success', medium: 'warning', hard: 'error',
  }
  return map[d] || 'neutral'
}

function parseStringList(raw?: string) {
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter(item => typeof item === 'string' && item.trim().length > 0)
    }
  }
  catch {
    // Fall back to plain text when the field is not valid JSON yet.
  }

  return raw.split('\n').map(item => item.trim()).filter(Boolean)
}

const gameStatusMeta = computed(() => {
  if (!game.value) {
    return { label: '未知', color: 'neutral' as const, description: '' }
  }

  if (game.value.status === 'draft') {
    return {
      label: '草稿',
      color: 'neutral' as const,
      description: '当前比赛仍在准备中，暂未开放报名与正式提交。',
    }
  }

  if (game.value.status === 'ended') {
    return {
      label: '已结束',
      color: 'error' as const,
      description: `比赛已于 ${new Date(game.value.end_time).toLocaleString()} 结束`,
    }
  }

  const start = new Date(game.value.start_time).getTime()
  const end = new Date(game.value.end_time).getTime()

  if (now.value < start) {
    return {
      label: '未开始',
      color: 'warning' as const,
      description: `距离开始还有 ${formatDuration(start - now.value)}`,
    }
  }

  if (now.value > end) {
    return {
      label: '已结束',
      color: 'error' as const,
      description: `比赛已于 ${new Date(game.value.end_time).toLocaleString()} 结束`,
    }
  }

  return {
    label: '进行中',
    color: 'success' as const,
    description: `距离结束还有 ${formatDuration(end - now.value)}`,
  }
})

const canJoinGame = computed(() =>
  !!authState.user
  && !!participation.value?.has_team
  && participation.value?.status !== 'accepted'
  && gameStatusMeta.value.label !== '已结束',
)

const canLeaveGame = computed(() =>
  !!authState.user
  && !!participation.value?.status
  && participation.value?.status !== 'accepted',
)

const canSubmitFlag = computed(() =>
  !!authState.user
  && participation.value?.status === 'accepted'
  && gameStatusMeta.value.label === '进行中',
)

const publicGamePhase = computed<PublicGamePhase>(() => {
  if (gameStatusMeta.value.label === '草稿') {
    return 'draft'
  }
  if (gameStatusMeta.value.label === '未开始') {
    return 'before_start'
  }
  if (gameStatusMeta.value.label === '已结束') {
    return 'ended'
  }
  return 'active'
})

const publicParticipationHints = computed(() => resolveParticipationHints({
  gameId: Number(gameId),
  gamePhase: publicGamePhase.value,
  isLoggedIn: !!authState.user,
  participation: participation.value,
  registrationMode: game.value?.registration_mode,
  maxTeamMembers: game.value?.max_team_members,
}))

const participationMeta = computed(() => resolveParticipationMeta({
  gameId: Number(gameId),
  gamePhase: publicGamePhase.value,
  isLoggedIn: !!authState.user,
  participation: participation.value,
  registrationMode: game.value?.registration_mode,
  maxTeamMembers: game.value?.max_team_members,
}))

const participationHint = computed(() => {
  if (participation.value?.participated && canLeaveGame.value) {
    return {
      title: '当前报名可撤回',
      description: '待审核或已拒绝的报名可以直接撤回，调整队伍后再重新提交。',
      color: 'success' as const,
    }
  }

  return {
    title: publicParticipationHints.value.title,
    description: publicParticipationHints.value.description,
    color: publicParticipationHints.value.color,
  }
})

const submitHint = computed(() => publicParticipationHints.value.submitHint)

const challengeVisibilityHint = computed(() => publicParticipationHints.value.visibilityHint)

const detailPrimaryAction = computed(() => {
  if (!authState.user) {
    return {
      mode: 'link' as const,
      label: participationMeta.value.actionLabel,
      to: '/login',
      icon: 'i-lucide-log-in',
      color: 'primary' as const,
      variant: 'solid' as const,
    }
  }

  if (participation.value?.has_team && !participation.value?.participated) {
    return {
      mode: 'button' as const,
      label: '报名比赛',
      icon: 'i-lucide-badge-plus',
      color: 'primary' as const,
      variant: 'solid' as const,
      loading: joining.value,
      disabled: !canJoinGame.value,
      onClick: joinGame,
    }
  }

  if (participation.value?.participated) {
    return {
      mode: 'button' as const,
      label: canLeaveGame.value ? '退出比赛' : participationMeta.value.actionLabel,
      icon: canLeaveGame.value ? 'i-lucide-log-out' : 'i-lucide-arrow-right',
      color: canLeaveGame.value ? 'error' as const : 'primary' as const,
      variant: canLeaveGame.value ? 'outline' as const : 'solid' as const,
      loading: canLeaveGame.value ? leaving.value : false,
      disabled: canLeaveGame.value ? !canLeaveGame.value : false,
      onClick: canLeaveGame.value ? leaveGame : undefined,
      to: canLeaveGame.value ? undefined : participationMeta.value.actionTo,
    }
  }

  return {
    mode: 'link' as const,
    label: participationMeta.value.actionLabel,
    to: participationMeta.value.actionTo,
    icon: 'i-lucide-arrow-right',
    color: 'primary' as const,
    variant: 'solid' as const,
  }
})

const detailSecondaryAction = computed(() => {
  if (!authState.user) {
    return {
      label: '创建账号',
      to: '/register',
      icon: 'i-lucide-user-plus',
    }
  }

  if (!participation.value?.has_team) {
    return {
      label: '去加入队伍',
      to: '/console/team',
      icon: 'i-lucide-users',
    }
  }

  if (participation.value?.participated && !canLeaveGame.value) {
    return {
      label: '查看队伍',
      to: '/console/team',
      icon: 'i-lucide-users',
    }
  }

  return null
})

const overviewStats = computed(() => {
  if (!game.value) {
    return []
  }

  return [
    {
      label: '比赛状态',
      value: gameStatusMeta.value.label,
      hint: gameStatusMeta.value.description,
      icon: 'i-lucide-activity',
      color: gameStatusMeta.value.color,
    },
    {
      label: '开始时间',
      value: new Date(game.value.start_time).toLocaleString(),
      hint: '开赛时间',
      icon: 'i-lucide-clock-3',
      color: 'neutral' as const,
    },
    {
      label: '结束时间',
      value: new Date(game.value.end_time).toLocaleString(),
      hint: '封榜或比赛结束前请及时提交',
      icon: 'i-lucide-flag',
      color: 'neutral' as const,
    },
    {
      label: '题目数量',
      value: String(challenges.value.length),
      hint: '当前可见题目数',
      icon: 'i-lucide-file-stack',
      color: 'info' as const,
    },
    {
      label: '比赛分组',
      value: availableDivisions.value.length ? String(availableDivisions.value.length) : '未启用',
      hint: availableDivisions.value.length ? availableDivisions.value.join(' / ') : '当前比赛不区分分组榜',
      icon: 'i-lucide-layers-3',
      color: availableDivisions.value.length ? 'warning' as const : 'neutral' as const,
    },
    {
      label: '赛后练习',
      value: game.value.practice_mode ? '开启' : '关闭',
      hint: game.value.practice_mode ? '比赛结束后仍可继续练习' : '比赛结束后不再开放练习模式',
      icon: 'i-lucide-orbit',
      color: game.value.practice_mode ? 'success' as const : 'neutral' as const,
    },
  ]
})

const challengeGroups = computed(() => {
  const groups = new Map<string, GameChallengeDetail[]>()

  for (const challenge of challenges.value) {
    const category = challenge.category || 'misc'
    if (!groups.has(category)) {
      groups.set(category, [])
    }
    groups.get(category)?.push(challenge)
  }

  return Array.from(groups.entries()).map(([category, items]) => ({
    category,
    items,
  }))
})

const scoreboardChallengeGroups = computed(() => {
  const groups = new Map<string, ScoreboardChallengeStat[]>()

  for (const challenge of scoreboardChallenges.value) {
    const category = challenge.category || 'misc'
    if (!groups.has(category)) {
      groups.set(category, [])
    }
    groups.get(category)?.push(challenge)
  }

  return Array.from(groups.entries()).map(([category, items]) => ({
    category,
    items,
  }))
})

const divisionOptions = computed(() => [
  { label: '全部分组', value: '' },
  ...availableDivisions.value.map(division => ({
    label: division,
    value: division,
  })),
])

function formatDuration(ms: number) {
  if (ms <= 0) {
    return '0 分钟'
  }

  const totalMinutes = Math.floor(ms / 1000 / 60)
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60

  const parts = []
  if (days) parts.push(`${days} 天`)
  if (hours) parts.push(`${hours} 小时`)
  if (minutes || parts.length === 0) parts.push(`${minutes} 分钟`)
  return parts.join(' ')
}

function getBloodRows(challenge: ScoreboardChallengeStat) {
  return [
    { label: '一血', team: challenge.blood_team },
    { label: '二血', team: challenge.second_blood_team },
    { label: '三血', team: challenge.third_blood_team },
  ]
}

const tabItems = [
  { label: '概览', value: 'overview', icon: 'i-lucide-layout-template' },
  { label: '题目', value: 'challenges', icon: 'i-lucide-flag' },
  { label: '排行榜', value: 'scoreboard', icon: 'i-lucide-trophy' },
  { label: 'Writeup', value: 'writeup', icon: 'i-lucide-file-text' },
]

watch(activeTab, (v) => {
  if (v === 'scoreboard') fetchScoreboard()
})

watch(selectedDivision, () => {
  if (activeTab.value === 'scoreboard') {
    fetchScoreboard()
  }
})

onMounted(async () => {
  await ensureInitialized()
  const timer = window.setInterval(() => {
    now.value = Date.now()
  }, 60_000)
  await fetchAll()

  onBeforeUnmount(() => {
    window.clearInterval(timer)
  })
})
</script>

<template>
  <UContainer class="py-8">
    <div v-if="loading" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader" class="size-8 animate-spin text-muted" />
    </div>

    <template v-else-if="game">
      <div class="mb-6">
        <UButton to="/games" variant="ghost" icon="i-lucide-arrow-left" label="返回比赛列表" size="sm" class="mb-4" />
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div class="flex items-center gap-3 mb-2 flex-wrap">
              <h1 class="text-3xl font-bold">
                {{ game.name }}
              </h1>
              <UBadge :color="gameStatusMeta.color" variant="soft" size="lg">
                {{ gameStatusMeta.label }}
              </UBadge>
            </div>
            <p class="text-muted max-w-3xl">
              {{ game.description }}
            </p>
          </div>
          <div class="text-sm text-muted text-right space-y-1">
            <div class="flex items-center gap-1 justify-end">
              <UIcon name="i-lucide-clock" class="size-4" />
              <span>{{ new Date(game.start_time).toLocaleString() }}</span>
            </div>
            <div class="flex items-center gap-1 justify-end">
              <UIcon name="i-lucide-flag" class="size-4" />
              <span>{{ new Date(game.end_time).toLocaleString() }}</span>
            </div>
          </div>
        </div>
      </div>

      <UPageGrid :cols="{ default: 1, sm: 2, xl: 4 }" class="mb-6">
        <UPageCard
          v-for="stat in overviewStats"
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

      <UPageCard class="mb-6">
        <div class="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p class="text-sm text-muted mb-1">
              {{ authState.user ? '我的报名状态' : '公开浏览提示' }}
            </p>
            <div v-if="authState.user && participationLoading" class="flex items-center gap-2 text-sm text-muted">
              <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
              <span>加载中...</span>
            </div>
            <div v-else class="flex items-center gap-2 flex-wrap">
              <UBadge
                :color="authState.user ? (participation?.participated ? 'success' : participation?.has_team ? 'warning' : 'neutral') : 'info'"
                variant="soft"
              >
                {{ authState.user ? (participation?.participated ? '已报名' : participation?.has_team ? '未报名' : '未加入队伍') : '访客可浏览' }}
              </UBadge>
              <span v-if="participation?.team" class="text-sm text-muted">
                当前队伍：{{ participation.team.name }}
              </span>
            </div>
            <p class="mt-2 text-sm text-muted max-w-2xl">
              {{ participationHint.description }}
            </p>
          </div>

          <div class="flex gap-2">
            <UButton
              v-if="detailPrimaryAction.mode === 'link'"
              :to="detailPrimaryAction.to"
              :icon="detailPrimaryAction.icon"
              :color="detailPrimaryAction.color"
              :variant="detailPrimaryAction.variant"
            >
              {{ detailPrimaryAction.label }}
            </UButton>
            <UButton
              v-else
              :icon="detailPrimaryAction.icon"
              :color="detailPrimaryAction.color"
              :variant="detailPrimaryAction.variant"
              :loading="detailPrimaryAction.loading"
              :disabled="detailPrimaryAction.disabled"
              :to="detailPrimaryAction.to"
              @click="detailPrimaryAction.onClick?.()"
            >
              {{ detailPrimaryAction.label }}
            </UButton>
            <UButton
              v-if="detailSecondaryAction"
              :to="detailSecondaryAction.to"
              variant="outline"
              :icon="detailSecondaryAction.icon"
            >
              {{ detailSecondaryAction.label }}
            </UButton>
          </div>
        </div>
      </UPageCard>

      <UTabs v-model="activeTab" :items="tabItems" class="mb-6" />

      <div v-if="activeTab === 'overview'" class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <UPageCard title="比赛规则" icon="i-lucide-scroll-text">
            <div class="space-y-4 text-sm leading-7">
              <p class="text-default">
                {{ game.description || '当前比赛暂未填写详细规则。你可以先完成队伍准备与比赛报名。' }}
              </p>
            <UAlert
              v-if="game.notice"
              color="info"
              variant="soft"
              title="比赛公告"
              :description="game.notice"
            />
            <div class="rounded-lg border border-default bg-muted/40 p-4">
              <p class="font-medium mb-2">
                参赛提示
              </p>
              <ul class="space-y-2 text-muted">
                <li>1. 先在控制台创建或加入队伍，再报名比赛。</li>
                <li>2. 当前比赛报名方式：{{ game.registration_mode === 'auto_accept' ? '自动通过' : '人工审核' }}。</li>
                <li>3. {{ game.max_team_members ? `当前队伍人数上限为 ${game.max_team_members} 人，超出将无法报名。` : '当前比赛不限制队伍人数。' }}</li>
                <li>4. 只有处于可用状态的比赛才会开放报名与正式提交。</li>
                <li>5. {{ game.scoreboard_freeze_at ? `公开榜单将于 ${new Date(game.scoreboard_freeze_at).toLocaleString()} 封榜。` : '当前比赛不启用封榜。' }}</li>
                <li>6. {{ game.practice_mode ? '比赛结束后会继续保留练习模式，便于复盘和补题。' : '当前比赛为纯正赛模式，结束后不会继续开放练习。' }}</li>
                <li>7. {{ game.writeup_required ? (game.writeup_deadline ? `当前比赛要求提交 Writeup，截止时间为 ${new Date(game.writeup_deadline).toLocaleString()}。` : '当前比赛要求提交 Writeup，具体截止时间请留意公告。') : '当前比赛不强制要求提交 Writeup。' }}</li>
                <li>8. 题目页会根据你当前队伍显示已解状态，以及一血 / 二血 / 三血队伍。</li>
                <li>9. 待审核或已拒绝的报名可以撤回；已通过报名后队伍将锁定，不能再撤回。</li>
                <li>10. 比赛结束后将无法继续得分。</li>
              </ul>
            </div>
          </div>
        </UPageCard>

        <div class="space-y-6">
          <UPageCard title="快速入口" icon="i-lucide-rocket">
            <div class="flex flex-col gap-3">
              <UButton icon="i-lucide-flag" variant="outline" @click="activeTab = 'challenges'">
                浏览题目
              </UButton>
              <UButton icon="i-lucide-trophy" variant="outline" @click="activeTab = 'scoreboard'">
                查看排行榜
              </UButton>
              <UButton icon="i-lucide-users" variant="outline" to="/console/team">
                管理我的队伍
              </UButton>
            </div>
          </UPageCard>

          <UPageCard v-if="isAdmin" title="管理快捷入口" icon="i-lucide-shield-check">
            <div class="space-y-3 text-sm">
              <p class="text-muted">
                你当前拥有赛事管理权限，可以继续前往管理端更新比赛信息、题目配置和挂题关系。
              </p>
              <div class="flex flex-col gap-3">
                <UButton icon="i-lucide-settings-2" to="/console/admin" block>
                  打开赛事管理
                </UButton>
                <UButton icon="i-lucide-layout-dashboard" to="/console" variant="outline" block>
                  返回控制台
                </UButton>
              </div>
            </div>
          </UPageCard>

          <UPageCard title="当前报名情况" icon="i-lucide-badge-check">
            <div class="space-y-3 text-sm">
              <div class="flex items-center justify-between gap-3">
                <span class="text-muted">队伍状态</span>
                <span>{{ participation?.team?.name || '未加入队伍' }}</span>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-muted">比赛报名</span>
                <UBadge
                  :color="participation?.participated ? 'success' : 'warning'"
                  variant="soft"
                >
                  {{ participation?.participated ? '已报名' : '未报名' }}
                </UBadge>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-muted">报名方式</span>
                <span>{{ game.registration_mode === 'auto_accept' ? '自动通过' : '人工审核' }}</span>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-muted">比赛分组</span>
                <span>{{ availableDivisions.length ? availableDivisions.join(' / ') : '未启用' }}</span>
              </div>
              <div v-if="participation?.division" class="flex items-center justify-between gap-3">
                <span class="text-muted">我的分组</span>
                <span>{{ participation.division }}</span>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-muted">队伍人数限制</span>
                <span>{{ game.max_team_members ? `${game.max_team_members} 人` : '不限' }}</span>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-muted">赛后练习</span>
                <span>{{ game.practice_mode ? '开启' : '关闭' }}</span>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-muted">Writeup 要求</span>
                <span>{{ game.writeup_required ? '需要' : '不需要' }}</span>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-muted">Writeup 截止</span>
                <span>{{ game.writeup_deadline ? new Date(game.writeup_deadline).toLocaleString() : '未设置' }}</span>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-muted">可提交 Flag</span>
                <span>{{ canSubmitFlag ? '是' : '否' }}</span>
              </div>
              <p class="text-muted leading-6">
                {{ participationHint.title }}。{{ submitHint }}
              </p>
            </div>
          </UPageCard>
        </div>
      </div>

      <!-- Challenges Tab -->
      <div v-else-if="activeTab === 'challenges'">
        <UAlert
          class="mb-6"
          :color="hasChallengeContent ? 'success' : 'warning'"
          variant="soft"
          :title="hasChallengeContent ? '题目内容已开放' : '题目内容暂未完全开放'"
          :description="challengeVisibilityHint"
        />

        <div v-if="challenges.length === 0" class="text-center py-12">
          <UIcon name="i-lucide-file-question" class="size-10 text-muted mx-auto mb-2" />
          <p class="text-muted">
            暂无题目
          </p>
        </div>

        <div v-else class="space-y-6">
          <UPageCard
            v-for="group in challengeGroups"
            :key="group.category"
            :title="group.category.toUpperCase()"
            :description="`${group.items.length} 道题目`"
            :icon="group.items.some(item => item.solved) ? 'i-lucide-folder-open-dot' : 'i-lucide-folder-open'"
          >
            <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <UPageCard
                v-for="ch in group.items"
                :key="ch.id"
                :class="ch.solved ? 'ring-1 ring-success' : ''"
              >
                <template #header>
                  <div class="flex items-center justify-between gap-2 flex-wrap">
                    <span class="font-semibold">{{ ch.title }}</span>
                    <div class="flex gap-1">
                      <UBadge :color="getCategoryColor(ch.category)" size="sm">
                        {{ ch.category }}
                      </UBadge>
                      <UBadge v-if="ch.solved" color="success" size="sm" icon="i-lucide-check">
                        已解决
                      </UBadge>
                    </div>
                  </div>
                </template>

                <div class="flex items-center justify-between text-sm text-muted mb-3">
                  <div class="flex items-center gap-2">
                    <UBadge :color="getDifficultyColor(ch.difficulty ?? '')" variant="soft" size="sm">
                      {{ ch.difficulty || 'medium' }}
                    </UBadge>
                    <span>{{ ch.score }} pts</span>
                  </div>
                  <span class="flex items-center gap-1">
                    <UIcon name="i-lucide-users" class="size-3" />
                    {{ ch.solve_count }}
                  </span>
                </div>

                <div class="space-y-3 mb-4 text-sm">
                  <p class="text-muted leading-6 whitespace-pre-wrap">
                    {{ ch.description || '当前题面内容暂未开放，待报名通过并开赛后会自动显示。' }}
                  </p>

                  <div v-if="parseStringList(ch.hints).length" class="rounded-lg border border-default bg-muted/40 px-3 py-3">
                    <div class="mb-2 flex items-center gap-2 text-sm font-medium">
                      <UIcon name="i-lucide-lightbulb" class="size-4 text-warning" />
                      <span>提示</span>
                    </div>
                    <ul class="space-y-2 text-muted">
                      <li
                        v-for="(hint, hintIndex) in parseStringList(ch.hints)"
                        :key="`${ch.id}-hint-${hintIndex}`"
                      >
                        {{ hintIndex + 1 }}. {{ hint }}
                      </li>
                    </ul>
                  </div>

                  <div v-if="parseStringList(ch.attachments).length" class="rounded-lg border border-default bg-muted/40 px-3 py-3">
                    <div class="mb-2 flex items-center gap-2 text-sm font-medium">
                      <UIcon name="i-lucide-paperclip" class="size-4 text-info" />
                      <span>附件</span>
                    </div>
                    <div class="flex flex-col gap-2">
                      <UButton
                        v-for="(attachment, attachmentIndex) in parseStringList(ch.attachments)"
                        :key="`${ch.id}-attachment-${attachmentIndex}`"
                        :to="attachment"
                        target="_blank"
                        variant="outline"
                        size="sm"
                        icon="i-lucide-download"
                        class="justify-start"
                      >
                        附件 {{ attachmentIndex + 1 }}
                      </UButton>
                    </div>
                  </div>

                  <UAlert
                    v-else-if="!ch.description"
                    color="warning"
                    variant="subtle"
                    title="题面暂未开放"
                    description="当前只能查看题目基础信息。提示与附件会在具备参赛资格后自动显示。"
                  />
                </div>

                <div v-if="!ch.solved" class="space-y-2">
                  <p v-if="!canSubmitFlag" class="text-xs text-muted leading-5">
                    {{ submitHint }}
                  </p>
                  <div class="flex gap-2">
                    <UInput
                      v-model="flagInputs[ch.id]"
                      placeholder="flag{...}"
                      size="sm"
                      class="flex-1"
                      :disabled="!canSubmitFlag"
                      @keyup.enter="submitFlag(ch.id)"
                    />
                    <UButton
                      size="sm"
                      :loading="submitting === ch.id"
                      icon="i-lucide-send"
                      :disabled="!canSubmitFlag"
                      @click="submitFlag(ch.id)"
                    />
                  </div>
                </div>
              </UPageCard>
            </div>
          </UPageCard>
        </div>
      </div>

      <!-- Scoreboard Tab -->
      <div v-else-if="activeTab === 'scoreboard'">
        <div class="space-y-6">
          <UPageCard title="队伍总榜" icon="i-lucide-trophy">
            <div class="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <UFormField label="查看分组" name="division" class="max-w-sm">
                <USelect
                  v-model="selectedDivision"
                  :items="divisionOptions"
                  class="w-full"
                />
              </UFormField>
              <p class="text-sm text-muted">
                {{ selectedDivision ? `当前仅显示 ${selectedDivision} 的公开榜单。` : '当前显示全部公开队伍。' }}
              </p>
            </div>
            <UAlert
              v-if="scoreboardFrozen && scoreboardFreezeTime"
              class="mb-4"
              color="warning"
              variant="soft"
              title="排行榜已封榜"
              :description="`公开榜单当前冻结在 ${new Date(scoreboardFreezeTime).toLocaleString()}，后续解题不会继续显示在公开排名中。`"
            />
            <UTable
              :data="scoreboard"
              :columns="[
                { accessorKey: 'rank', header: '#' },
                { accessorKey: 'team_name', header: '队伍' },
                { accessorKey: 'score', header: '分数' },
                { accessorKey: 'solve_count', header: '解题数' },
                { accessorKey: 'last_solve', header: '最后解题' },
              ]"
              :empty-state="{ icon: 'i-lucide-trophy', label: '暂无数据' }"
            >
              <template #rank-cell="{ row }">
                <span :class="row.original.rank <= 3 ? 'font-bold text-warning' : ''">
                  {{ row.original.rank }}
                </span>
              </template>
              <template #last_solve-cell="{ row }">
                {{ row.original.last_solve ? new Date(row.original.last_solve).toLocaleString() : '-' }}
              </template>
            </UTable>
          </UPageCard>

          <UPageCard title="分题统计" icon="i-lucide-chart-column-big">
            <div v-if="scoreboardChallenges.length === 0" class="text-sm text-muted">
              暂无题目统计
            </div>
            <div v-else class="space-y-6">
              <UPageCard
                v-for="group in scoreboardChallengeGroups"
                :key="group.category"
                :title="group.category.toUpperCase()"
                :description="`${group.items.length} 道题`"
                icon="i-lucide-folders"
              >
                <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <UPageCard
                    v-for="challenge in group.items"
                    :key="challenge.id"
                    :title="challenge.title"
                    :description="challenge.category"
                    :icon="challenge.blood_team ? 'i-lucide-droplets' : 'i-lucide-flag'"
                  >
                    <div class="space-y-3 text-sm">
                      <div class="flex items-center justify-between gap-3">
                        <span class="text-muted">当前分值</span>
                        <span>{{ challenge.score }} pts</span>
                      </div>
                      <div class="flex items-center justify-between gap-3">
                        <span class="text-muted">解出队伍</span>
                        <span>{{ challenge.solved_count }}</span>
                      </div>
                        <div
                          v-for="blood in getBloodRows(challenge)"
                          :key="blood.label"
                          class="flex items-center justify-between gap-3"
                        >
                          <span class="text-muted">{{ blood.label }}队伍</span>
                          <span>{{ blood.team || '暂无' }}</span>
                        </div>
                      </div>
                    </UPageCard>
                  </div>
              </UPageCard>
            </div>
          </UPageCard>
        </div>
      </div>

      <div v-else-if="activeTab === 'writeup'">
        <UPageCard title="赛后 Writeup" icon="i-lucide-file-text">
          <div class="space-y-4">
            <UAlert
              :color="game.writeup_required ? 'info' : 'neutral'"
              variant="soft"
              :title="game.writeup_required ? '当前比赛要求 Writeup' : '当前比赛不强制要求 Writeup'"
              :description="game.writeup_required
                ? (game.writeup_deadline ? `截止时间：${new Date(game.writeup_deadline).toLocaleString()}` : '当前未设置单独截止时间。')
                : '你仍然可以在这里沉淀复盘内容，但不会作为强制参赛要求。'"
            />

            <div v-if="writeup?.status" class="grid gap-3 md:grid-cols-3 text-sm">
              <div class="rounded-lg border border-default px-3 py-3">
                <div class="text-muted">当前状态</div>
                <div class="mt-1 font-medium">{{ writeup.status }}</div>
              </div>
              <div class="rounded-lg border border-default px-3 py-3">
                <div class="text-muted">提交时间</div>
                <div class="mt-1 font-medium">{{ writeup.submitted_at ? new Date(writeup.submitted_at).toLocaleString() : '未提交' }}</div>
              </div>
              <div class="rounded-lg border border-default px-3 py-3">
                <div class="text-muted">审核备注</div>
                <div class="mt-1 font-medium">{{ writeup.review_remark || '暂无' }}</div>
              </div>
            </div>

            <UForm :state="writeupForm" class="space-y-4" @submit="submitWriteup">
              <UFormField
                label="Writeup 内容"
                name="content"
                :description="writeup?.can_submit ? '支持重复提交，重新提交后会回到 submitted 状态。' : '当前还不满足提交条件，通常需要已通过报名且比赛配置要求 Writeup。'"
              >
                <UTextarea v-model="writeupForm.content" class="w-full" :rows="12" placeholder="记录解题思路、复盘总结、关键截图或附件说明。" />
              </UFormField>

              <div class="flex justify-end">
                <UButton
                  type="submit"
                  icon="i-lucide-file-up"
                  :loading="writeupSubmitting"
                  :disabled="!writeup?.can_submit"
                >
                  提交 Writeup
                </UButton>
              </div>
            </UForm>
          </div>
        </UPageCard>
      </div>
    </template>

    <div v-else class="text-center py-16">
      <p class="text-muted">
        比赛不存在
      </p>
    </div>
  </UContainer>
</template>
