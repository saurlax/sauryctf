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
const currentGameRedirect = computed(() => {
  const target = route.fullPath || `/games/${gameId}`
  return encodeURIComponent(target)
})
const loginEntry = computed(() => `/login?redirect=${currentGameRedirect.value}`)
const registerEntry = computed(() => `/register?redirect=${currentGameRedirect.value}`)
const teamEntry = computed(() => `/console/team?redirect=${currentGameRedirect.value}`)

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
      body: { team_id: teamId },
    })
    toast.add({
      title: game.value?.registration_mode === 'auto_accept' ? '报名成功' : '报名申请已提交',
      description: game.value?.registration_mode === 'auto_accept'
        ? '当前比赛已自动通过报名，队伍现在可以按比赛状态直接参赛。'
        : '等待管理员审核通过后即可正式参赛。',
      color: 'success',
    })
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

function parseContainerSpec(raw?: string) {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as {
        connection?: {
          url?: string
          host?: string
          port?: string | number
          command?: string
          note?: string
        }
        links?: Array<{
          label?: string
          url?: string
        }>
      }
    }
  }
  catch {
    // Keep compatibility with older free-form text specs.
  }

  return {
    connection: {
      note: raw,
    },
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
  && (gameStatusMeta.value.label === '进行中' || (gameStatusMeta.value.label === '已结束' && !!game.value?.practice_mode)),
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

const challengeSubmitMeta = computed(() => {
  if (canSubmitFlag.value) {
    return {
      title: gameStatusMeta.value.label === '已结束' ? '当前可以继续练习提交' : '当前可以提交 Flag',
      description: gameStatusMeta.value.label === '已结束'
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

const nextStepMeta = computed(() => {
  if (!authState.user) {
    return {
      title: '下一步：先登录账号',
      description: '登录后就能看到你自己的队伍状态，并决定是先组队还是直接进入比赛详情继续操作。',
      color: 'info' as const,
      actionLabel: '去登录',
      actionTo: loginEntry.value,
      secondaryLabel: '创建账号',
      secondaryTo: registerEntry.value,
    }
  }

  if (!participation.value?.has_team) {
    return {
      title: '下一步：先准备队伍',
      description: '当前比赛以内队形式参赛。先去控制台创建或加入队伍，再回来完成报名。',
      color: 'warning' as const,
      actionLabel: '去队伍页',
      actionTo: teamEntry.value,
    }
  }

  if (!participation.value?.participated) {
    return {
      title: '下一步：完成报名',
      description: game.value?.registration_mode === 'auto_accept'
        ? '当前比赛会自动通过报名。确认后，如果比赛已开始，你的队伍就可以直接提交 Flag。'
        : '当前比赛需要先提交报名申请。提交后等待管理员审核通过，才能正式参赛。',
      color: 'info' as const,
      actionLabel: '报名比赛',
      actionTo: `/games/${gameId}`,
    }
  }

  if (participation.value.missing_writeup) {
    return {
      title: '下一步：补交 Writeup',
      description: participation.value.writeup_deadline
        ? `当前队伍还没有提交 Writeup，请在 ${new Date(participation.value.writeup_deadline).toLocaleString()} 前切换到 Writeup 标签补交。`
        : '当前队伍还没有提交 Writeup，请切换到 Writeup 标签尽快补交。',
      color: 'warning' as const,
      actionLabel: '去 Writeup',
      actionTo: `/games/${gameId}`,
      actionTab: 'writeup' as const,
    }
  }

  if (participation.value.status === 'pending') {
    return {
      title: '下一步：等待审核',
      description: '你的队伍报名已经提交成功。现在无需重复操作，等待管理员审核通过后就能正式参赛。',
      color: 'warning' as const,
      actionLabel: '查看队伍',
      actionTo: teamEntry.value,
    }
  }

  if (participation.value.status === 'rejected') {
    return {
      title: '下一步：撤回后重新报名',
      description: '当前报名没有通过。你可以先退出这次报名，调整队伍后再重新提交申请。',
      color: 'error' as const,
      actionLabel: '退出本次报名',
      actionTo: `/games/${gameId}`,
    }
  }

  if (participation.value.writeup_required && participation.value.writeup_submitted && participation.value.writeup_status === 'submitted') {
    return {
      title: '下一步：等待 Writeup 审核',
      description: 'Writeup 已经提交成功。你可以继续留在比赛页参赛，或返回 Writeup 标签补充更新内容。',
      color: 'info' as const,
      actionLabel: '去 Writeup',
      actionTo: `/games/${gameId}`,
      actionTab: 'writeup' as const,
    }
  }

  if (gameStatusMeta.value.label === '未开始') {
    return {
      title: '下一步：等待开赛',
      description: '你的队伍已经具备参赛资格。比赛开始后，题面会自动开放，随后就可以提交 Flag。',
      color: 'info' as const,
      actionLabel: '查看题目',
      actionTo: `/games/${gameId}`,
      actionTab: 'challenges' as const,
    }
  }

  if (gameStatusMeta.value.label === '进行中') {
    return {
      title: '下一步：开始解题',
      description: '当前已经满足参赛条件，可以直接切换到题目标签开始查看题面、附件并提交 Flag。',
      color: 'success' as const,
      actionLabel: '进入题目',
      actionTo: `/games/${gameId}`,
      actionTab: 'challenges' as const,
    }
  }

  return {
    title: '下一步：查看复盘信息',
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
      title: '需要先加入队伍',
      description: '当前比赛以内队形式参赛。先准备队伍，再回来查看或提交 Writeup。',
      color: 'warning' as const,
    }
  }

  if (!game.value?.writeup_required) {
    return {
      title: '当前比赛不强制要求 Writeup',
      description: '你仍然可以在这里沉淀复盘内容，但它不会作为本场比赛的强制参赛条件。',
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

  if (game.value?.writeup_deadline && Date.now() > new Date(game.value.writeup_deadline).getTime()) {
    return {
      title: 'Writeup 截止时间已过',
      description: `当前比赛的 Writeup 截止时间是 ${new Date(game.value.writeup_deadline).toLocaleString()}，现在已经不能继续更新内容。`,
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

const contestFactRows = computed(() => [
  {
    label: '报名方式',
    value: game.value?.registration_mode === 'auto_accept' ? '自动通过' : '人工审核',
  },
  {
    label: '队伍人数限制',
    value: game.value?.max_team_members ? `${game.value.max_team_members} 人` : '不限',
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
  {
    label: '当前可提交 Flag',
    value: canSubmitFlag.value ? '是' : '否',
  },
])

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
    label: '1. 登录账号',
    value: authState.user ? '已完成' : '待完成',
    hint: authState.user ? `当前账号：${authState.user.username}` : '登录后才能看到你的队伍状态并提交报名',
    icon: authState.user ? 'i-lucide-check-circle-2' : 'i-lucide-log-in',
    color: authState.user ? 'success' as const : 'neutral' as const,
  },
  {
    label: '2. 准备队伍',
    value: participation.value?.has_team ? '已完成' : '待完成',
    hint: participation.value?.team?.name ? `当前队伍：${participation.value.team.name}` : '比赛以内队形式参赛，请先创建或加入队伍',
    icon: participation.value?.has_team ? 'i-lucide-users-round' : 'i-lucide-users',
    color: participation.value?.has_team ? 'success' as const : 'warning' as const,
  },
  {
    label: '3. 完成报名',
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
    label: '4. 开始解题',
    value: canSubmitFlag.value ? '当前可提交' : '暂未开放',
    hint: canSubmitFlag.value
      ? (gameStatusMeta.value.label === '已结束' ? '当前为赛后练习提交，不计入正式榜单' : '可以直接切换到题目标签提交 Flag')
      : submitHint.value,
    icon: canSubmitFlag.value ? 'i-lucide-flag' : 'i-lucide-lock',
    color: canSubmitFlag.value ? 'success' as const : 'neutral' as const,
  },
])

const contestGuideItems = computed(() => [
  '先在控制台创建或加入队伍，再完成比赛报名。',
  game.value?.registration_mode === 'auto_accept'
    ? '当前比赛报名后会自动通过。'
    : '当前比赛报名后需要等待管理员审核。',
  game.value?.max_team_members
    ? `当前队伍人数上限为 ${game.value.max_team_members} 人，超出将无法报名。`
    : '当前比赛不限制队伍人数。',
  game.value?.scoreboard_freeze_at
    ? `公开榜单将于 ${new Date(game.value.scoreboard_freeze_at).toLocaleString()} 封榜。`
    : '当前比赛不启用封榜。',
  game.value?.practice_mode
    ? '比赛结束后会继续保留练习模式，便于复盘和补题。'
    : '当前比赛为纯正赛模式，结束后不会继续开放练习。',
  game.value?.writeup_required
    ? (game.value?.writeup_deadline
        ? `当前比赛要求提交 Writeup，截止时间为 ${new Date(game.value.writeup_deadline).toLocaleString()}。`
        : '当前比赛要求提交 Writeup，具体截止时间请留意公告。')
    : '当前比赛不强制要求提交 Writeup。',
  divisionRuleDescription.value,
  '待审核或已拒绝的报名可以撤回；已通过报名后队伍将锁定，不能再撤回。',
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
    hint: game.value?.writeup_required ? '当前比赛要求按这个时间前完成 Writeup 处理' : '当前比赛不强制要求 Writeup',
    icon: 'i-lucide-calendar-clock',
    color: game.value?.writeup_deadline ? 'info' as const : 'neutral' as const,
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
    : '当前比赛不强制要求 Writeup，但你仍可以在这里沉淀复盘内容。',
  game.value?.writeup_deadline
    ? `如果需要提交，截止时间为 ${new Date(game.value.writeup_deadline).toLocaleString()}。`
    : '当前没有单独设置 Writeup 截止时间。',
  writeup.value?.status === 'rejected'
    ? '当前 Writeup 已被驳回，修改后重新提交会回到 submitted 状态。'
    : '重复提交会覆盖当前内容，并重新进入 submitted 状态等待审核。',
  'Writeup 审核结果由管理员在管理端更新，审核备注会直接展示在本页。',
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
          <UPageCard title="比赛简介" icon="i-lucide-scroll-text">
            <div class="space-y-4 text-sm leading-7">
              <p class="text-default whitespace-pre-wrap">
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
                <p class="mb-3 font-medium">
                  参赛须知
                </p>
                <ul class="space-y-2 text-muted">
                  <li
                    v-for="(item, index) in contestGuideItems"
                    :key="`${index}-${item}`"
                  >
                    {{ index + 1 }}. {{ item }}
                  </li>
                </ul>
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

                <div class="rounded-lg border border-default px-3 py-3">
                  <div class="mb-2 flex items-center justify-between gap-3">
                    <span class="text-sm text-muted">{{ authState.user ? '当前报名状态' : '公开浏览状态' }}</span>
                    <UBadge :color="participationSummaryColor" variant="soft">
                      {{ participationSummaryLabel }}
                    </UBadge>
                  </div>
                  <p class="text-sm text-muted leading-6">
                    {{ participationHint.description }}
                  </p>
                  <p class="mt-2 text-sm text-muted leading-6">
                    {{ submitHint }}
                  </p>
                </div>

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

            <UPageCard title="参赛步骤" icon="i-lucide-route">
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

            <UPageCard title="比赛信息" icon="i-lucide-badge-check">
              <div class="space-y-3 text-sm">
                <div class="flex items-center justify-between gap-3">
                  <span class="text-muted">当前队伍</span>
                  <span>{{ participation?.team?.name || '未加入队伍' }}</span>
                </div>
                <div
                  v-for="row in contestFactRows"
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

                  <div
                    v-if="parseContainerSpec(ch.container_spec)"
                    class="rounded-lg border border-default bg-muted/40 px-3 py-3"
                  >
                    <div class="mb-2 flex items-center gap-2 text-sm font-medium">
                      <UIcon name="i-lucide-box" class="size-4 text-success" />
                      <span>实例接入信息</span>
                    </div>
                    <div class="space-y-2 text-muted">
                      <p v-if="parseContainerSpec(ch.container_spec)?.connection?.note" class="leading-6 whitespace-pre-wrap">
                        {{ parseContainerSpec(ch.container_spec)?.connection?.note }}
                      </p>
                      <div v-if="parseContainerSpec(ch.container_spec)?.connection?.url" class="flex flex-col gap-2">
                        <UButton
                          :to="parseContainerSpec(ch.container_spec)?.connection?.url"
                          target="_blank"
                          variant="outline"
                          size="sm"
                          icon="i-lucide-external-link"
                          class="justify-start"
                        >
                          打开实例入口
                        </UButton>
                      </div>
                      <div v-if="parseContainerSpec(ch.container_spec)?.connection?.host || parseContainerSpec(ch.container_spec)?.connection?.port" class="text-sm">
                        {{ parseContainerSpec(ch.container_spec)?.connection?.host || 'host' }}<template v-if="parseContainerSpec(ch.container_spec)?.connection?.port">:{{ parseContainerSpec(ch.container_spec)?.connection?.port }}</template>
                      </div>
                      <div v-if="parseContainerSpec(ch.container_spec)?.connection?.command" class="rounded-md border border-default bg-default px-3 py-2 font-mono text-xs whitespace-pre-wrap">
                        {{ parseContainerSpec(ch.container_spec)?.connection?.command }}
                      </div>
                      <div v-if="parseContainerSpec(ch.container_spec)?.links?.length" class="flex flex-col gap-2">
                        <UButton
                          v-for="(link, linkIndex) in parseContainerSpec(ch.container_spec)?.links || []"
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
            <UAlert
              class="mb-4"
              color="info"
              variant="soft"
              title="分题统计说明"
              description="这里展示的是当前公开榜单口径下的题目分值、解出队伍数和前三血信息。赛后练习解题不会计入这些正式统计。"
            />
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
            <UPageCard title="Writeup 内容" icon="i-lucide-file-text">
              <div class="space-y-4">
                <UAlert
                  :color="writeupGuide.color"
                  variant="soft"
                  :title="writeupGuide.title"
                  :description="writeupGuide.description"
                />

                <UForm :state="writeupForm" class="space-y-4" @submit="submitWriteup">
                  <UFormField
                    label="Writeup 内容"
                    name="content"
                    :description="writeup?.can_submit
                      ? '支持重复提交，重新提交后会回到 submitted 状态。'
                      : writeupGuide.description"
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
              </div>
            </UPageCard>

            <div class="space-y-6">
              <UPageCard title="当前审核信息" icon="i-lucide-file-check">
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
                    <div class="mt-2 leading-6">
                      {{ writeup?.review_remark || '暂无审核备注' }}
                    </div>
                  </div>
                </div>
              </UPageCard>

              <UPageCard title="提交流程说明" icon="i-lucide-list-checks">
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

    <div v-else class="text-center py-16">
      <p class="text-muted">
        比赛不存在
      </p>
    </div>
  </UContainer>
</template>
