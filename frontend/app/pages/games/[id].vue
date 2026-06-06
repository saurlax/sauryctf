<script setup lang="ts">
import type { components } from '~/types/api'

type Game = components['schemas']['Game']
type GameChallengeDetail = components['schemas']['GameChallengeDetail']
type ScoreboardEntry = components['schemas']['ScoreboardEntry']
type GameParticipation = components['schemas']['GameParticipation']
type ScoreboardChallengeStat = components['schemas']['ScoreboardChallengeStat']
type GameWriteupView = components['schemas']['GameWriteup']
type ChallengeInstanceState = components['schemas']['ChallengeInstance']

const route = useRoute()
const toast = useToast()
const { authState, ensureInitialized } = useAuth()
const { resolveParticipationHints, resolveParticipationMeta, resolveParticipationStateKey } = usePublicGameParticipationState()
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
const instanceStates = reactive<Record<number, ChallengeInstanceState | null>>({})
const announcements = ref<Array<{
  id: number
  game_id: number
  content: string
  created_by: number
  created_at: string
}>>([])
const loading = ref(true)
const pageLoadError = ref('')
const participationLoading = ref(false)
const joining = ref(false)
const leaving = ref(false)
const activeTab = ref('challenges')
const submitting = ref<number | null>(null) // challenge id being submitted
const writeupSubmitting = ref(false)
const instanceLoading = reactive<Record<number, boolean>>({})
const instanceStarting = reactive<Record<number, boolean>>({})
const instanceDestroying = reactive<Record<number, boolean>>({})
const instanceAutoRefreshing = ref(false)
const flagInputs = reactive<Record<number, string>>({})
const writeupForm = reactive({
  content: '',
})
const registrationForm = reactive({
  invitation_code: '',
})
const now = ref(Date.now())
const confirmModalOpen = ref(false)
const confirmActionLoading = ref(false)
const confirmAction = reactive<{
  title: string
  description: string
  confirmLabel: string
  color: 'error' | 'warning' | 'primary' | 'neutral'
  run: null | (() => Promise<void>)
}>({
  title: '',
  description: '',
  confirmLabel: '确认',
  color: 'error',
  run: null,
})

const gameId = route.params.id as string
const currentGameRedirect = computed(() => {
  const target = route.fullPath || `/games/${gameId}`
  return encodeURIComponent(target)
})
const loginEntry = computed(() => `/login?redirect=${currentGameRedirect.value}`)
const registerEntry = computed(() => `/register?redirect=${currentGameRedirect.value}`)
const teamEntry = computed(() => `/console/team?redirect=${currentGameRedirect.value}`)

const hasVisibleChallengeContent = computed(() =>
  challenges.value.some(ch => hasChallengeContentEntry(ch)),
)

const hasManagedInstanceChallenges = computed(() =>
  challenges.value.some(challenge => supportsManagedInstance(challenge)),
)

async function fetchAll() {
  loading.value = true
  try {
    const gameRequest = $api('get', '/api/games/{id}', { params: { id: Number(gameId) } })
    const challengesRequest = $api('get', '/api/games/{id}/challenges', { params: { id: Number(gameId) } })
    const announcementsRequest = $fetch<typeof announcements.value>(`/api/games/${gameId}/announcements`)
    const participationRequest = authState.user
      ? $api('get', '/api/games/{id}/participation', { params: { id: Number(gameId) } })
      : Promise.resolve(null)

    const [gameRes, challengesRes, announcementsRes, participationRes] = await Promise.all([
      gameRequest,
      challengesRequest,
      announcementsRequest,
      participationRequest,
    ])
    const shouldFetchWriteup = !!authState.user && !!participationRes?.has_team
    const writeupRes = shouldFetchWriteup
      ? await $api('get', '/api/games/{id}/writeup', { params: { id: Number(gameId) } })
      : null
    pageLoadError.value = ''
    game.value = gameRes
    challenges.value = challengesRes
    announcements.value = announcementsRes
    participation.value = participationRes
    availableDivisions.value = gameRes.divisions || []
    if (selectedDivision.value && !availableDivisions.value.includes(selectedDivision.value)) {
      selectedDivision.value = ''
    }
    writeup.value = writeupRes
    writeupForm.content = writeupRes?.content || ''
  }
  catch (e: any) {
    game.value = null
    challenges.value = []
    announcements.value = []
    participation.value = null
    writeup.value = null
    writeupForm.content = ''
    pageLoadError.value = e.data?.message || e.message
    toast.add({ title: '获取比赛信息失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    loading.value = false
  }
}

async function fetchWriteup() {
  if (!authState.user) {
    writeup.value = null
    writeupForm.content = ''
    return
  }

  if (!participation.value?.has_team) {
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

const writeupDeadlinePassed = computed(() =>
  participation.value?.writeup_deadline_passed
  ?? (game.value?.writeup_deadline ? Date.now() > new Date(game.value.writeup_deadline).getTime() : false),
)

async function refreshParticipationView() {
  participationLoading.value = true
  try {
    await fetchAll()
  }
  finally {
    participationLoading.value = false
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

async function fetchChallengeInstance(challengeId: number) {
  if (!authState.user) {
    instanceStates[challengeId] = null
    return
  }

  instanceLoading[challengeId] = true
  try {
    instanceStates[challengeId] = await $api('get', '/api/games/{id}/challenges/{challengeId}/instance', {
      params: {
        id: Number(gameId),
        challengeId,
      },
    })
  }
  catch (e: any) {
    instanceStates[challengeId] = null
  }
  finally {
    instanceLoading[challengeId] = false
  }
}

async function ensureChallengeInstance(challengeId: number) {
  instanceStarting[challengeId] = true
  try {
    instanceStates[challengeId] = await $api('post', '/api/games/{id}/challenges/{challengeId}/instance', {
      params: {
        id: Number(gameId),
        challengeId,
      },
    })
    toast.add({ title: '实例已准备', description: instanceStates[challengeId]?.message || '当前队伍实例已启动或续期。', color: 'success' })
  }
  catch (e: any) {
    toast.add({ title: '实例操作失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    instanceStarting[challengeId] = false
  }
}

async function destroyChallengeInstance(challengeId: number) {
  instanceDestroying[challengeId] = true
  try {
    instanceStates[challengeId] = await $api('delete', '/api/games/{id}/challenges/{challengeId}/instance', {
      params: {
        id: Number(gameId),
        challengeId,
      },
    })
    toast.add({ title: '实例已销毁', description: instanceStates[challengeId]?.message || '当前队伍实例已销毁。', color: 'success' })
  }
  catch (e: any) {
    toast.add({ title: '销毁实例失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    instanceDestroying[challengeId] = false
  }
}

async function copyValue(value?: string, successTitle = '内容已复制') {
  if (!value) {
    toast.add({
      title: '没有可复制的内容',
      color: 'warning',
    })
    return
  }

  try {
    await navigator.clipboard.writeText(value)
    toast.add({
      title: successTitle,
      description: value,
      color: 'success',
    })
  }
  catch (e: any) {
    toast.add({
      title: '复制失败',
      description: e.data?.message || e.message,
      color: 'error',
    })
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
      toast.add({
        title: res.is_practice ? '练习提交成功' : '🎉 Flag 正确！',
        description: res.is_practice
          ? '这次提交已记录为赛后练习，不会再计入正式榜单分数。'
          : `+${res.score} 分${res.blood_type ? ` (${res.blood_type === 'first' ? '一血' : res.blood_type === 'second' ? '二血' : '三血'})` : ''}`,
        color: 'success',
      })
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
      body: {
        team_id: teamId,
        invitation_code: registrationForm.invitation_code,
      },
    })
    toast.add({
      title: game.value?.registration_mode === 'auto_accept' ? '报名成功' : '报名申请已提交',
      description: game.value?.registration_mode === 'auto_accept'
        ? '当前比赛已自动通过报名，队伍现在可以按比赛状态直接参赛。'
        : '等待管理员审核通过后即可正式参赛。',
      color: 'success',
    })
    registrationForm.invitation_code = ''
    await refreshParticipationView()
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
    await refreshParticipationView()
  }
  catch (e: any) {
    toast.add({ title: '退出失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    leaving.value = false
  }
}

function resetConfirmAction() {
  confirmAction.title = ''
  confirmAction.description = ''
  confirmAction.confirmLabel = '确认'
  confirmAction.color = 'error'
  confirmAction.run = null
}

function openConfirmAction(options: {
  title: string
  description: string
  confirmLabel: string
  color?: 'error' | 'warning' | 'primary' | 'neutral'
  run: () => Promise<void>
}) {
  confirmAction.title = options.title
  confirmAction.description = options.description
  confirmAction.confirmLabel = options.confirmLabel
  confirmAction.color = options.color || 'error'
  confirmAction.run = options.run
  confirmModalOpen.value = true
}

async function executeConfirmAction() {
  if (!confirmAction.run) {
    confirmModalOpen.value = false
    return
  }

  confirmActionLoading.value = true
  try {
    await confirmAction.run()
    confirmModalOpen.value = false
    resetConfirmAction()
  }
  finally {
    confirmActionLoading.value = false
  }
}

function confirmLeaveGame() {
  openConfirmAction({
    title: '确认退出当前报名',
    description: '退出后，当前队伍会从这场比赛的报名记录中移除。若比赛仍开放报名，可稍后重新提交。',
    confirmLabel: '确认退出',
    color: 'error',
    run: leaveGame,
  })
}

function confirmDestroyChallengeInstance(challenge: GameChallengeDetail) {
  openConfirmAction({
    title: '确认销毁当前实例',
    description: `实例销毁后，当前队伍在题目「${challenge.title}」上的运行环境会被回收；如仍需使用，可稍后重新启动。`,
    confirmLabel: '销毁实例',
    color: 'error',
    run: () => destroyChallengeInstance(challenge.id),
  })
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

function getChallengeInstanceSpec(raw?: string) {
  return parseChallengeInstanceSpec(raw)
}

function hasChallengeInstanceTemplate(raw?: string) {
  return hasChallengeInstanceTemplateTokens(raw)
}

function supportsManagedInstance(challenge: GameChallengeDetail) {
  const spec = getChallengeInstanceSpec(challenge.container_spec)
  return challenge.type === 'dynamic' && !!spec && (!!spec.runtimeProvider || !!spec.runtimeImage)
}

function hasChallengeContentEntry(challenge: GameChallengeDetail) {
  return hasChallengeContent({
    description: challenge.description,
    hints: challenge.hints,
    attachments: challenge.attachments,
  })
}

function getChallengeFlagFormat(challenge: GameChallengeDetail) {
  return challenge.flag_format?.trim() || 'flag{...}'
}

function getDisplayedInstanceLaunchUrl(challenge: GameChallengeDetail) {
  return instanceStates[challenge.id]?.launch_url || getChallengeInstanceSpec(challenge.container_spec)?.url || ''
}

function getDisplayedInstanceHost(challenge: GameChallengeDetail) {
  return instanceStates[challenge.id]?.host || getChallengeInstanceSpec(challenge.container_spec)?.host || ''
}

function getDisplayedInstancePort(challenge: GameChallengeDetail) {
  return instanceStates[challenge.id]?.port || getChallengeInstanceSpec(challenge.container_spec)?.port || ''
}

function getDisplayedInstanceCommand(challenge: GameChallengeDetail) {
  return instanceStates[challenge.id]?.command || getChallengeInstanceSpec(challenge.container_spec)?.command || ''
}

function getDisplayedInstanceLinks(challenge: GameChallengeDetail) {
  if (instanceStates[challenge.id]?.launch_url) {
    return [{
      label: '当前队伍实例',
      url: instanceStates[challenge.id]?.launch_url || '',
    }]
  }

  return getChallengeInstanceSpec(challenge.container_spec)?.links || []
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return '-'
  }

  return new Date(value).toLocaleString()
}

function getInstanceSecondsLeft(challengeId: number) {
  const state = instanceStates[challengeId]
  if (!state?.expires_at) {
    return Math.max(0, state?.seconds_left || 0)
  }

  return Math.max(0, Math.floor((new Date(state.expires_at).getTime() - now.value) / 1000))
}

function formatSecondsLeft(seconds: number) {
  if (seconds <= 0) {
    return '0 秒'
  }

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  const parts = []

  if (hours > 0) {
    parts.push(`${hours} 小时`)
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes} 分`)
  }
  parts.push(`${remainingSeconds} 秒`)

  return parts.join(' ')
}

function getInstanceLeasePercent(challengeId: number) {
  const state = instanceStates[challengeId]
  if (!state?.started_at || !state?.expires_at) {
    return state?.status === 'running' && getInstanceSecondsLeft(challengeId) > 0 ? 100 : 0
  }

  const startedAt = new Date(state.started_at).getTime()
  const expiresAt = new Date(state.expires_at).getTime()
  const total = expiresAt - startedAt
  if (total <= 0) {
    return getInstanceSecondsLeft(challengeId) > 0 ? 100 : 0
  }

  const remaining = Math.max(0, expiresAt - now.value)
  return Math.max(0, Math.min(100, Math.round((remaining / total) * 100)))
}

function getInstanceStatusColor(challengeId: number) {
  const state = instanceStates[challengeId]
  if (state?.status === 'running' && getInstanceSecondsLeft(challengeId) > 0) {
    return 'success' as const
  }

  return 'neutral' as const
}

function getInstanceStatusLabel(challengeId: number) {
  const state = instanceStates[challengeId]
  if (!state) {
    return '未获取'
  }

  if (state.status === 'running' && getInstanceSecondsLeft(challengeId) > 0) {
    return '运行中'
  }

  return '待启动'
}

function isMockInstance(challenge: GameChallengeDetail) {
  const url = getDisplayedInstanceLaunchUrl(challenge)
  return url.startsWith('/local-instance/') || url.startsWith('/mock-instance/')
}

function getInstanceEntryLabel(challenge: GameChallengeDetail) {
  if (instanceStates[challenge.id]?.launch_url) {
    return isMockInstance(challenge) ? '本地访问入口' : '当前队伍实例'
  }

  return hasChallengeInstanceTemplate(challenge.container_spec) ? '预设入口' : '静态入口'
}

function getInstanceEntryColor(challenge: GameChallengeDetail) {
  if (instanceStates[challenge.id]?.launch_url) {
    return isMockInstance(challenge) ? 'warning' as const : 'success' as const
  }

  return hasChallengeInstanceTemplate(challenge.container_spec) ? 'info' as const : 'neutral' as const
}

function getInstancePrimaryActionLabel(challengeId: number) {
  const state = instanceStates[challengeId]
  if (state?.status === 'running') {
    return state.can_renew ? '续期实例' : '等待续期窗口'
  }

  return '启动实例'
}

function getInstancePolicyHint(challengeId: number) {
  const state = instanceStates[challengeId]
  const policy = state?.policy
  const leaseDuration = policy?.lease_duration_minutes
  const extensionDuration = policy?.extension_duration_minutes
  const renewalWindow = policy?.renewal_window_minutes
  const teamActiveLimit = policy?.team_active_limit

  if (leaseDuration && extensionDuration && renewalWindow && teamActiveLimit) {
    if (state?.status === 'running') {
      if (state.can_renew) {
        return `当前实例已经进入续期窗口；现在续期会在现有未过期租约后追加 ${extensionDuration} 分钟。当前每支队伍最多同时保留 ${teamActiveLimit} 个运行中实例。`
      }

      return `当前实例采用 ${leaseDuration} 分钟初始租约，只有在到期前 ${renewalWindow} 分钟内才开放续期；每次成功续期会额外追加 ${extensionDuration} 分钟。当前每支队伍最多同时保留 ${teamActiveLimit} 个运行中实例。`
    }

    return `首次启动会创建 ${leaseDuration} 分钟初始租约；之后每次成功续期会额外追加 ${extensionDuration} 分钟，并且只有在到期前 ${renewalWindow} 分钟内开放续期。当前每支队伍最多同时保留 ${teamActiveLimit} 个运行中实例。`
  }

  if (state?.status === 'running') {
    if (state.can_renew) {
      return '当前实例已经进入续期窗口；现在续期会在现有未过期租约后追加新的时长。'
    }

    return state.message || '当前实例还未进入续期窗口；只有接近到期时才开放续期。'
  }

  return '首次启动会创建一段初始租约；之后的续期会按当前实例策略额外追加新的时长。'
}

function getManagedInstanceMeta(challenge: GameChallengeDetail) {
  const state = instanceStates[challenge.id]
  const hasTemplateEntry = hasChallengeInstanceTemplate(challenge.container_spec)
  const hasResolvedEntry = !!state?.launch_url
  const secondsLeft = getInstanceSecondsLeft(challenge.id)

  if (!authState.user) {
    return {
      color: 'info' as const,
      icon: 'i-lucide-log-in',
      title: '登录后可查看当前队伍实例状态',
      description: '实例租约按当前队伍维度管理。登录后，页面才会同步你的实例状态、可用入口与续期窗口。',
    }
  }

  if (!participation.value?.has_team) {
    return {
      color: 'warning' as const,
      icon: 'i-lucide-users',
      title: '准备队伍后才能启动实例',
      description: '当前比赛以内队形式分配实例。请先创建或加入队伍，再回到这里启动或查看当前队伍实例。',
    }
  }

  if (!participation.value?.participated) {
    return {
      color: 'info' as const,
      icon: 'i-lucide-badge-plus',
      title: '报名成功后才能分配实例',
      description: '当前队伍还没有这场比赛的报名记录。完成报名后，页面才会继续开放实例启动与状态同步。',
    }
  }

  if (participation.value.status === 'pending') {
    return {
      color: 'warning' as const,
      icon: 'i-lucide-hourglass',
      title: '当前报名待审核，实例暂未开放',
      description: '只有通过报名审核的队伍才能启动或续期实例。审核通过后，这里会自动切换到队伍实例视角。',
    }
  }

  if (participation.value.status === 'rejected') {
    return {
      color: 'error' as const,
      icon: 'i-lucide-badge-x',
      title: '当前报名未通过，实例暂不可用',
      description: '这场比赛的报名还未通过。请先重新报名或调整队伍状态，实例入口与租约操作才会重新开放。',
    }
  }

  if (publicGamePhase.value === 'before_start') {
    return {
      color: 'info' as const,
      icon: 'i-lucide-clock-3',
      title: '比赛尚未开始，实例暂未开放',
      description: '你的队伍已经具备参赛资格。开赛后，这里会自动切换为实例启动或续期状态。',
    }
  }

  if (publicGamePhase.value === 'ended' && !game.value?.practice_mode) {
    return {
      color: 'neutral' as const,
      icon: 'i-lucide-flag-off',
      title: '比赛已结束，实例租约已停止开放',
      description: '当前比赛没有开启赛后练习模式，因此这里只保留实例记录展示，不再开放新的启动或续期操作。',
    }
  }

  if (state?.status === 'running' && secondsLeft <= 0) {
    return {
      color: 'warning' as const,
      icon: 'i-lucide-rotate-ccw',
      title: '当前实例已过期，建议重新启动',
      description: '这条租约已经到期。你可以直接重新启动实例，平台会为当前队伍分配一条新的有效租约。',
    }
  }

  if (state?.status === 'running') {
    if (state.can_renew) {
      return {
        color: 'success' as const,
        icon: 'i-lucide-refresh-cw',
        title: hasResolvedEntry ? '当前队伍实例运行中，已进入续期窗口' : '实例运行中，已进入续期窗口',
        description: hasResolvedEntry
          ? '当前显示的是这支队伍的真实实例入口。现在可以直接访问实例，也可以在到期前完成续期。'
          : '实例已经运行，当前也已进入续期窗口。若入口仍未回填，可先刷新状态后再继续访问或续期。',
      }
    }

    if (hasResolvedEntry) {
      return {
        color: isMockInstance(challenge) ? 'warning' as const : 'success' as const,
        icon: isMockInstance(challenge) ? 'i-lucide-monitor-up' : 'i-lucide-box',
        title: isMockInstance(challenge) ? '当前队伍实例运行中，入口已切换到访问页' : '当前队伍实例运行中',
        description: isMockInstance(challenge)
          ? '当前入口已经切换到实例访问页。你可以先进入页面核对访问地址、租约剩余时间和后续续期窗口。'
          : '当前显示的是这支队伍的真实实例入口。实例仍在有效期内，但还没有进入可续期时间。',
      }
    }

    return {
      color: 'info' as const,
      icon: 'i-lucide-box',
      title: hasTemplateEntry ? '实例运行中，当前仍显示入口模板' : '实例运行中，等待入口信息同步',
      description: hasTemplateEntry
        ? '实例已经启动，但当前还没有拿到这支队伍的实际入口，页面暂时继续展示模板接入信息。可以先刷新状态，等待真实入口回填。'
        : '实例已经启动。若运行入口尚未显示，可以先刷新状态，等待后端同步当前队伍的实际入口信息。',
    }
  }

  if (hasTemplateEntry) {
    return {
      color: 'info' as const,
      icon: 'i-lucide-layout-template',
      title: '当前显示的是实例入口模板',
      description: '这道题支持按队伍分配实例。启动后，这里的模板入口会优先切换成当前队伍的真实访问地址。',
    }
  }

  return {
    color: 'neutral' as const,
    icon: 'i-lucide-play',
    title: '当前还没有运行中的队伍实例',
    description: '这道题支持实例租约。启动后，页面会同步当前队伍的运行状态、剩余时间、入口信息与续期策略。',
  }
}

async function syncChallengeInstances() {
  for (const challenge of challenges.value) {
    if (authState.user && supportsManagedInstance(challenge)) {
      await fetchChallengeInstance(challenge.id)
      continue
    }

    instanceStates[challenge.id] = null
  }
}

async function refreshRunningChallengeInstances() {
  if (instanceAutoRefreshing.value || !authState.user) {
    return
  }

  const runningChallenges = challenges.value.filter(challenge =>
    supportsManagedInstance(challenge)
    && instanceStates[challenge.id]?.status === 'running'
    && getInstanceSecondsLeft(challenge.id) > 0,
  )

  if (runningChallenges.length === 0) {
    return
  }

  instanceAutoRefreshing.value = true
  try {
    await Promise.all(runningChallenges.map(challenge => fetchChallengeInstance(challenge.id)))
  }
  finally {
    instanceAutoRefreshing.value = false
  }
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
  && publicGamePhase.value !== 'ended',
)

const canLeaveGame = computed(() =>
  !!authState.user
  && !!participation.value?.status
  && participation.value?.status !== 'accepted',
)

const canSubmitFlag = computed(() =>
  !!authState.user
  && participation.value?.status === 'accepted'
  && (publicGamePhase.value === 'active' || (publicGamePhase.value === 'ended' && !!game.value?.practice_mode)),
)

const publicGamePhase = computed<PublicGamePhase>(() => {
  if (!game.value) {
    return 'draft'
  }

  if (game.value.status === 'draft') {
    return 'draft'
  }

  const start = new Date(game.value.start_time).getTime()
  const end = new Date(game.value.end_time).getTime()

  if (game.value.status === 'ended' || now.value > end) {
    return 'ended'
  }

  if (now.value < start) {
    return 'before_start'
  }

  return 'active'
})

const publicParticipationHints = computed(() => resolveParticipationHints({
  gameId: Number(gameId),
  gamePhase: publicGamePhase.value,
  practiceMode: game.value?.practice_mode,
  isLoggedIn: !!authState.user,
  participation: participation.value,
  registrationMode: game.value?.registration_mode,
  maxTeamMembers: game.value?.max_team_members,
}))

const participationMeta = computed(() => resolveParticipationMeta({
  gameId: Number(gameId),
  gamePhase: publicGamePhase.value,
  practiceMode: game.value?.practice_mode,
  isLoggedIn: !!authState.user,
  participation: participation.value,
  registrationMode: game.value?.registration_mode,
  maxTeamMembers: game.value?.max_team_members,
  loginTo: loginEntry.value,
  registerTo: registerEntry.value,
  teamTo: teamEntry.value,
}))
const participationStateKey = computed(() => resolveParticipationStateKey({
  gameId: Number(gameId),
  gamePhase: publicGamePhase.value,
  practiceMode: game.value?.practice_mode,
  isLoggedIn: !!authState.user,
  participation: participation.value,
  registrationMode: game.value?.registration_mode,
  maxTeamMembers: game.value?.max_team_members,
  loginTo: loginEntry.value,
  registerTo: registerEntry.value,
  teamTo: teamEntry.value,
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

const registrationPanelSummary = computed(() => {
  if (participationStateKey.value === 'guest') {
    return {
      title: '当前还不能发起报名',
      description: '先登录账号后，比赛页才会识别你自己的队伍与报名状态，并继续显示报名入口。',
      color: 'info' as const,
      icon: 'i-lucide-log-in',
    }
  }

  if (participationStateKey.value === 'no_team') {
    return {
      title: '当前需要先准备队伍',
      description: '比赛报名、提 Flag 和排行榜都按队伍进行。先创建或加入队伍，再回来完成报名。',
      color: 'warning' as const,
      icon: 'i-lucide-users',
    }
  }

  if (participationStateKey.value === 'pending') {
    return {
      title: '当前报名已提交，正在等待审核',
      description: '这次报名已经进入管理员审核队列。现在不需要重复提交，等待通过后就会开放正式参赛资格。',
      color: 'warning' as const,
      icon: 'i-lucide-hourglass',
    }
  }

  if (participationStateKey.value === 'rejected') {
    return {
      title: '当前报名未通过',
      description: '你可以先撤回这次报名，调整队伍成员或邀请码后，再重新提交新的报名申请。',
      color: 'error' as const,
      icon: 'i-lucide-badge-x',
    }
  }

  if (participationStateKey.value === 'accepted' || participationStateKey.value === 'missing_writeup' || participationStateKey.value === 'writeup_submitted') {
    return {
      title: '当前队伍已经具备参赛资格',
      description: publicGamePhase.value === 'before_start'
        ? '报名已经通过，接下来只需要等待开赛。开赛后会自动开放完整题面和提交入口。'
        : publicGamePhase.value === 'ended'
            ? '这场比赛的正式报名已经完成。当前可以继续查看比赛信息，并按练习模式规则决定是否还能继续提交。'
            : '报名已经通过，当前可以直接切换到题目标签开始解题、启动实例并提交 Flag。',
      color: 'success' as const,
      icon: 'i-lucide-badge-check',
    }
  }

  if (participationStateKey.value === 'ended_unjoined') {
    return {
      title: '比赛已结束，当前不会再受理新报名',
      description: '你仍然可以查看当前比赛的公开信息、题目标题和排行榜，但不能再新增报名记录。',
      color: 'error' as const,
      icon: 'i-lucide-clock-3',
    }
  }

  if (game.value?.registration_mode === 'auto_accept') {
    return {
      title: game.value?.invitation_required ? '当前报名会校验邀请码并直接通过' : '当前报名会直接通过',
      description: game.value?.invitation_required
        ? '提交正确的邀请码后，这次报名会立刻进入已通过状态；如果比赛已经开始，你的队伍随后就能直接提交 Flag。'
        : '这场比赛使用自动通过模式。点击报名后不会进入人工审核，系统会立刻授予当前队伍参赛资格。',
      color: 'success' as const,
      icon: 'i-lucide-badge-check',
    }
  }

  return {
    title: game.value?.invitation_required ? '当前报名会先校验邀请码，再进入审核' : '当前报名需要等待管理员审核',
    description: game.value?.invitation_required
      ? '这场比赛设置了邀请码门槛。邀请码正确后，报名会先记录下来，再等待管理员审核通过。'
      : '这场比赛使用审核制报名。提交后会先进入待审核状态，管理员通过后当前队伍才能正式参赛。',
    color: 'info' as const,
    icon: 'i-lucide-clipboard-check',
  }
})

const registrationInputHint = computed(() => {
  if (game.value?.invitation_required) {
    return game.value?.registration_mode === 'auto_accept'
      ? '当前比赛要求输入正确的邀请码；通过校验后，这次报名会直接进入已通过状态。'
      : '当前比赛要求输入正确的邀请码；通过校验后，这次报名还需要等待管理员审核。'
  }

  return game.value?.registration_mode === 'auto_accept'
    ? '当前比赛不要求邀请码。点击报名后会直接通过，不需要额外等待审核。'
    : '当前比赛不要求邀请码。点击报名后会进入待审核状态，等待管理员通过。'
})

const submitHint = computed(() => publicParticipationHints.value.submitHint)

const challengeVisibilityHint = computed(() => publicParticipationHints.value.visibilityHint)

const challengeSubmitMeta = computed(() => {
  if (canSubmitFlag.value) {
    return {
      title: publicGamePhase.value === 'ended' ? '当前可以继续练习提交' : '当前可以提交 Flag',
      description: publicGamePhase.value === 'ended'
        ? '正式比赛已经结束，但当前比赛开启了赛后练习模式。你仍然可以继续补题提交，练习解题不会再计入正式榜单。'
        : '你的队伍已经具备参赛资格，可以直接在下方输入 Flag 并提交。',
      color: 'success' as const,
    }
  }

  return {
    title: '当前暂时不能提交 Flag',
    description: submitHint.value,
    color: 'warning' as const,
  }
})

function getChallengeCardMeta(challenge: GameChallengeDetail) {
  const hasVisibleContent = hasChallengeContentEntry(challenge)
  const hasInstanceSpec = !!getChallengeInstanceSpec(challenge.container_spec)
  const hasManagedInstance = supportsManagedInstance(challenge)

  if (!hasVisibleContent) {
    return {
      color: 'warning' as const,
      icon: 'i-lucide-eye-off',
      title: '题面内容暂未开放',
      description: hasInstanceSpec
        ? '当前只能查看题目基础信息。题面、提示、附件和实例细节会在具备参赛资格后自动开放。'
        : '当前只能查看题目基础信息。题面、提示和附件会在具备参赛资格后自动开放。',
    }
  }

  if (canSubmitFlag.value) {
    if (hasManagedInstance) {
      return {
        color: 'success' as const,
        icon: 'i-lucide-rocket',
        title: publicGamePhase.value === 'ended' ? '当前可继续练习并管理实例' : '当前可解题、提交并管理实例',
        description: publicGamePhase.value === 'ended'
          ? '当前比赛已进入赛后练习阶段。你可以继续查看题面、提交 Flag，并按练习规则启动或续期当前队伍实例。'
          : '当前题面已开放。你可以直接查看题目内容、提交 Flag，并按当前队伍状态启动或续期实例。',
      }
    }

    return {
      color: 'success' as const,
      icon: 'i-lucide-flag',
      title: publicGamePhase.value === 'ended' ? '当前可继续练习提交' : '当前可直接提交 Flag',
      description: publicGamePhase.value === 'ended'
        ? '当前比赛开启了赛后练习模式。你可以继续查看题面并提交练习解题记录。'
        : '当前题面已开放，队伍也已具备参赛资格，可以直接在下方输入 Flag 提交。',
    }
  }

  if (hasManagedInstance) {
    return {
      color: 'info' as const,
      icon: 'i-lucide-box',
      title: '当前可查看题面与实例信息',
      description: '题面已经开放，但当前还不满足正式提交条件。你仍然可以先阅读题面，并结合实例状态区确认入口与运行策略。',
    }
  }

  return {
    color: 'info' as const,
    icon: 'i-lucide-file-text',
    title: '当前可查看题面，但还不能提交',
    description: '题面内容已经开放。当前不能提交 Flag 时，页面会继续说明具体原因和下一步操作入口。',
  }
}

const nextStepMeta = computed(() => {
  if (participationStateKey.value === 'guest') {
    return {
      title: '需要先登录',
      description: '登录后会直接返回当前比赛，并继续读取当前账号对应的队伍与报名状态。',
      color: 'info' as const,
      actionLabel: '去登录',
      actionTo: loginEntry.value,
      secondaryLabel: '创建账号',
      secondaryTo: registerEntry.value,
    }
  }

  if (participationStateKey.value === 'no_team') {
    return {
      title: '需要先关联队伍',
      description: '当前比赛以内队形式参赛。请先在控制台创建或加入队伍，再返回当前比赛处理报名。',
      color: 'warning' as const,
      actionLabel: '去队伍页',
      actionTo: teamEntry.value,
    }
  }

  if (participationStateKey.value === 'joinable') {
    return {
      title: '当前可报名',
      description: game.value?.registration_mode === 'auto_accept'
        ? '当前比赛会自动通过报名。确认后，如果比赛已开始，你的队伍就可以直接提交 Flag。'
        : '当前比赛需要先提交报名申请。提交后等待管理员审核通过，才能正式参赛。',
      color: 'info' as const,
      actionLabel: '报名比赛',
      actionTo: `/games/${gameId}`,
    }
  }

  if (participationStateKey.value === 'missing_writeup') {
    const currentParticipation = participation.value
    return {
      title: '需要补交 Writeup',
      description: currentParticipation?.writeup_deadline
        ? `当前队伍在 ${new Date(currentParticipation.writeup_deadline).toLocaleString()} 前仍未提交 Writeup，请尽快联系管理员确认补交流程。`
        : '当前队伍仍有未提交的 Writeup，请尽快联系管理员确认后续处理流程。',
      color: 'warning' as const,
      actionLabel: '去 Writeup',
      actionTo: `/games/${gameId}`,
      actionTab: 'writeup' as const,
    }
  }

  if (participationStateKey.value === 'pending') {
    return {
      title: '报名待审核',
      description: '你的队伍报名已经提交成功。现在无需重复操作，等待管理员审核通过后就能正式参赛。',
      color: 'warning' as const,
      actionLabel: '查看队伍',
      actionTo: teamEntry.value,
    }
  }

  if (participationStateKey.value === 'rejected') {
    return {
      title: '报名未通过',
      description: '当前报名没有通过。你可以先退出这次报名，调整队伍后再重新提交申请。',
      color: 'error' as const,
      actionLabel: '退出本次报名',
      actionTo: `/games/${gameId}`,
    }
  }

  if (participationStateKey.value === 'writeup_submitted') {
    return {
      title: 'Writeup 待审核',
      description: 'Writeup 已经提交成功。你可以继续留在比赛页参赛，或返回 Writeup 标签补充更新内容。',
      color: 'info' as const,
      actionLabel: '去 Writeup',
      actionTo: `/games/${gameId}`,
      actionTab: 'writeup' as const,
    }
  }

  if (publicGamePhase.value === 'before_start') {
    return {
      title: '等待开赛',
      description: '你的队伍已经具备参赛资格。比赛开始后，题面会自动开放，随后就可以提交 Flag。',
      color: 'info' as const,
      actionLabel: '查看题目',
      actionTo: `/games/${gameId}`,
      actionTab: 'challenges' as const,
    }
  }

  if (publicGamePhase.value === 'active') {
    return {
      title: '当前可开始解题',
      description: '当前已经满足参赛条件，可以直接切换到题目标签开始查看题面、附件并提交 Flag。',
      color: 'success' as const,
      actionLabel: '进入题目',
      actionTo: `/games/${gameId}`,
      actionTab: 'challenges' as const,
    }
  }

  return {
    title: '比赛已结束',
    description: '比赛当前已经结束。你仍然可以继续查看题目、排行榜和 Writeup 信息。',
    color: 'neutral' as const,
    actionLabel: '查看排行榜',
    actionTo: `/games/${gameId}`,
    actionTab: 'scoreboard' as const,
  }
})

const detailPrimaryAction = computed(() => {
  if (!authState.user) {
    return {
      mode: 'link' as const,
      label: participationMeta.value.actionLabel,
      to: loginEntry.value,
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
      onClick: canLeaveGame.value ? confirmLeaveGame : undefined,
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
      to: registerEntry.value,
      icon: 'i-lucide-user-plus',
    }
  }

  if (!participation.value?.has_team) {
    return {
      label: '去加入队伍',
      to: teamEntry.value,
      icon: 'i-lucide-users',
    }
  }

  if (participation.value?.participated && !canLeaveGame.value) {
    return {
      label: '查看队伍',
      to: teamEntry.value,
      icon: 'i-lucide-users',
    }
  }

  return null
})

function handleNextStepAction(meta: typeof nextStepMeta.value) {
  if (meta.actionTab) {
    activeTab.value = meta.actionTab
  }
}

const writeupGuide = computed(() => {
  if (!authState.user) {
    return {
      title: '登录后可查看 Writeup 状态',
      description: '登录后才能看到你自己的队伍、Writeup 状态和可提交性。',
      color: 'info' as const,
    }
  }

  if (!participation.value?.has_team) {
    return {
      title: '需要先关联队伍',
      description: '当前比赛以内队形式参赛。请先创建或加入队伍，再返回此处查看或提交 Writeup。',
      color: 'warning' as const,
    }
  }

  if (!game.value?.writeup_required) {
    return {
      title: '当前比赛未启用 Writeup 提交',
      description: '当前比赛不会开放选手侧 Writeup 提交，这里仅展示相关状态说明。',
      color: 'neutral' as const,
    }
  }

  if (!participation.value?.participated) {
    return {
      title: '需要先完成比赛报名',
      description: '只有已经报名的队伍，才会继续进入这场比赛的 Writeup 流程。',
      color: 'warning' as const,
    }
  }

  if (participation.value.status !== 'accepted') {
    return {
      title: participation.value.status === 'pending' ? '等待报名审核通过' : '当前报名未通过',
      description: participation.value.status === 'pending'
        ? '报名审核通过后，Writeup 区才会正式开放可提交状态。'
        : '当前报名没有通过，先调整队伍或重新报名，再回来处理 Writeup。',
      color: participation.value.status === 'pending' ? 'warning' as const : 'error' as const,
    }
  }

  if (writeupDeadlinePassed.value) {
    return {
      title: 'Writeup 截止时间已过',
      description: game.value?.writeup_deadline
        ? `当前比赛的 Writeup 截止时间是 ${new Date(game.value.writeup_deadline).toLocaleString()}，现在已经不能继续更新内容。`
        : '当前比赛的 Writeup 提交流程已经结束，现在不能继续更新内容。',
      color: 'error' as const,
    }
  }

  if (writeup.value?.can_submit) {
    return {
      title: '当前可以提交 Writeup',
      description: writeup.value.status === 'rejected'
        ? '管理员曾驳回过这份 Writeup。你可以修改后重新提交，状态会回到 submitted。'
        : '你可以提交或覆盖当前队伍的 Writeup，重新提交后状态会回到 submitted。',
      color: 'success' as const,
    }
  }

  return {
    title: '当前暂时不能提交 Writeup',
    description: '当前还不满足提交流程。通常需要报名已通过，并且比赛本身要求 Writeup。',
    color: 'warning' as const,
  }
})

const participationSummaryLabel = computed(() => {
  if (!authState.user) {
    return '访客可浏览'
  }

  return participationMeta.value.label
})

const participationSummaryColor = computed(() => {
  if (!authState.user) {
    return 'info' as const
  }

  return participationMeta.value.color
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

const contestRestrictionRows = computed(() => [
  {
    label: '报名方式',
    value: game.value?.registration_mode === 'auto_accept' ? '自动通过' : '人工审核',
  },
  {
    label: '比赛邀请码',
    value: game.value?.invitation_required ? '需要' : '不需要',
  },
  {
    label: '队伍人数限制',
    value: game.value?.max_team_members ? `${game.value.max_team_members} 人` : '不限',
  },
  {
    label: '赛后练习',
    value: game.value?.practice_mode ? '开启' : '关闭',
  },
  {
    label: 'Writeup 要求',
    value: game.value?.writeup_required ? '需要' : '不需要',
  },
  {
    label: 'Writeup 截止',
    value: game.value?.writeup_deadline ? new Date(game.value.writeup_deadline).toLocaleString() : '未设置',
  },
  ...(hasManagedInstanceChallenges.value
    ? [{
        label: '动态实例限制',
        value: instanceLimitSummary.value,
      }]
    : []),
])

const contestTeamContextRows = computed(() => [
  {
    label: '当前队伍',
    value: participation.value?.team?.name || '未加入队伍',
  },
  {
    label: '比赛分组',
    value: availableDivisions.value.length ? availableDivisions.value.join(' / ') : '未启用',
  },
  {
    label: '我的分组',
    value: participation.value?.division || '未分配',
  },
  {
    label: '当前可提交 Flag',
    value: canSubmitFlag.value ? '是' : '否',
  },
])

const instanceLimitSummary = computed(() => {
  if (!hasManagedInstanceChallenges.value) {
    return '当前比赛未启用'
  }

  const policyLimit = Object.values(instanceStates)
    .find(state => state?.policy?.team_active_limit)?.policy?.team_active_limit

  if (policyLimit) {
    return `每队最多 ${policyLimit} 个`
  }

  return '按当前实例策略限制'
})

const divisionRuleDescription = computed(() => {
  if (!availableDivisions.value.length) {
    return '当前比赛不区分分组榜，报名后直接进入统一榜单。'
  }

  if (availableDivisions.value.length === 1) {
    return `当前比赛只配置了一个分组：${availableDivisions.value[0]}。报名成功后会自动归入这个分组。`
  }

  if (participation.value?.division) {
    return `当前比赛配置了 ${availableDivisions.value.length} 个分组。你的队伍目前被分配到 ${participation.value.division}。`
  }

  return `当前比赛配置了 ${availableDivisions.value.length} 个分组。报名后会先建立参赛记录，随后由管理员按需要分配到具体分组。`
})

const registrationStepCards = computed(() => [
  {
    label: '账号状态',
    value: authState.user ? '已完成' : '待完成',
    hint: authState.user ? `当前账号：${authState.user.username}` : '登录后才能看到你的队伍状态并提交报名',
    icon: authState.user ? 'i-lucide-check-circle-2' : 'i-lucide-log-in',
    color: authState.user ? 'success' as const : 'neutral' as const,
  },
  {
    label: '队伍状态',
    value: participation.value?.has_team ? '已完成' : '待完成',
    hint: participation.value?.team?.name ? `当前队伍：${participation.value.team.name}` : '比赛以内队形式参赛，请先创建或加入队伍',
    icon: participation.value?.has_team ? 'i-lucide-users-round' : 'i-lucide-users',
    color: participation.value?.has_team ? 'success' as const : 'warning' as const,
  },
  {
    label: '报名状态',
    value: participation.value?.participated
      ? (participation.value.status === 'accepted' ? '已通过' : participation.value.status === 'pending' ? '待审核' : '已拒绝')
      : '待完成',
    hint: participation.value?.participated
      ? (
          participation.value.status === 'accepted'
            ? '当前队伍已经具备正式参赛资格'
            : participation.value.status === 'pending'
              ? '报名已提交，等待管理员审核'
              : '可先撤回报名，调整后重新提交'
        )
      : (game.value?.registration_mode === 'auto_accept' ? '报名后会直接通过' : '报名后需等待管理员审核'),
    icon: participation.value?.status === 'accepted'
      ? 'i-lucide-badge-check'
      : participation.value?.status === 'pending'
        ? 'i-lucide-hourglass'
        : participation.value?.status === 'rejected'
          ? 'i-lucide-badge-x'
          : 'i-lucide-clipboard-check',
    color: participation.value?.status === 'accepted'
      ? 'success' as const
      : participation.value?.status === 'pending'
        ? 'warning' as const
        : participation.value?.status === 'rejected'
          ? 'error' as const
          : 'info' as const,
  },
  {
    label: '提交权限',
    value: canSubmitFlag.value ? '当前可提交' : '暂未开放',
    hint: canSubmitFlag.value
      ? (publicGamePhase.value === 'ended' ? '当前为赛后练习提交，不计入正式榜单' : '可以直接切换到题目标签提交 Flag')
      : submitHint.value,
    icon: canSubmitFlag.value ? 'i-lucide-flag' : 'i-lucide-lock',
    color: canSubmitFlag.value ? 'success' as const : 'neutral' as const,
  },
])

const contestRuleSummaryItems = computed(() => [
  '当前比赛以内队形式组织参赛。',
  game.value?.registration_mode === 'auto_accept'
    ? '报名提交后会直接通过。'
    : '报名提交后需要等待管理员审核。',
  game.value?.invitation_required
    ? '报名时需要输入正确的邀请码。'
    : '报名时不需要额外的邀请码。',
  game.value?.scoreboard_freeze_at
    ? `公开榜单将于 ${new Date(game.value.scoreboard_freeze_at).toLocaleString()} 封榜。`
    : '当前比赛不启用封榜。',
  game.value?.practice_mode
    ? '比赛结束后仍可按练习模式继续补题。'
    : '比赛结束后不会继续开放练习提交。',
  '待审核或已拒绝的报名可以撤回；已通过报名后队伍会锁定。',
])

const scoreboardSummaryCards = computed(() => [
  {
    label: '当前榜单',
    value: selectedDivision.value || '全部队伍',
    hint: selectedDivision.value ? '当前按分组筛选公开榜单' : '当前展示全部公开队伍',
    icon: 'i-lucide-filter',
    color: selectedDivision.value ? 'warning' as const : 'info' as const,
  },
  {
    label: '公开排名',
    value: String(scoreboard.value.length),
    hint: '当前榜单中可见的队伍数量',
    icon: 'i-lucide-users',
    color: 'neutral' as const,
  },
  {
    label: '题目统计',
    value: String(scoreboardChallenges.value.length),
    hint: '当前分题统计中可见的题目数量',
    icon: 'i-lucide-chart-column-big',
    color: 'success' as const,
  },
  {
    label: '封榜状态',
    value: scoreboardFrozen.value ? '已封榜' : '未封榜',
    hint: scoreboardFrozen.value
      ? (scoreboardFreezeTime.value ? `冻结于 ${new Date(scoreboardFreezeTime.value).toLocaleString()}` : '公开榜单已冻结')
      : (game.value?.scoreboard_freeze_at ? `将于 ${new Date(game.value.scoreboard_freeze_at).toLocaleString()} 封榜` : '当前比赛不启用封榜'),
    icon: 'i-lucide-lock',
    color: scoreboardFrozen.value ? 'warning' as const : 'neutral' as const,
  },
])

const scoreboardViewDescription = computed(() => {
  if (scoreboardFrozen.value && scoreboardFreezeTime.value) {
    return `当前看到的是冻结在 ${new Date(scoreboardFreezeTime.value).toLocaleString()} 的公开榜单视图。封榜后的新解题不会继续显示在公开排名中。`
  }

  if (selectedDivision.value) {
    return `当前只显示 ${selectedDivision.value} 的公开队伍排名和分题统计。`
  }

  return '当前显示全部公开队伍的实时排名和分题统计。'
})

const writeupStatusColor = computed(() => {
  if (writeup.value?.status === 'approved') {
    return 'success' as const
  }
  if (writeup.value?.status === 'rejected') {
    return 'error' as const
  }
  if (writeup.value?.status === 'submitted') {
    return 'warning' as const
  }
  return 'neutral' as const
})

const writeupStatusLabel = computed(() => {
  if (writeup.value?.status === 'approved') {
    return '已通过'
  }
  if (writeup.value?.status === 'rejected') {
    return '已驳回'
  }
  if (writeup.value?.status === 'submitted') {
    return '待审核'
  }
  return '未提交'
})

const writeupSummaryCards = computed(() => [
  {
    label: 'Writeup 状态',
    value: writeupStatusLabel.value,
    hint: writeup.value?.status ? `当前后端状态：${writeup.value.status}` : '当前队伍还没有提交 Writeup',
    icon: 'i-lucide-file-text',
    color: writeupStatusColor.value,
  },
  {
    label: '提交资格',
    value: writeup.value?.can_submit ? '当前可提交' : '当前不可提交',
    hint: writeup.value?.can_submit ? '支持覆盖提交，重新提交后会回到 submitted' : writeupGuide.value.description,
    icon: 'i-lucide-file-up',
    color: writeup.value?.can_submit ? 'success' as const : 'warning' as const,
  },
  {
    label: '截止时间',
    value: game.value?.writeup_deadline ? new Date(game.value.writeup_deadline).toLocaleString() : '未单独设置',
    hint: !game.value?.writeup_required
      ? '当前比赛未启用 Writeup 提交'
      : writeupDeadlinePassed.value
          ? '当前截止时间已过，不能继续提交或更新'
          : '当前比赛要求按这个时间前完成 Writeup 处理',
    icon: 'i-lucide-calendar-clock',
    color: !game.value?.writeup_deadline
      ? 'neutral' as const
      : writeupDeadlinePassed.value
          ? 'error' as const
          : 'info' as const,
  },
  {
    label: '最近提交',
    value: writeup.value?.submitted_at ? new Date(writeup.value.submitted_at).toLocaleString() : '暂无',
    hint: writeup.value?.reviewed_at
      ? `最近审核时间 ${new Date(writeup.value.reviewed_at).toLocaleString()}`
      : '当前还没有审核记录',
    icon: 'i-lucide-history',
    color: 'neutral' as const,
  },
])

const writeupRuleItems = computed(() => [
  !authState.user
    ? '先登录后才能查看你自己的队伍 Writeup 状态。'
    : !participation.value?.has_team
      ? '先创建或加入队伍，再返回这里处理 Writeup。'
      : '当前比赛以内队形式管理 Writeup，内容会绑定到你当前队伍。',
  game.value?.writeup_required
    ? '当前比赛要求提交 Writeup。'
    : '当前比赛未启用 Writeup 提交，本页仅展示状态说明。',
  game.value?.writeup_deadline
    ? (writeupDeadlinePassed.value
        ? `Writeup 截止时间已于 ${new Date(game.value.writeup_deadline).toLocaleString()} 结束。`
        : `如果需要提交，截止时间为 ${new Date(game.value.writeup_deadline).toLocaleString()}。`)
    : '当前没有单独设置 Writeup 截止时间。',
  writeup.value?.status === 'rejected'
    ? '当前 Writeup 已被驳回，修改后重新提交会回到 submitted 状态。'
    : '重复提交会覆盖当前内容，并重新进入 submitted 状态等待审核。',
  'Writeup 审核结果由管理员在管理端更新，审核备注会直接展示在本页。',
])

const canEditWriteup = computed(() => !!writeup.value?.can_submit)

const writeupBlockedAction = computed(() => {
  if (!authState.user) {
    return {
      label: '登录账号',
      to: loginEntry.value,
      icon: 'i-lucide-log-in',
    }
  }

  if (!participation.value?.has_team) {
    return {
      label: '管理队伍',
      to: teamEntry.value,
      icon: 'i-lucide-users',
    }
  }

  if (!participation.value?.participated || participation.value.status !== 'accepted') {
    return {
      label: '查看比赛概览',
      to: undefined,
      icon: 'i-lucide-layout-template',
    }
  }

  return null
})

const flagBlockedAction = computed(() => {
  if (!authState.user) {
    return {
      label: '登录账号',
      to: loginEntry.value,
      icon: 'i-lucide-log-in',
    }
  }

  if (!participation.value?.has_team) {
    return {
      label: '管理队伍',
      to: teamEntry.value,
      icon: 'i-lucide-users',
    }
  }

  if (!participation.value?.participated || participation.value.status !== 'accepted') {
    return {
      label: '查看比赛概览',
      to: undefined,
      icon: 'i-lucide-layout-template',
    }
  }

  return null
})

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
  }, 1000)
  const instanceRefreshTimer = window.setInterval(() => {
    if (activeTab.value === 'challenges') {
      refreshRunningChallengeInstances()
    }
  }, 15_000)
  await fetchAll()
  await syncChallengeInstances()

  onBeforeUnmount(() => {
    window.clearInterval(timer)
    window.clearInterval(instanceRefreshTimer)
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
        <div class="space-y-4">
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
                  :color="participationSummaryColor"
                  variant="soft"
                >
                  {{ participationSummaryLabel }}
                </UBadge>
                <span v-if="participation?.team" class="text-sm text-muted">
                  当前队伍：{{ participation.team.name }}
                </span>
              </div>
              <p class="mt-2 text-sm text-muted max-w-2xl">
                {{ participationHint.description }}
              </p>
              <UAlert
                class="mt-3 max-w-2xl"
                :icon="registrationPanelSummary.icon"
                :color="registrationPanelSummary.color"
                variant="soft"
                :title="registrationPanelSummary.title"
                :description="registrationPanelSummary.description"
              />
              <div
                v-if="authState.user && participation?.has_team && !participation?.participated"
                class="mt-3 max-w-md"
              >
                <UFormField
                  v-if="game?.invitation_required"
                  label="比赛邀请码"
                  name="invitation_code"
                  :description="registrationInputHint"
                >
                  <UInput
                    v-model="registrationForm.invitation_code"
                    class="w-full"
                    placeholder="请输入比赛邀请码"
                  />
                </UFormField>
                <p v-else class="text-sm text-muted">
                  {{ registrationInputHint }}
                </p>
              </div>
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

          <UAlert
            :color="nextStepMeta.color"
            variant="soft"
            :title="nextStepMeta.title"
            :description="nextStepMeta.description"
          >
            <template #actions>
              <div class="flex gap-2">
                <UButton
                  size="sm"
                  :to="nextStepMeta.actionTo"
                  :color="nextStepMeta.color === 'neutral' ? 'neutral' : 'primary'"
                  @click="handleNextStepAction(nextStepMeta)"
                >
                  {{ nextStepMeta.actionLabel }}
                </UButton>
                <UButton
                  v-if="nextStepMeta.secondaryLabel && nextStepMeta.secondaryTo"
                  size="sm"
                  variant="outline"
                  :to="nextStepMeta.secondaryTo"
                >
                  {{ nextStepMeta.secondaryLabel }}
                </UButton>
              </div>
            </template>
          </UAlert>
        </div>
      </UPageCard>

      <UTabs v-model="activeTab" :items="tabItems" class="mb-6" />

      <div v-if="activeTab === 'overview'" class="space-y-6">
        <div class="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.95fr)]">
          <UPageCard title="比赛信息" icon="i-lucide-scroll-text">
            <div class="space-y-4 text-sm leading-7">
              <p class="text-default whitespace-pre-wrap">
                {{ game.description || '当前比赛暂未填写详细信息。' }}
              </p>

              <UAlert
                v-if="game.notice"
                color="info"
                variant="soft"
                title="补充信息"
                :description="game.notice"
              />

              <div class="rounded-lg border border-default bg-muted/40 p-4">
                <ul class="space-y-2 text-muted">
                  <li
                    v-for="(item, index) in contestRuleSummaryItems"
                    :key="`${index}-${item}`"
                  >
                    {{ index + 1 }}. {{ item }}
                  </li>
                </ul>
              </div>

              <div
                v-if="announcements.length"
                class="rounded-lg border border-default bg-muted/40 p-4"
              >
                <div class="mb-3 flex items-center gap-2 font-medium">
                  <UIcon name="i-lucide-megaphone" class="size-4 text-info" />
                  <span>赛时通知</span>
                </div>
                <div class="space-y-3">
                  <div
                    v-for="announcement in announcements"
                    :key="announcement.id"
                    class="rounded-lg border border-default bg-default px-3 py-3"
                  >
                    <div class="text-xs text-muted">
                      {{ new Date(announcement.created_at).toLocaleString() }}
                    </div>
                    <div class="mt-2 whitespace-pre-wrap leading-6">
                      {{ announcement.content }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </UPageCard>

          <div class="space-y-6">
            <UPageCard title="当前行动" icon="i-lucide-list-checks">
              <div class="space-y-4">
                <UAlert
                  :color="nextStepMeta.color"
                  variant="soft"
                  :title="nextStepMeta.title"
                  :description="nextStepMeta.description"
                >
                  <template #actions>
                    <div class="flex gap-2 flex-wrap">
                      <UButton
                        size="sm"
                        :to="nextStepMeta.actionTo"
                        :color="nextStepMeta.color === 'neutral' ? 'neutral' : 'primary'"
                        @click="handleNextStepAction(nextStepMeta)"
                      >
                        {{ nextStepMeta.actionLabel }}
                      </UButton>
                      <UButton
                        v-if="nextStepMeta.secondaryLabel && nextStepMeta.secondaryTo"
                        size="sm"
                        variant="outline"
                        :to="nextStepMeta.secondaryTo"
                      >
                        {{ nextStepMeta.secondaryLabel }}
                      </UButton>
                    </div>
                  </template>
                </UAlert>

                <div class="flex flex-col gap-3">
                  <UButton icon="i-lucide-flag" variant="outline" @click="activeTab = 'challenges'">
                    浏览题目
                  </UButton>
                  <UButton icon="i-lucide-trophy" variant="outline" @click="activeTab = 'scoreboard'">
                    查看排行榜
                  </UButton>
                  <UButton icon="i-lucide-users" variant="outline" :to="teamEntry">
                    管理我的队伍
                  </UButton>
                </div>
              </div>
            </UPageCard>

            <UPageCard title="参赛状态" icon="i-lucide-route">
              <UPageGrid :cols="{ default: 1, sm: 2 }">
                <UPageCard
                  v-for="card in registrationStepCards"
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
            </UPageCard>

            <UPageCard title="参赛限制" icon="i-lucide-badge-check">
              <div class="space-y-3 text-sm">
                <div
                  v-for="row in contestRestrictionRows"
                  :key="row.label"
                  class="flex items-center justify-between gap-3"
                >
                  <span class="text-muted">{{ row.label }}</span>
                  <span class="text-right">{{ row.value }}</span>
                </div>
              </div>
            </UPageCard>

            <UPageCard title="队伍与分组" icon="i-lucide-users-round">
              <div class="space-y-3 text-sm">
                <div
                  v-for="row in contestTeamContextRows"
                  :key="row.label"
                  class="flex items-center justify-between gap-3"
                >
                  <span class="text-muted">{{ row.label }}</span>
                  <span class="text-right">{{ row.value }}</span>
                </div>
                <div class="rounded-lg border border-default px-3 py-3">
                  <div class="text-muted">
                    分组规则
                  </div>
                  <div class="mt-2 leading-6">
                    {{ divisionRuleDescription }}
                  </div>
                </div>
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
          </div>
        </div>
      </div>

      <!-- Challenges Tab -->
      <div v-else-if="activeTab === 'challenges'">
        <UAlert
          class="mb-6"
          :color="hasVisibleChallengeContent ? 'success' : 'warning'"
          variant="soft"
          :title="hasVisibleChallengeContent ? '题目内容已开放' : '题目内容暂未完全开放'"
          :description="challengeVisibilityHint"
        />

        <UEmpty
          v-if="challenges.length === 0"
          icon="i-lucide-file-question"
          title="当前还没有可浏览的题目"
          :description="authState.user
            ? '如果这场比赛已经开赛但仍然没有题目，建议先回到概览区确认比赛状态，或联系管理员核对题目发布情况。'
            : '当前可以先浏览比赛信息和排行榜；题目开放后，这里会展示对应分类和题目列表。'"
          :actions="[
            {
              label: '返回比赛概览',
              icon: 'i-lucide-layout-template',
              color: 'neutral',
              variant: 'outline',
              onClick: () => {
                activeTab = 'overview'
              },
            },
          ]"
        />

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

                <div class="mb-3 text-xs text-muted">
                  Flag 格式：{{ getChallengeFlagFormat(ch) }}
                </div>

                <div class="space-y-3 mb-4 text-sm">
                  <UAlert
                    :color="getChallengeCardMeta(ch).color"
                    :icon="getChallengeCardMeta(ch).icon"
                    variant="soft"
                    :title="getChallengeCardMeta(ch).title"
                    :description="getChallengeCardMeta(ch).description"
                  />

                  <p class="text-muted leading-6 whitespace-pre-wrap">
                    {{ ch.description || '当前题面内容暂未开放，待报名通过并开赛后会自动显示。' }}
                  </p>

                  <div v-if="getChallengeHints(ch.hints).length" class="rounded-lg border border-default bg-muted/40 px-3 py-3">
                    <div class="mb-2 flex items-center gap-2 text-sm font-medium">
                      <UIcon name="i-lucide-lightbulb" class="size-4 text-warning" />
                      <span>提示</span>
                    </div>
                    <ul class="space-y-2 text-muted">
                      <li
                        v-for="(hint, hintIndex) in getChallengeHints(ch.hints)"
                        :key="`${ch.id}-hint-${hintIndex}`"
                      >
                        {{ hintIndex + 1 }}. {{ hint }}
                      </li>
                    </ul>
                  </div>

                  <div v-if="getChallengeAttachments(ch.attachments).length" class="rounded-lg border border-default bg-muted/40 px-3 py-3">
                    <div class="mb-2 flex items-center gap-2 text-sm font-medium">
                      <UIcon name="i-lucide-paperclip" class="size-4 text-info" />
                      <span>附件</span>
                    </div>
                    <div class="flex flex-col gap-2">
                      <div
                        v-for="(attachment, attachmentIndex) in getChallengeAttachments(ch.attachments)"
                        :key="`${ch.id}-attachment-${attachmentIndex}`"
                        class="flex items-center justify-between gap-3 rounded-lg border border-default bg-default px-3 py-3"
                      >
                        <div class="min-w-0">
                          <div class="flex items-center gap-2">
                            <span class="truncate font-medium text-highlighted">
                              {{ getChallengeAttachmentDisplayName(attachment, attachmentIndex) }}
                            </span>
                            <UBadge :color="getChallengeAttachmentMeta(attachment).color" variant="subtle" size="sm">
                              {{ getChallengeAttachmentMeta(attachment).badge }}
                            </UBadge>
                          </div>
                          <div class="mt-1 truncate text-xs text-muted">
                            {{ attachment }}
                          </div>
                        </div>
                        <UButton
                          :to="attachment"
                          target="_blank"
                          variant="outline"
                          size="sm"
                          icon="i-lucide-download"
                        >
                          下载
                        </UButton>
                      </div>
                    </div>
                  </div>

                  <div
                    v-if="getChallengeInstanceSpec(ch.container_spec)"
                    class="rounded-lg border border-default bg-muted/40 px-3 py-3"
                  >
                    <div class="mb-2 flex items-center gap-2 text-sm font-medium">
                      <UIcon name="i-lucide-box" class="size-4 text-success" />
                      <span>实例接入信息</span>
                    </div>
                    <div class="space-y-2 text-muted">
                      <UAlert
                        :color="getManagedInstanceMeta(ch).color"
                        :icon="getManagedInstanceMeta(ch).icon"
                        variant="soft"
                        :title="getManagedInstanceMeta(ch).title"
                        :description="getManagedInstanceMeta(ch).description"
                      />
                      <p v-if="getChallengeInstanceSpec(ch.container_spec)?.note" class="leading-6 whitespace-pre-wrap">
                        {{ getChallengeInstanceSpec(ch.container_spec)?.note }}
                      </p>
                      <div class="flex flex-wrap items-center gap-2">
                        <UBadge :color="getInstanceEntryColor(ch)" variant="soft" size="sm">
                          {{ getInstanceEntryLabel(ch) }}
                        </UBadge>
                        <UBadge
                          v-if="supportsManagedInstance(ch)"
                          :color="instanceAutoRefreshing ? 'info' : 'neutral'"
                          variant="subtle"
                          size="sm"
                        >
                          {{ instanceAutoRefreshing ? '自动同步中' : '15 秒自动同步' }}
                        </UBadge>
                      </div>
                      <div v-if="getDisplayedInstanceLaunchUrl(ch)" class="flex flex-col gap-2">
                        <div class="flex flex-wrap gap-2">
                          <UButton
                            :to="getDisplayedInstanceLaunchUrl(ch)"
                            target="_blank"
                            variant="outline"
                            size="sm"
                            icon="i-lucide-external-link"
                            class="justify-start"
                          >
                            {{ instanceStates[ch.id]?.launch_url ? '打开当前队伍实例' : '打开实例入口' }}
                          </UButton>
                          <UButton
                            variant="ghost"
                            size="sm"
                            icon="i-lucide-copy"
                            @click="copyValue(getDisplayedInstanceLaunchUrl(ch), '实例入口已复制')"
                          >
                            复制入口
                          </UButton>
                        </div>
                      </div>
                      <div v-if="getDisplayedInstanceHost(ch) || getDisplayedInstancePort(ch)" class="space-y-2">
                        <div class="text-sm">
                          {{ getDisplayedInstanceHost(ch) || 'host' }}<template v-if="getDisplayedInstancePort(ch)">:{{ getDisplayedInstancePort(ch) }}</template>
                        </div>
                        <UButton
                          variant="ghost"
                          size="sm"
                          icon="i-lucide-copy"
                          class="w-fit"
                          @click="copyValue(`${getDisplayedInstanceHost(ch) || 'host'}${getDisplayedInstancePort(ch) ? `:${getDisplayedInstancePort(ch)}` : ''}`, '主机地址已复制')"
                        >
                          复制主机地址
                        </UButton>
                      </div>
                      <div v-if="getDisplayedInstanceCommand(ch)" class="rounded-md border border-default bg-default px-3 py-2 font-mono text-xs whitespace-pre-wrap">
                        {{ getDisplayedInstanceCommand(ch) }}
                      </div>
                      <UButton
                        v-if="getDisplayedInstanceCommand(ch)"
                        variant="ghost"
                        size="sm"
                        icon="i-lucide-copy"
                        class="w-fit"
                        @click="copyValue(getDisplayedInstanceCommand(ch), '连接命令已复制')"
                      >
                        复制连接命令
                      </UButton>
                      <div v-if="getDisplayedInstanceLinks(ch).length" class="flex flex-col gap-2">
                        <UButton
                          v-for="(link, linkIndex) in getDisplayedInstanceLinks(ch)"
                          :key="`${ch.id}-instance-link-${linkIndex}`"
                          :to="link.url"
                          target="_blank"
                          variant="outline"
                          size="sm"
                          icon="i-lucide-link"
                          class="justify-start"
                        >
                          {{ link.label || `实例链接 ${linkIndex + 1}` }}
                        </UButton>
                      </div>
                      <div v-if="getChallengeInstanceSpec(ch.container_spec)?.runtimeProvider || getChallengeInstanceSpec(ch.container_spec)?.runtimeImage || getChallengeInstanceSpec(ch.container_spec)?.runtimeExpose.length" class="rounded-md border border-default bg-default px-3 py-2 text-xs text-muted">
                        <div v-if="getChallengeInstanceSpec(ch.container_spec)?.runtimeProvider">
                          运行环境：{{ getChallengeInstanceSpec(ch.container_spec)?.runtimeProvider }}
                        </div>
                        <div v-if="getChallengeInstanceSpec(ch.container_spec)?.runtimeImage">
                          镜像：{{ getChallengeInstanceSpec(ch.container_spec)?.runtimeImage }}
                        </div>
                        <div v-if="getChallengeInstanceSpec(ch.container_spec)?.runtimeExpose.length">
                          暴露端口：{{ getChallengeInstanceSpec(ch.container_spec)?.runtimeExpose.join(' / ') }}
                        </div>
                      </div>
                      <div
                        v-if="supportsManagedInstance(ch)"
                        class="rounded-md border border-default bg-default px-3 py-3"
                      >
                        <div class="mb-3 flex items-center justify-between gap-3">
                          <div class="flex items-center gap-2">
                            <span class="text-sm font-medium text-highlighted">实例状态</span>
                            <UBadge :color="getInstanceStatusColor(ch.id)" variant="soft" size="sm">
                              {{ getInstanceStatusLabel(ch.id) }}
                            </UBadge>
                          </div>
                          <span class="text-xs text-muted">
                            {{ instanceLoading[ch.id] ? '同步中' : `剩余 ${getInstanceSecondsLeft(ch.id)} 秒` }}
                          </span>
                        </div>

                        <div class="mb-3 rounded-md border border-default px-3 py-3">
                          <div class="mb-2 flex items-center justify-between gap-3 text-xs text-muted">
                            <span>租约剩余时间</span>
                            <span>{{ instanceLoading[ch.id] ? '同步中' : formatSecondsLeft(getInstanceSecondsLeft(ch.id)) }}</span>
                          </div>
                          <UProgress :model-value="getInstanceLeasePercent(ch.id)" status />
                        </div>

                        <div class="mb-3 rounded-md border border-default px-3 py-3 text-xs text-muted">
                          <div class="mb-1 font-medium text-highlighted">
                            当前续期策略
                          </div>
                          <div>
                            {{ getInstancePolicyHint(ch.id) }}
                          </div>
                        </div>

                        <div class="grid gap-3 text-xs text-muted md:grid-cols-2">
                          <div class="rounded-md border border-default px-3 py-2">
                            <div>Provider</div>
                            <div class="mt-1 text-sm text-highlighted">
                              {{ instanceStates[ch.id]?.provider || getChallengeInstanceSpec(ch.container_spec)?.runtimeProvider || '-' }}
                            </div>
                          </div>
                          <div class="rounded-md border border-default px-3 py-2">
                            <div>Image</div>
                            <div class="mt-1 break-all text-sm text-highlighted">
                              {{ instanceStates[ch.id]?.image || getChallengeInstanceSpec(ch.container_spec)?.runtimeImage || '-' }}
                            </div>
                          </div>
                          <div class="rounded-md border border-default px-3 py-2">
                            <div>到期时间</div>
                            <div class="mt-1 text-sm text-highlighted">
                              {{ formatDateTime(instanceStates[ch.id]?.expires_at) }}
                            </div>
                          </div>
                          <div class="rounded-md border border-default px-3 py-2">
                            <div>最近续期</div>
                            <div class="mt-1 text-sm text-highlighted">
                              {{ formatDateTime(instanceStates[ch.id]?.last_renewed_at || instanceStates[ch.id]?.started_at) }}
                            </div>
                          </div>
                          <div class="rounded-md border border-default px-3 py-2">
                            <div>队伍实例上限</div>
                            <div class="mt-1 text-sm text-highlighted">
                              {{ instanceStates[ch.id]?.policy?.team_active_limit || '-' }}
                            </div>
                          </div>
                        </div>

                        <div class="mt-3 flex flex-wrap gap-2">
                          <UButton
                            size="sm"
                            icon="i-lucide-play"
                            :loading="instanceStarting[ch.id]"
                            :disabled="instanceStarting[ch.id] || instanceLoading[ch.id] || instanceDestroying[ch.id] || !authState.user || (instanceStates[ch.id]?.status === 'running' && !instanceStates[ch.id]?.can_renew)"
                            @click="ensureChallengeInstance(ch.id)"
                          >
                            {{ getInstancePrimaryActionLabel(ch.id) }}
                          </UButton>
                          <UButton
                            v-if="instanceStates[ch.id]?.status === 'running'"
                            size="sm"
                            color="error"
                            variant="outline"
                            icon="i-lucide-trash-2"
                            :loading="instanceDestroying[ch.id]"
                            :disabled="instanceStarting[ch.id] || instanceLoading[ch.id]"
                            @click="confirmDestroyChallengeInstance(ch)"
                          >
                            销毁实例
                          </UButton>
                          <UButton
                            v-if="instanceStates[ch.id]?.launch_url"
                            size="sm"
                            variant="outline"
                            icon="i-lucide-external-link"
                            :to="instanceStates[ch.id]?.launch_url"
                            target="_blank"
                          >
                            打开当前实例
                          </UButton>
                          <UButton
                            size="sm"
                            variant="ghost"
                            icon="i-lucide-refresh-cw"
                            :loading="instanceLoading[ch.id]"
                            :disabled="instanceStarting[ch.id] || instanceDestroying[ch.id]"
                            @click="fetchChallengeInstance(ch.id)"
                          >
                            刷新状态
                          </UButton>
                        </div>
                      </div>
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
                  <UAlert
                    v-if="!canSubmitFlag"
                    :color="challengeSubmitMeta.color"
                    variant="subtle"
                    :title="challengeSubmitMeta.title"
                    :description="challengeSubmitMeta.description"
                  />
                  <div v-if="canSubmitFlag" class="flex gap-2">
                    <UInput
                      v-model="flagInputs[ch.id]"
                      :placeholder="getChallengeFlagFormat(ch)"
                      size="sm"
                      class="flex-1"
                      @keyup.enter="submitFlag(ch.id)"
                    />
                    <UButton
                      size="sm"
                      :loading="submitting === ch.id"
                      icon="i-lucide-send"
                      @click="submitFlag(ch.id)"
                    />
                  </div>
                  <UEmpty
                    v-else
                    icon="i-lucide-flag-off"
                    title="当前还不能提交 Flag"
                    :description="challengeSubmitMeta.description"
                    :actions="flagBlockedAction?.to
                      ? [{
                          label: flagBlockedAction.label,
                          icon: flagBlockedAction.icon,
                          to: flagBlockedAction.to,
                          color: 'neutral',
                          variant: 'outline',
                        }]
                      : []"
                  >
                    <template #footer>
                      <div v-if="flagBlockedAction && !flagBlockedAction.to" class="mt-4 flex justify-center">
                        <UButton
                          variant="outline"
                          :icon="flagBlockedAction.icon"
                          @click="activeTab = 'overview'"
                        >
                          {{ flagBlockedAction.label }}
                        </UButton>
                      </div>
                    </template>
                  </UEmpty>
                </div>
              </UPageCard>
            </div>
          </UPageCard>
        </div>
      </div>

      <!-- Scoreboard Tab -->
      <div v-else-if="activeTab === 'scoreboard'">
        <div class="space-y-6">
          <UPageGrid :cols="{ default: 1, sm: 2, xl: 4 }">
            <UPageCard
              v-for="card in scoreboardSummaryCards"
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

          <UPageCard title="队伍总榜" icon="i-lucide-trophy">
            <UAlert
              class="mb-4"
              :color="scoreboardFrozen ? 'warning' : 'info'"
              variant="soft"
              title="当前榜单视图"
              :description="scoreboardViewDescription"
            />
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
            <UEmpty
              v-if="scoreboard.length === 0"
              icon="i-lucide-trophy"
              title="当前还没有公开榜单数据"
              :description="selectedDivision
                ? `当前分组 ${selectedDivision} 还没有产生可公开展示的队伍或解题记录。`
                : '当前还没有产生可公开展示的队伍或解题记录；通常需要至少有队伍报名并开始解题后，公开榜单才会出现内容。'"
              :actions="[
                {
                  label: authState.user ? '查看比赛概览' : '登录账号',
                  icon: authState.user ? 'i-lucide-layout-template' : 'i-lucide-log-in',
                  to: authState.user ? undefined : loginEntry,
                  color: 'neutral',
                  variant: 'outline',
                },
              ]"
            >
              <template #footer>
                <div v-if="authState.user" class="mt-4 flex justify-center">
                  <UButton
                    variant="outline"
                    icon="i-lucide-layout-template"
                    @click="activeTab = 'overview'"
                  >
                    查看比赛概览
                  </UButton>
                </div>
              </template>
            </UEmpty>
            <UTable
              v-else
              :data="scoreboard"
              :columns="[
                { accessorKey: 'rank', header: '#' },
                { accessorKey: 'team_name', header: '队伍' },
                { accessorKey: 'score', header: '分数' },
                { accessorKey: 'solve_count', header: '解题数' },
                { accessorKey: 'last_solve', header: '最后解题' },
              ]"
            >
              <template #rank-cell="{ row }">
                <span :class="row?.original?.rank && row.original.rank <= 3 ? 'font-bold text-warning' : ''">
                  {{ row?.original?.rank ?? '-' }}
                </span>
              </template>
              <template #last_solve-cell="{ row }">
                {{ row?.original?.last_solve ? new Date(row.original.last_solve).toLocaleString() : '-' }}
              </template>
            </UTable>
          </UPageCard>

          <UPageCard title="分题统计" icon="i-lucide-chart-column-big">
            <UEmpty
              v-if="scoreboardChallenges.length === 0"
              icon="i-lucide-chart-column-big"
              title="当前还没有分题统计"
              :description="scoreboard.length
                ? '当前榜单里还没有产生可公开展示的题目统计，通常需要至少有队伍开始解题后才会出现。'
                : '当前榜单里还没有可公开展示的队伍或解题记录，所以分题统计也暂时不会出现。'"
            />
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
        <div class="space-y-6">
          <UPageGrid :cols="{ default: 1, sm: 2, xl: 4 }">
            <UPageCard
              v-for="card in writeupSummaryCards"
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

          <div class="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <UPageCard title="Writeup" icon="i-lucide-file-text">
              <div class="space-y-4">
                <UAlert
                  :color="writeupGuide.color"
                  variant="soft"
                  :title="writeupGuide.title"
                  :description="writeupGuide.description"
                />

                <UForm v-if="canEditWriteup" :state="writeupForm" class="space-y-4" @submit="submitWriteup">
                  <UFormField
                    label="Writeup 内容"
                    name="content"
                    :description="writeup?.can_submit ? '支持重复提交。' : writeupGuide.description"
                  >
                    <UTextarea v-model="writeupForm.content" class="w-full" :rows="14" placeholder="记录解题思路、复盘总结、关键截图或附件说明。" />
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

                <UEmpty
                  v-else
                  icon="i-lucide-file-lock-2"
                  title="当前还不能编辑 Writeup"
                  :description="writeupGuide.description"
                  :actions="writeupBlockedAction?.to
                    ? [{
                        label: writeupBlockedAction.label,
                        icon: writeupBlockedAction.icon,
                        to: writeupBlockedAction.to,
                        color: 'neutral',
                        variant: 'outline',
                      }]
                    : []"
                >
                  <template #footer>
                    <div v-if="writeupBlockedAction && !writeupBlockedAction.to" class="mt-4 flex justify-center">
                      <UButton
                        variant="outline"
                        :icon="writeupBlockedAction.icon"
                        @click="activeTab = 'overview'"
                      >
                        {{ writeupBlockedAction.label }}
                      </UButton>
                    </div>
                  </template>
                </UEmpty>
              </div>
            </UPageCard>

            <div class="space-y-6">
              <UPageCard title="审核状态" icon="i-lucide-file-check">
                <div class="space-y-3 text-sm">
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-muted">当前状态</span>
                    <UBadge :color="writeupStatusColor" variant="soft">
                      {{ writeupStatusLabel }}
                    </UBadge>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-muted">提交时间</span>
                    <span class="text-right">{{ writeup?.submitted_at ? new Date(writeup.submitted_at).toLocaleString() : '未提交' }}</span>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-muted">审核时间</span>
                    <span class="text-right">{{ writeup?.reviewed_at ? new Date(writeup.reviewed_at).toLocaleString() : '未审核' }}</span>
                  </div>
                  <div class="rounded-lg border border-default px-3 py-3">
                    <div class="text-muted">审核备注</div>
                    <UEmpty
                      v-if="!writeup?.review_remark"
                      class="mt-2"
                      icon="i-lucide-message-square-text"
                      title="当前还没有审核备注"
                      description="管理员当前还没有留下备注。审核状态变化后，这里会显示对应内容。"
                      variant="naked"
                    />
                    <div v-else class="mt-2 leading-6">
                      {{ writeup.review_remark }}
                    </div>
                  </div>
                </div>
              </UPageCard>

              <UPageCard title="提交要求" icon="i-lucide-list-checks">
                <div class="space-y-3 text-sm text-muted">
                  <p
                    v-for="(item, index) in writeupRuleItems"
                    :key="`${index}-${item}`"
                    class="leading-6"
                  >
                    {{ index + 1 }}. {{ item }}
                  </p>
                </div>
              </UPageCard>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <UEmpty
        icon="i-lucide-shield-alert"
        title="当前比赛暂时不可用"
        :description="pageLoadError || '当前比赛不存在，或你现在还不能访问这场比赛。'"
        :actions="[
          {
            label: '返回比赛列表',
            icon: 'i-lucide-arrow-left',
            to: '/games',
            color: 'neutral',
            variant: 'outline',
          },
        ]"
      >
        <template #footer>
          <div class="mt-4 flex flex-wrap justify-center gap-2">
            <UButton
              icon="i-lucide-refresh-cw"
              variant="outline"
              @click="fetchAll"
            >
              重新加载
            </UButton>
            <UButton
              v-if="!authState.user"
              :to="loginEntry"
              icon="i-lucide-log-in"
            >
              登录账号
            </UButton>
          </div>
        </template>
      </UEmpty>
    </template>

    <UModal
      v-model:open="confirmModalOpen"
      :title="confirmAction.title"
      :description="confirmAction.description"
      :dismissible="!confirmActionLoading"
      :ui="{ description: 'whitespace-pre-wrap', footer: 'justify-end' }"
    >
      <template #footer>
        <UButton
          color="neutral"
          variant="outline"
          :disabled="confirmActionLoading"
          @click="confirmModalOpen = false; resetConfirmAction()"
        >
          取消
        </UButton>
        <UButton
          :color="confirmAction.color"
          :loading="confirmActionLoading"
          @click="executeConfirmAction"
        >
          {{ confirmAction.confirmLabel }}
        </UButton>
      </template>
    </UModal>
  </UContainer>
</template>
