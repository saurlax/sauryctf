<script setup lang="ts">
definePageMeta({
  middleware: 'admin',
})

const { authState, ensureInitialized } = useAuth()
const router = useRouter()
const toast = useToast()

const isAdmin = computed(() => ['admin', 'super_admin'].includes(authState.user?.role || ''))

const gameForm = reactive({
  name: '',
  description: '',
  notice: '',
  invitation_code: '',
  divisions_text: '',
  start_time: '',
  end_time: '',
  scoreboard_freeze_at: '',
  registration_mode: 'review' as 'review' | 'auto_accept',
  max_team_members: 0,
  practice_mode: false,
  writeup_required: false,
  writeup_deadline: '',
  is_public: true,
})

const challengeForm = reactive({
  title: '',
  description: '',
  hints: '[]',
  attachments: '[]',
  container_spec: '',
  category: 'web',
  type: 'static',
  difficulty: 'easy',
  flag: '',
  base_score: 100,
  min_score: 10,
  decay_rate: 0.1,
  max_attempts: 0,
  is_visible: true,
})

const attachForm = reactive({
  game_id: undefined as number | undefined,
  challenge_id: undefined as number | undefined,
  score_override: undefined as number | undefined,
})

const gameSettingsForm = reactive({
  game_id: undefined as number | undefined,
  status: 'draft' as 'draft' | 'active' | 'ended',
  invitation_code: '',
  divisions_text: '',
  scoreboard_freeze_at: '',
  registration_mode: 'review' as 'review' | 'auto_accept',
  max_team_members: 0,
  practice_mode: false,
  writeup_required: false,
  writeup_deadline: '',
  is_public: true,
})

const gameEditForm = reactive({
  game_id: undefined as number | undefined,
  name: '',
  description: '',
  notice: '',
  invitation_code: '',
  divisions_text: '',
  start_time: '',
  end_time: '',
  practice_mode: false,
  writeup_required: false,
  writeup_deadline: '',
})

const challengeEditForm = reactive({
  challenge_id: undefined as number | undefined,
  title: '',
  description: '',
  hints: '[]',
  attachments: '[]',
  container_spec: '',
  category: 'web',
  type: 'static',
  difficulty: 'easy',
  base_score: 100,
  min_score: 10,
  decay_rate: 0.1,
  max_attempts: 0,
  is_visible: true,
})

const importForm = reactive({
  file: undefined as File | undefined,
})

const challengeAttachmentUploadForm = reactive({
  file: undefined as File | undefined,
})

const challengeEditAttachmentUploadForm = reactive({
  file: undefined as File | undefined,
})

const submissionFilters = reactive({
  type: 'all' as 'all' | 'accepted' | 'wrong_flag' | 'already_solved',
  count: 50,
})

const announcementForm = reactive({
  content: '',
})

const resourceFilters = reactive({
  gameKeyword: '',
  gameStatus: 'all' as 'all' | 'draft' | 'active' | 'ended',
  challengeKeyword: '',
  challengeCategory: 'all' as 'all' | 'web' | 'pwn' | 'crypto' | 'reverse' | 'misc' | 'forensics' | 'awd',
  challengeVisibility: 'all' as 'all' | 'visible' | 'hidden',
})

const gameSubmitting = ref(false)
const challengeSubmitting = ref(false)
const challengeAttachmentUploading = ref(false)
const attachSubmitting = ref(false)
const settingsSubmitting = ref(false)
const gameEditing = ref(false)
const challengeEditing = ref(false)
const challengeEditAttachmentUploading = ref(false)
const starterProvisioning = ref(false)
const dynamicProvisioning = ref(false)
const localDockerProvisioning = ref(false)
const loadingResources = ref(false)
const loadingGameChallenges = ref(false)
const loadingParticipants = ref(false)
const loadingInstances = ref(false)
const loadingSubmissions = ref(false)
const loadingCheatClues = ref(false)
const loadingAnnouncements = ref(false)
const loadingScoreboard = ref(false)
const announcementSubmitting = ref(false)
const updatingParticipantId = ref<number | null>(null)
const removingParticipantId = ref<number | null>(null)
const deletingAnnouncementId = ref<number | null>(null)
const deletingInstanceLeaseId = ref<number | null>(null)
const removingChallengeId = ref<number | null>(null)
const deletingGameId = ref<number | null>(null)
const exportingGameId = ref<number | null>(null)
const exportingScoreboardGameId = ref<number | null>(null)
const exportingWriteupsGameId = ref<number | null>(null)
const exportingSubmissionsGameId = ref<number | null>(null)
const importingGame = ref(false)
const deletingChallengeId = ref<number | null>(null)
const createGameModalOpen = ref(false)
const createChallengeModalOpen = ref(false)
const attachChallengeModalOpen = ref(false)
const announcementModalOpen = ref(false)
const gameEditModalOpen = ref(false)
const challengeEditModalOpen = ref(false)
const importModalOpen = ref(false)
const confirmModalOpen = ref(false)
const games = ref<Array<{
  id: number
  name: string
  description?: string
  notice?: string
  invitation_code?: string
  invitation_required?: boolean
  divisions?: string[]
  status: 'draft' | 'active' | 'ended'
  scoreboard_freeze_at?: string | null
  registration_mode?: 'review' | 'auto_accept'
  max_team_members?: number
  practice_mode?: boolean
  writeup_required?: boolean
  writeup_deadline?: string | null
  start_time: string
  end_time: string
  is_public?: boolean
}>>([])
const challenges = ref<Array<{
  id: number
  title: string
  description?: string
  hints?: string
  attachments?: string
  container_spec?: string
  category: 'web' | 'pwn' | 'crypto' | 'reverse' | 'misc' | 'forensics' | 'awd'
  type?: 'static' | 'dynamic'
  difficulty?: 'easy' | 'medium' | 'hard'
  base_score?: number
  min_score?: number
  decay_rate?: number
  max_attempts?: number
  is_visible?: boolean
}>>([])
const selectedGameChallenges = ref<Array<{
  id: number
  title: string
  category: 'web' | 'pwn' | 'crypto' | 'reverse' | 'misc' | 'forensics' | 'awd'
  type: 'static' | 'dynamic'
  difficulty?: string
  container_spec?: string
  score: number
  solve_count?: number
  blood_team?: string
  second_blood_team?: string
  third_blood_team?: string
}>>([])
const participants = ref<Array<{
  team_id: number
  team_name: string
  status: 'pending' | 'accepted' | 'rejected'
  division?: string
  joined_at: string
  score: number
  solve_count: number
}>>([])
const instanceLeases = ref<Array<{
  id: number
  game_id: number
  team_id: number
  team_name: string
  challenge_id: number
  challenge_title: string
  status: string
  provider?: string
  image?: string
  launch_url?: string
  host?: string
  port?: string
  started_at: string
  last_renewed_at: string
  expires_at: string
  stopped_at?: string | null
  seconds_left: number
  is_expired: boolean
}>>([])
const writeups = ref<Array<{
  game_id: number
  team_id: number
  team_name: string
  submitted_by: number
  content: string
  status: 'submitted' | 'approved' | 'rejected'
  review_remark?: string
  submitted_at: string
  reviewed_at?: string | null
}>>([])
const submissions = ref<Array<{
  id: number
  game_id: number
  challenge_id: number
  challenge_title: string
  category: 'web' | 'pwn' | 'crypto' | 'reverse' | 'misc' | 'forensics' | 'awd'
  user_id: number
  username: string
  team_id: number
  team_name: string
  result: 'accepted' | 'wrong_flag' | 'already_solved' | 'rejected'
  message: string
  is_correct: boolean
  is_practice: boolean
  score: number
  blood_type?: string
  submitted_at: string
}>>([])
const cheatClues = ref<Array<{
  submitted_flag: string
  challenge_id: number
  challenge_title: string
  first_seen_at: string
  last_seen_at: string
  team_count: number
  submission_count: number
  teams: string[]
}>>([])
const announcements = ref<Array<{
  id: number
  game_id: number
  content: string
  created_by: number
  created_at: string
}>>([])
const scoreboardEntries = ref<Array<{
  rank: number
  team_id: number
  team_name: string
  score: number
  solve_count: number
  last_solve?: string | null
}>>([])
const scoreboardChallenges = ref<Array<{
  id: number
  title: string
  category: string
  score: number
  solved_count: number
  blood_team?: string | null
  second_blood_team?: string | null
  third_blood_team?: string | null
}>>([])
const scoreboardFrozen = ref(false)
const scoreboardFreezeTime = ref<string | null>(null)
const selectedScoreboardDivision = ref('')
type AdminGameSummary = (typeof games.value)[number]
type ConfirmActionType =
  | 'destroy-instance'
  | 'delete-announcement'
  | 'remove-participant'
  | 'delete-challenge'
  | 'delete-game'

const confirmActionState = reactive<{
  type: ConfirmActionType | null
  id: number | null
  title: string
  description: string
  confirmLabel: string
}>({
  type: null,
  id: null,
  title: '',
  description: '',
  confirmLabel: '确认',
})

const confirmActionBusy = computed(() => {
  if (confirmActionState.type === 'destroy-instance') {
    return deletingInstanceLeaseId.value === confirmActionState.id
  }
  if (confirmActionState.type === 'delete-announcement') {
    return deletingAnnouncementId.value === confirmActionState.id
  }
  if (confirmActionState.type === 'remove-participant') {
    return removingParticipantId.value === confirmActionState.id
  }
  if (confirmActionState.type === 'delete-challenge') {
    return deletingChallengeId.value === confirmActionState.id
  }
  if (confirmActionState.type === 'delete-game') {
    return deletingGameId.value === confirmActionState.id
  }

  return false
})

const participantStatusDrafts = reactive<Record<number, 'pending' | 'accepted' | 'rejected'>>({})
const participantDivisionDrafts = reactive<Record<number, string>>({})
const writeupReviewDrafts = reactive<Record<number, 'approved' | 'rejected'>>({})
const writeupRemarkDrafts = reactive<Record<number, string>>({})

const categoryOptions = [
  { label: 'Web', value: 'web' },
  { label: 'Pwn', value: 'pwn' },
  { label: 'Crypto', value: 'crypto' },
  { label: 'Reverse', value: 'reverse' },
  { label: 'Misc', value: 'misc' },
  { label: 'Forensics', value: 'forensics' },
  { label: 'AWD', value: 'awd' },
]

const difficultyOptions = [
  { label: 'Easy', value: 'easy' },
  { label: 'Medium', value: 'medium' },
  { label: 'Hard', value: 'hard' },
]

const instanceTemplateTokens = [
  '{{game_id}}',
  '{{challenge_id}}',
  '{{team_id}}',
  '{{user_id}}',
  '{{team_hash}}',
]

const typeOptions = [
  { label: 'Static', value: 'static' },
  { label: 'Dynamic', value: 'dynamic' },
]

const gameStatusOptions = [
  { label: 'Draft', value: 'draft' },
  { label: 'Active', value: 'active' },
  { label: 'Ended', value: 'ended' },
]

const registrationModeOptions = [
  { label: '人工审核', value: 'review' },
  { label: '自动通过', value: 'auto_accept' },
]

const participantStatusOptions = [
  { label: '待审核', value: 'pending' },
  { label: '已通过', value: 'accepted' },
  { label: '已拒绝', value: 'rejected' },
]

const submissionTypeOptions = [
  { label: '全部结果', value: 'all' },
  { label: '只看正确', value: 'accepted' },
  { label: '只看错误 Flag', value: 'wrong_flag' },
  { label: '只看重复提交', value: 'already_solved' },
]

const resourceGameStatusOptions = [
  { label: '全部状态', value: 'all' },
  ...gameStatusOptions,
]

const resourceChallengeCategoryOptions = [
  { label: '全部分类', value: 'all' },
  ...categoryOptions,
]

const resourceChallengeVisibilityOptions = [
  { label: '全部可见性', value: 'all' },
  { label: '仅可见', value: 'visible' },
  { label: '仅隐藏', value: 'hidden' },
]

const gameOptions = computed(() => games.value.map(game => ({
  label: `#${game.id} ${game.name}`,
  value: game.id,
})))

const challengeOptions = computed(() => challenges.value.map(challenge => ({
  label: `#${challenge.id} ${challenge.title}`,
  value: challenge.id,
})))

const selectedGame = computed(() => games.value.find(game => game.id === attachForm.game_id) || null)
const selectedSettingsGame = computed(() => games.value.find(game => game.id === gameSettingsForm.game_id) || null)
const selectedEditableGame = computed(() => games.value.find(game => game.id === gameEditForm.game_id) || null)
const selectedEditableChallenge = computed(() => challenges.value.find(challenge => challenge.id === challengeEditForm.challenge_id) || null)
const challengeFormInstanceSpec = computed(() => parseChallengeInstanceSpec(challengeForm.container_spec))
const challengeEditInstanceSpec = computed(() => parseChallengeInstanceSpec(challengeEditForm.container_spec))
const challengeFormAccessMode = computed(() => describeChallengeAccessMode(challengeForm.container_spec))
const challengeEditAccessMode = computed(() => describeChallengeAccessMode(challengeEditForm.container_spec))
const selectedChallengeTemplatePurposes = computed(() =>
  new Set(
    selectedGameChallenges.value
      .map(challenge => parseChallengeTemplatePurpose(challenge.container_spec, challenge.title))
      .filter(Boolean),
  ),
)
const filteredGames = computed(() => {
  const keyword = resourceFilters.gameKeyword.trim().toLowerCase()

  return games.value.filter((game) => {
    if (resourceFilters.gameStatus !== 'all' && game.status !== resourceFilters.gameStatus) {
      return false
    }

    if (!keyword) {
      return true
    }

    return [
      String(game.id),
      game.name,
      game.description || '',
      game.notice || '',
    ].some(field => field.toLowerCase().includes(keyword))
  })
})

const filteredChallenges = computed(() => {
  const keyword = resourceFilters.challengeKeyword.trim().toLowerCase()

  return challenges.value.filter((challenge) => {
    if (resourceFilters.challengeCategory !== 'all' && challenge.category !== resourceFilters.challengeCategory) {
      return false
    }

    if (resourceFilters.challengeVisibility === 'visible' && !challenge.is_visible) {
      return false
    }

    if (resourceFilters.challengeVisibility === 'hidden' && challenge.is_visible) {
      return false
    }

    if (!keyword) {
      return true
    }

    return [
      String(challenge.id),
      challenge.title,
      challenge.description || '',
      challenge.hints || '',
      challenge.attachments || '',
      challenge.container_spec || '',
    ].some(field => field.toLowerCase().includes(keyword))
  })
})
const selectedGameDivisionOptions = computed(() => (selectedGame.value?.divisions || []).map(division => ({
  label: division,
  value: division,
})))
const preferredSetupGame = computed(() =>
  games.value.find(game => game.status === 'draft')
  || games.value.find(game => game.status === 'active')
  || games.value[0]
  || null,
)

const adminSetupContextMeta = computed(() => {
  const game = preferredSetupGame.value
  if (!game) {
    return null
  }

  const gameChallengeCount = attachForm.game_id === game.id
    ? selectedGameChallenges.value.length
    : undefined
  const shouldGuideToAttach = gameChallengeCount === undefined || gameChallengeCount === 0

  return {
    game,
    title: shouldGuideToAttach ? '当前比赛待补充挂题' : '当前比赛待检查设置',
    description: shouldGuideToAttach
      ? `${game.name} 已创建完成。建议先挂载至少一道题目，再检查比赛状态与公开页展示。`
      : `${game.name} 当前已挂载 ${gameChallengeCount} 道题，可以继续检查状态、公开性与报名模式。`,
    actionLabel: shouldGuideToAttach ? '选中并前往挂题' : '选中并前往比赛设置',
    actionTo: shouldGuideToAttach ? '#attach-challenge' : '#game-settings',
  }
})

const selectedAdminOverview = computed(() => {
  if (!selectedGame.value) {
    return null
  }

  const acceptedParticipants = participants.value.filter(item => item.status === 'accepted')
  const pendingParticipants = participants.value.filter(item => item.status === 'pending')
  const rejectedParticipants = participants.value.filter(item => item.status === 'rejected')

  return {
    game: selectedGame.value,
    mountedChallengeCount: selectedGameChallenges.value.length,
    participantCount: participants.value.length,
    acceptedParticipantCount: acceptedParticipants.length,
    pendingParticipantCount: pendingParticipants.length,
    rejectedParticipantCount: rejectedParticipants.length,
    writeupCount: writeups.value.length,
  }
})

const createGameRuleSummary = computed(() => [
  gameForm.registration_mode === 'auto_accept' ? '报名后自动通过' : '报名后进入人工审核',
  gameForm.invitation_code.trim() ? '需要输入邀请码' : '不启用邀请码门槛',
  gameForm.max_team_members > 0 ? `队伍人数上限 ${gameForm.max_team_members} 人` : '队伍人数不限',
  gameForm.divisions_text.trim() ? `已配置分组：${parseDivisionList(gameForm.divisions_text).join(' / ')}` : '不区分比赛分组',
  gameForm.practice_mode ? '比赛结束后保留练习模式' : '比赛结束后关闭练习提交',
  gameForm.writeup_required
    ? (gameForm.writeup_deadline ? `要求提交 Writeup，截止于 ${new Date(gameForm.writeup_deadline).toLocaleString()}` : '要求提交 Writeup，截止时间需另行确认')
    : '不要求 Writeup',
  gameForm.scoreboard_freeze_at ? `公开榜单将于 ${new Date(gameForm.scoreboard_freeze_at).toLocaleString()} 封榜` : '公开榜单不封榜',
])

const editGameRuleSummary = computed(() => {
  if (!selectedEditableGame.value) {
    return []
  }

  return [
    gameEditForm.invitation_code.trim() ? '编辑后将启用邀请码门槛' : '编辑后不启用邀请码门槛',
    gameEditForm.divisions_text.trim() ? `编辑后分组：${parseDivisionList(gameEditForm.divisions_text).join(' / ')}` : '编辑后不区分分组',
    gameEditForm.practice_mode ? '编辑后保留练习模式' : '编辑后关闭练习模式',
    gameEditForm.writeup_required
      ? (gameEditForm.writeup_deadline ? `编辑后要求 Writeup，截止于 ${new Date(gameEditForm.writeup_deadline).toLocaleString()}` : '编辑后要求 Writeup')
      : '编辑后不要求 Writeup',
  ]
})

const settingsRuleSummary = computed(() => {
  if (!selectedSettingsGame.value) {
    return []
  }

  return [
    gameSettingsForm.status === 'draft' ? '当前仍为草稿状态' : gameSettingsForm.status === 'active' ? '当前会按公开页规则对外开放' : '当前已结束，仅保留赛后查看/练习能力',
    gameSettingsForm.registration_mode === 'auto_accept' ? '报名后自动通过' : '报名后进入人工审核',
    gameSettingsForm.invitation_code.trim() ? '需要输入邀请码' : '不启用邀请码门槛',
    gameSettingsForm.max_team_members > 0 ? `队伍人数上限 ${gameSettingsForm.max_team_members} 人` : '队伍人数不限',
    gameSettingsForm.divisions_text.trim() ? `当前分组：${parseDivisionList(gameSettingsForm.divisions_text).join(' / ')}` : '不区分比赛分组',
    gameSettingsForm.practice_mode ? '比赛结束后保留练习模式' : '比赛结束后关闭练习提交',
    gameSettingsForm.writeup_required
      ? (gameSettingsForm.writeup_deadline ? `要求提交 Writeup，截止于 ${new Date(gameSettingsForm.writeup_deadline).toLocaleString()}` : '要求提交 Writeup')
      : '不要求 Writeup',
    gameSettingsForm.scoreboard_freeze_at ? `公开榜单将于 ${new Date(gameSettingsForm.scoreboard_freeze_at).toLocaleString()} 封榜` : '公开榜单不封榜',
  ]
})

function parseOptionalLocalDateTime(value: string) {
  if (!value.trim()) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date
}

function validateGameTimeline(input: {
  start_time?: string
  end_time?: string
  scoreboard_freeze_at?: string
  writeup_deadline?: string
  writeup_required?: boolean
}, options?: {
  requireStartEnd?: boolean
}) {
  const requireStartEnd = options?.requireStartEnd ?? false
  const startAt = parseOptionalLocalDateTime(input.start_time || '')
  const endAt = parseOptionalLocalDateTime(input.end_time || '')
  const freezeAt = parseOptionalLocalDateTime(input.scoreboard_freeze_at || '')
  const writeupDeadline = parseOptionalLocalDateTime(input.writeup_deadline || '')

  if (requireStartEnd && !startAt) {
    return '请填写有效的开始时间。'
  }

  if (requireStartEnd && !endAt) {
    return '请填写有效的结束时间。'
  }

  if (startAt && endAt && endAt.getTime() <= startAt.getTime()) {
    return '结束时间必须晚于开始时间。'
  }

  if (freezeAt) {
    if (startAt && freezeAt.getTime() < startAt.getTime()) {
      return '封榜时间不能早于开始时间。'
    }

    if (endAt && freezeAt.getTime() > endAt.getTime()) {
      return '封榜时间不能晚于结束时间。'
    }
  }

  if (writeupDeadline) {
    if (endAt && writeupDeadline.getTime() < endAt.getTime()) {
      return 'Writeup 截止时间不能早于比赛结束时间。'
    }
  }

  if (input.writeup_required && !writeupDeadline) {
    return '当前已要求 Writeup，请同时填写 Writeup 截止时间。'
  }

  return null
}

const activeMonitorTab = ref<'overview' | 'scoreboard' | 'submissions' | 'clues' | 'timeline' | 'ops'>('overview')

const monitorTabItems = [
  { label: '总览', value: 'overview', icon: 'i-lucide-layout-dashboard' },
  { label: '榜单', value: 'scoreboard', icon: 'i-lucide-trophy' },
  { label: '提交流', value: 'submissions', icon: 'i-lucide-activity' },
  { label: '线索', value: 'clues', icon: 'i-lucide-shield-alert' },
  { label: '时间线', value: 'timeline', icon: 'i-lucide-timeline' },
  { label: '运维', value: 'ops', icon: 'i-lucide-megaphone' },
]

const selectedMonitorStats = computed(() => {
  const overview = selectedAdminOverview.value
  if (!overview) {
    return []
  }

  const acceptedCount = submissions.value.filter(item => item.result === 'accepted').length
  const wrongCount = submissions.value.filter(item => item.result === 'wrong_flag').length
  const repeatedCount = submissions.value.filter(item => item.result === 'already_solved').length
  const runningInstanceCount = instanceLeases.value.filter(item => !item.is_expired).length
  const expiredInstanceCount = instanceLeases.value.filter(item => item.is_expired).length

  return [
    { label: '最近提交', value: String(submissions.value.length), icon: 'i-lucide-logs' },
    { label: '正确提交', value: String(acceptedCount), icon: 'i-lucide-circle-check-big' },
    { label: '错误 Flag', value: String(wrongCount), icon: 'i-lucide-circle-x' },
    { label: '重复提交', value: String(repeatedCount), icon: 'i-lucide-copy-check' },
    { label: '运行中实例', value: String(runningInstanceCount), icon: 'i-lucide-box' },
    { label: '已过期实例', value: String(expiredInstanceCount), icon: 'i-lucide-box-select' },
    { label: '可疑线索', value: String(cheatClues.value.length), icon: 'i-lucide-shield-alert' },
    { label: '比赛公告', value: String(announcements.value.length), icon: 'i-lucide-megaphone' },
  ]
})

const monitorFocusItems = computed(() => {
  const overview = selectedAdminOverview.value
  if (!overview) {
    return []
  }

  const items = []

  if (overview.pendingParticipantCount > 0) {
    items.push({
      key: 'participants',
      title: '还有报名待审核',
      description: `${overview.pendingParticipantCount} 支队伍仍在等待通过，处理后即可恢复完整参赛链路。`,
      badge: '报名',
      color: 'warning' as const,
      to: '#attach-challenge',
    })
  }

  if (writeups.value.some(item => item.status === 'submitted')) {
    items.push({
      key: 'writeups',
      title: '有 Writeup 等待审核',
      description: `${writeups.value.filter(item => item.status === 'submitted').length} 份 Writeup 仍未处理，可在这里继续完成赛后收尾。`,
      badge: 'Writeup',
      color: 'info' as const,
      to: '#attach-challenge',
    })
  }

  if (cheatClues.value.length > 0) {
    const firstClue = cheatClues.value[0]
    if (firstClue) {
      items.push({
        key: 'clues',
        title: '出现跨队重复错误 Flag',
        description: `${firstClue.challenge_title} 当前已有 ${firstClue.team_count} 支队伍重复提交同一错误 Flag，可继续排查线索传播。`,
        badge: '线索',
        color: 'error' as const,
        to: '#attach-challenge',
      })
    }
  }

  if (submissions.value.some(item => item.result === 'accepted')) {
    const latestAccepted = submissions.value.find(item => item.result === 'accepted')
    if (latestAccepted) {
      items.push({
        key: 'accepted',
        title: '已有队伍完成解题',
        description: `${latestAccepted.team_name} 刚刚在 ${latestAccepted.challenge_title} 上拿到一次正确提交，可继续观察榜单和题目状态。`,
        badge: '通过',
        color: 'success' as const,
        to: `/games/${overview.game.id}`,
      })
    }
  }

  if (announcements.value.length === 0) {
    items.push({
      key: 'announcement',
      title: '比赛还没有发布公告',
      description: '如果这场比赛已经对外开放，可以发布一条开赛或维护公告，方便参赛队伍同步状态。',
      badge: '公告',
      color: 'neutral' as const,
      to: '#attach-challenge',
    })
  }

  return items.slice(0, 4)
})

const selectedMonitorTimeline = computed(() => {
  const overview = selectedAdminOverview.value
  if (!overview) {
    return []
  }

  const acceptedSubmissionItems = submissions.value
    .filter(item => item.result === 'accepted')
    .map(item => ({
      key: `submission-${item.id}`,
      occurredAt: item.submitted_at,
      timestamp: new Date(item.submitted_at).getTime(),
      icon: 'i-lucide-circle-check-big',
      color: 'success' as const,
      badge: '正确提交',
      title: `${item.team_name} 解出 ${item.challenge_title}`,
      description: `${item.username} 在 ${item.category} 分类上提交正确 Flag${item.blood_type ? `，血量标记：${item.blood_type}` : ''}。`,
    }))

  const announcementItems = announcements.value.map(item => ({
    key: `announcement-${item.id}`,
    occurredAt: item.created_at,
    timestamp: new Date(item.created_at).getTime(),
    icon: 'i-lucide-megaphone',
    color: 'info' as const,
    badge: '公告',
    title: '管理员发布了一条比赛公告',
    description: item.content,
  }))

  const cheatClueItems = cheatClues.value.map(item => ({
    key: `clue-${item.challenge_id}-${item.submitted_flag}`,
    occurredAt: item.last_seen_at,
    timestamp: new Date(item.last_seen_at).getTime(),
    icon: 'i-lucide-shield-alert',
    color: 'warning' as const,
    badge: '可疑线索',
    title: `${item.challenge_title} 出现重复错误 Flag`,
    description: `${item.team_count} 支队伍共提交 ${item.submission_count} 次相同错误 Flag：${item.submitted_flag}`,
  }))

  return [
    ...acceptedSubmissionItems,
    ...announcementItems,
    ...cheatClueItems,
  ]
    .filter(item => Number.isFinite(item.timestamp))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 12)
})

const scoreboardDivisionOptions = computed(() => [
  { label: '全部队伍', value: '' },
  ...((selectedGame.value?.divisions || []).map(division => ({
    label: division,
    value: division,
  }))),
])

const scoreboardSummaryCards = computed(() => {
  const topTeam = scoreboardEntries.value[0]

  return [
    {
      label: '上榜队伍',
      value: String(scoreboardEntries.value.length),
      hint: selectedScoreboardDivision.value ? `当前分组：${selectedScoreboardDivision.value}` : '当前查看总榜',
      icon: 'i-lucide-users',
    },
    {
      label: '榜首队伍',
      value: topTeam?.team_name || '暂无',
      hint: topTeam ? `${topTeam.score} 分 / ${topTeam.solve_count} 题` : '还没有正式解题',
      icon: 'i-lucide-crown',
    },
    {
      label: '已统计题目',
      value: String(scoreboardChallenges.value.length),
      hint: '当前公开榜单口径下的题目统计',
      icon: 'i-lucide-chart-column-big',
    },
    {
      label: '封榜状态',
      value: scoreboardFrozen.value ? '已封榜' : '未封榜',
      hint: scoreboardFrozen.value
        ? (scoreboardFreezeTime.value ? `冻结于 ${new Date(scoreboardFreezeTime.value).toLocaleString()}` : '公开榜单已冻结')
        : (selectedGame.value?.scoreboard_freeze_at ? `将于 ${new Date(selectedGame.value.scoreboard_freeze_at).toLocaleString()} 封榜` : '当前比赛不启用封榜'),
      icon: 'i-lucide-timer',
    },
  ]
})

const scoreboardViewDescription = computed(() => {
  if (scoreboardFrozen.value && scoreboardFreezeTime.value) {
    return `当前看到的是冻结在 ${new Date(scoreboardFreezeTime.value).toLocaleString()} 的公开榜单视图。封榜后的新解题不会继续显示在公开排名中。`
  }

  if (selectedScoreboardDivision.value) {
    return `当前只查看 ${selectedScoreboardDivision.value} 分组的公开榜单。`
  }

  return '当前显示这场比赛的公开总榜视图，可直接用于赛时观察排名变化。'
})

const scoreboardCategoryGroups = computed(() => {
  const groups = new Map<string, typeof scoreboardChallenges.value>()

  for (const challenge of scoreboardChallenges.value) {
    const category = challenge.category || 'unknown'
    const current = groups.get(category) || []
    current.push(challenge)
    groups.set(category, current)
  }

  return Array.from(groups.entries()).map(([category, items]) => ({
    category,
    items,
  }))
})

const selectedGamePreflightChecks = computed(() => {
  const overview = selectedAdminOverview.value
  if (!overview) {
    return []
  }

  return [
    {
      key: 'time',
      label: '比赛时间已配置',
      done: Boolean(overview.game.start_time && overview.game.end_time),
      description: `${new Date(overview.game.start_time).toLocaleString()} - ${new Date(overview.game.end_time).toLocaleString()}`,
      actionLabel: '编辑比赛',
      actionTo: '#edit-game',
    },
    {
      key: 'status',
      label: '当前状态可识别',
      done: ['draft', 'active', 'ended'].includes(overview.game.status),
      description: overview.game.status === 'draft'
        ? '当前仍处于 draft，可继续补题和核对配置。'
        : overview.game.status === 'active'
          ? '当前已经开赛，公开页应同步开放报名与题目可见性。'
          : '当前已结束，可继续复核榜单、Writeup 和赛后练习状态。',
      actionLabel: overview.game.status === 'active' ? '打开公开页' : '去比赛设置',
      actionTo: overview.game.status === 'active' ? `/games/${overview.game.id}` : '#game-settings',
    },
    {
      key: 'challenge',
      label: '比赛已经挂题',
      done: overview.mountedChallengeCount > 0,
      description: overview.mountedChallengeCount > 0
        ? `当前已挂载 ${overview.mountedChallengeCount} 道题目。`
        : '至少先挂载 1 道题目，否则公开比赛页不会有可做题目。',
      actionLabel: '去挂题',
      actionTo: '#attach-challenge',
    },
    {
      key: 'visibility',
      label: '公开性已明确',
      done: true,
      description: overview.game.is_public
        ? '当前是公开比赛，普通用户可在公开比赛列表里看到它。'
        : '当前是私有比赛，只能通过管理路径继续核对。',
      actionLabel: '去比赛设置',
      actionTo: '#game-settings',
    },
    {
      key: 'registration',
      label: '报名规则已明确',
      done: true,
      description: `${getRegistrationModeLabel(overview.game.registration_mode)} · ${overview.game.max_team_members ? `队伍人数上限 ${overview.game.max_team_members} 人` : '队伍人数不限'}`,
      actionLabel: '去比赛设置',
      actionTo: '#game-settings',
    },
    {
      key: 'participant',
      label: '参赛队伍状态可检查',
      done: overview.participantCount > 0,
      description: overview.participantCount > 0
        ? `当前 ${overview.participantCount} 支队伍，其中 ${overview.acceptedParticipantCount} 支已通过、${overview.pendingParticipantCount} 支待审核、${overview.rejectedParticipantCount} 支已拒绝。`
        : '当前还没有报名队伍，可先使用普通用户完成一轮报名与参赛流程。',
      actionLabel: overview.participantCount > 0 ? '查看报名队伍' : '打开公开页',
      actionTo: overview.participantCount > 0 ? '#attach-challenge' : `/games/${overview.game.id}`,
    },
  ]
})

const localDockerInstanceChecklist = computed(() => {
  const overview = selectedAdminOverview.value
  if (!overview) {
    return []
  }

  const hasLocalDockerTemplate = selectedChallengeTemplatePurposes.value.has('local-docker-web')

  if (!hasLocalDockerTemplate) {
    return []
  }

  const runningLeaseCount = instanceLeases.value.filter(lease =>
    matchesLocalDockerLease(lease)
      && !lease.is_expired,
  ).length

  return [
    {
      key: 'player-join',
      label: '1. 先用普通用户报名比赛',
      done: overview.acceptedParticipantCount > 0,
      description: overview.acceptedParticipantCount > 0
        ? `当前已有 ${overview.acceptedParticipantCount} 支队伍通过报名，可以继续检查实例启动与访问状态。`
        : '先去公开比赛页用普通用户创建或加入队伍，并完成报名，让这场比赛真正进入选手视角。',
      actionLabel: '打开公开页',
      actionTo: `/games/${overview.game.id}`,
    },
    {
      key: 'instance-start',
      label: '2. 在题目卡片里启动容器实例',
      done: runningLeaseCount > 0,
      description: runningLeaseCount > 0
        ? `当前已有 ${runningLeaseCount} 条动态 Web 实例正在运行，说明实例至少已经成功启动一次。`
        : '报名后到公开比赛页点击启动实例。成功时应拿到真实 host / port / launch_url，而不是手写固定入口。',
      actionLabel: '打开公开页',
      actionTo: `/games/${overview.game.id}`,
    },
    {
      key: 'ops-refresh',
      label: '3. 回到管理端看实例监控',
      done: runningLeaseCount > 0,
      description: runningLeaseCount > 0
        ? '现在可以在下方“赛事监控”里刷新实例租约，确认 provider、host:port 和入口回填都已经出现。'
        : '实例启动后回到管理端刷新“赛事监控”，确认 provider、host:port 和入口回填是否可见。',
      actionLabel: '查看赛事监控',
      actionTo: '#monitoring',
    },
    {
      key: 'destroy-check',
      label: '4. 最后检查销毁回收',
      done: false,
      description: '可以在公开页销毁实例，或在管理端手动销毁租约，然后确认状态回到 idle，避免本地容器残留。',
      actionLabel: '查看赛事监控',
      actionTo: '#monitoring',
    },
  ]
})

const adminSetupSteps = computed(() => {
  const hasGames = games.value.length > 0
  const hasChallenges = challenges.value.length > 0
  const hasMountedChallenges = selectedGameChallenges.value.length > 0
  const activeGame = games.value.find(game => game.status === 'active') || null

  return [
    {
      key: 'game',
      title: '1. 创建比赛',
      description: hasGames
        ? `当前已经有 ${games.value.length} 场比赛，可以继续补充配置或直接复用。`
        : '先填写比赛名称、时间和报名模式，创建一场最小可用的比赛。默认先保持 draft 更安全。',
      done: hasGames,
      actionLabel: '创建比赛',
      actionTo: '#create-game',
      contextGameId: undefined,
    },
    {
      key: 'challenge',
      title: '2. 创建题目',
      description: hasChallenges
        ? `当前题库已有 ${challenges.value.length} 道题目，可以直接挂到比赛里。`
        : '题目至少需要标题、Flag 和基础分类，后续再逐步补题面、提示和附件即可。',
      done: hasChallenges,
      actionLabel: '创建题目',
      actionTo: '#create-challenge',
      contextGameId: undefined,
    },
    {
      key: 'attach',
      title: '3. 挂载题目',
      description: hasMountedChallenges
        ? `当前选中的比赛已经挂载了 ${selectedGameChallenges.value.length} 道题目，可以继续补挂或直接准备开赛。`
        : hasGames && hasChallenges
          ? '选中一场比赛和一道题目后，使用挂题表单把题目真正放进比赛。'
          : '先有比赛和题目后，才能进入这一步。',
      done: hasMountedChallenges,
      actionLabel: '去挂题',
      actionTo: '#attach-challenge',
      contextGameId: preferredSetupGame.value?.id,
    },
    {
      key: 'launch',
      title: '4. 发布前检查',
      description: activeGame
        ? `当前已有进行中的比赛：${activeGame.name}。现在可以去公开页检查报名、题目显示和排行榜。`
        : '确认比赛时间、公开性和挂题都无误后，再把状态从 draft 切到 active。',
      done: Boolean(activeGame),
      actionLabel: activeGame ? '打开公开页' : '去比赛设置',
      actionTo: activeGame ? `/games/${activeGame.id}` : '#game-settings',
      contextGameId: (activeGame || preferredSetupGame.value)?.id,
    },
  ]
})

function getBloodRows(challenge: {
  blood_team?: string
  second_blood_team?: string
  third_blood_team?: string
}) {
  return [
    { label: '一血', team: challenge.blood_team },
    { label: '二血', team: challenge.second_blood_team },
    { label: '三血', team: challenge.third_blood_team },
  ]
}

function parseDivisionList(raw: string) {
  return Array.from(new Set(
    raw
      .split(/[\n,]/)
      .map(item => item.trim())
      .filter(Boolean),
  ))
}

function formatDivisionList(divisions?: string[]) {
  return (divisions || []).join('\n')
}

function validateChallengeDraft(payload: {
  title: string
  type: string
  container_spec?: string
}) {
  if (!payload.title.trim()) {
    return '题目名称不能为空。'
  }

  if (payload.type !== 'dynamic') {
    return ''
  }

  const raw = payload.container_spec?.trim() || ''
  if (!raw) {
    return '动态题需要填写实例接入信息（container_spec）。'
  }

  let parsed: any
  try {
    parsed = JSON.parse(raw)
  }
  catch {
    return '实例接入信息必须是有效的 JSON。'
  }

  const runtime = parsed?.runtime || {}
  const connection = parsed?.connection || {}
  const provider = typeof runtime.provider === 'string' ? runtime.provider.trim() : ''
  const image = typeof runtime.image === 'string' ? runtime.image.trim() : ''
  const expose = Array.isArray(runtime.expose)
    ? runtime.expose.map((item: unknown) => String(item).trim()).filter(Boolean)
    : []
  const launchURL = typeof connection.url === 'string' ? connection.url.trim() : ''
  const host = typeof connection.host === 'string' ? connection.host.trim() : ''
  const note = typeof connection.note === 'string' ? connection.note.trim() : ''

  if (!provider) {
    return '动态题缺少 runtime.provider。'
  }

  if (!image) {
    return '动态题缺少 runtime.image。'
  }

  if (!expose.length) {
    return '动态题缺少 runtime.expose，至少应声明一个容器端口。'
  }

  if (image === 'ghcr.io/example/ctf-web:latest' || image === 'ctf/example:latest') {
    return '请先把模板镜像替换成真实可用的题目镜像。'
  }

  if (host.includes('example.internal') || host.includes('.instance.local')) {
    return '请先把模板主机地址替换成真实入口，或改成由平台回填的访问方式。'
  }

  if (!launchURL && !host && !note) {
    return '动态题至少应提供入口地址、主机信息或一段实例接入说明。'
  }

  return ''
}

function appendAttachmentUrl(raw: string, url: string) {
  let attachments: string[] = []

  try {
    const parsed = JSON.parse(raw || '[]')
    if (Array.isArray(parsed)) {
      attachments = parsed
        .map(item => typeof item === 'string' ? item.trim() : '')
        .filter(Boolean)
    }
  }
  catch {
    throw new Error('附件链接必须是有效的 JSON 数组。')
  }

  if (!attachments.includes(url)) {
    attachments.push(url)
  }

  return JSON.stringify(attachments, null, 2)
}

function describeChallengeAccessMode(containerSpec?: string) {
  const raw = containerSpec?.trim() || ''
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as {
      runtime?: {
        provider?: string
        image?: string
        expose?: Array<string | number>
      }
      connection?: {
        url?: string
        host?: string
        port?: string | number
        note?: string
      }
      metadata?: {
        purpose?: string
      }
    }

    const runtime = parsed.runtime || {}
    const connection = parsed.connection || {}
    const purpose = parsed.metadata?.purpose?.trim() || ''
    const url = typeof connection.url === 'string' ? connection.url.trim() : ''
    const host = typeof connection.host === 'string' ? connection.host.trim() : ''
    const expose = Array.isArray(runtime.expose)
      ? runtime.expose.map(item => String(item).trim()).filter(Boolean)
      : []

    if (purpose === 'local-docker-web') {
      return {
        title: '平台回填入口',
        description: '当前配置会在实例启动后由平台回填真实 launch_url 和 host:port，适合托管容器或本地 Docker 实例模式。',
        color: 'success' as const,
      }
    }

    if (url.includes('{{team_hash}}') || host.includes('{{team_hash}}') || host.includes('{{team_id}}')) {
      return {
        title: '每队独立入口',
        description: '当前配置会为不同队伍解析成不同入口，适合队伍级动态环境、独立代理或专属靶机场景。',
        color: 'info' as const,
      }
    }

    if (runtime.provider && runtime.image && expose.length) {
      return {
        title: '运行时驱动实例',
        description: '当前配置声明了 provider、镜像和暴露端口，平台会按实例策略启动、续期或销毁运行环境。',
        color: 'info' as const,
      }
    }

    if (url || host) {
      return {
        title: '固定接入入口',
        description: '当前配置更接近统一域名、固定靶机或已有代理地址，适合静态接入或平台外独立服务。',
        color: 'neutral' as const,
      }
    }

    return {
      title: '说明型接入',
      description: '当前配置主要用于沉淀实例说明，适合还未确定最终入口但需要先描述运行约束的场景。',
      color: 'warning' as const,
    }
  }
  catch {
    return {
      title: '实例配置无法解析',
      description: '当前 container_spec 不是有效 JSON，平台无法判断接入模式。',
      color: 'error' as const,
    }
  }
}

function parseChallengeTemplatePurpose(containerSpec?: string, fallbackTitle?: string) {
  if (containerSpec) {
    try {
      const parsed = JSON.parse(containerSpec) as {
        metadata?: {
          purpose?: string
        }
      }
      const purpose = parsed?.metadata?.purpose?.trim()
      if (purpose) {
        return purpose
      }
    }
    catch {
      // Ignore malformed template metadata and fall back to older title-based detection.
    }
  }

  const title = fallbackTitle?.trim()
  if (title === 'Web Dynamic Container' || title === '动态容器 Web 题') {
    return 'local-docker-web'
  }

  return ''
}

function matchesLocalDockerLease(lease: {
  challenge_title?: string
  image?: string
  provider?: string
}) {
  if (lease.provider === 'docker' && lease.image === 'nginx:alpine') {
    return true
  }

  return lease.challenge_title === 'Web Dynamic Container' || lease.challenge_title === '动态容器 Web 题'
}

async function loadAdminResources() {
  loadingResources.value = true
  try {
    const [gameList, challengeList] = await Promise.all([
      $api('get', '/api/games', {
        query: {
          all: true,
        },
      }),
      $api('get', '/api/challenges', {
        query: {
          show_hidden: true,
        },
      }),
    ])

    games.value = gameList
    challenges.value = challengeList
  }
  catch (e: any) {
    toast.add({ title: '管理数据加载失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    loadingResources.value = false
  }
}

async function loadSelectedGameChallenges() {
  if (!attachForm.game_id) {
    selectedGameChallenges.value = []
    return
  }

  loadingGameChallenges.value = true
  try {
    selectedGameChallenges.value = await $api('get', '/api/admin/games/{id}/challenges', {
      params: {
        id: attachForm.game_id,
      },
    })
  }
  catch (e: any) {
    selectedGameChallenges.value = []
    toast.add({ title: '比赛题目加载失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    loadingGameChallenges.value = false
  }
}

async function loadParticipants() {
  if (!attachForm.game_id) {
    participants.value = []
    return
  }

  loadingParticipants.value = true
  try {
    participants.value = await $api('get', '/api/games/{id}/participants', {
      params: {
        id: attachForm.game_id,
      },
    })
    for (const participant of participants.value) {
      participantStatusDrafts[participant.team_id] = participant.status
      participantDivisionDrafts[participant.team_id] = participant.division || ''
    }
  }
  catch (e: any) {
    participants.value = []
    toast.add({ title: '参赛队伍加载失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    loadingParticipants.value = false
  }
}

async function loadInstanceLeases() {
  if (!attachForm.game_id) {
    instanceLeases.value = []
    return
  }

  loadingInstances.value = true
  try {
    instanceLeases.value = await $api('get', '/api/admin/games/{id}/instances', {
      params: {
        id: attachForm.game_id,
      },
    })
  }
  catch (e: any) {
    instanceLeases.value = []
    toast.add({ title: '实例监控加载失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    loadingInstances.value = false
  }
}

async function destroyInstanceLease(leaseId: number) {
  if (!attachForm.game_id) {
    return
  }

  const lease = instanceLeases.value.find(item => item.id === leaseId)
  openConfirmAction({
    type: 'destroy-instance',
    id: leaseId,
    title: '确认销毁实例租约',
    description: `${lease?.team_name || '未知队伍'} · ${lease?.challenge_title || `#${leaseId}`}\n销毁后需要由队伍重新申请实例。`,
    confirmLabel: '销毁租约',
  })
}

async function runDestroyInstanceLease(leaseId: number) {
  const gameId = attachForm.game_id
  if (!gameId) {
    return
  }

  deletingInstanceLeaseId.value = leaseId
  try {
    await $api('delete', '/api/admin/games/{id}/instances/{leaseId}', {
      params: {
        id: gameId,
        leaseId,
      },
    })
    instanceLeases.value = instanceLeases.value.filter(item => item.id !== leaseId)
    toast.add({ title: '实例租约已销毁', color: 'success' })
  }
  catch (e: any) {
    toast.add({ title: '销毁实例租约失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    deletingInstanceLeaseId.value = null
  }
}

async function loadWriteups() {
  if (!attachForm.game_id) {
    writeups.value = []
    return
  }

  try {
    writeups.value = await $api('get', '/api/admin/games/{id}/writeups', {
      params: {
        id: attachForm.game_id,
      },
    })
    for (const writeup of writeups.value) {
      writeupReviewDrafts[writeup.team_id] = writeup.status === 'rejected' ? 'rejected' : 'approved'
      writeupRemarkDrafts[writeup.team_id] = writeup.review_remark || ''
    }
  }
  catch (e: any) {
    writeups.value = []
    toast.add({ title: 'Writeup 列表加载失败', description: e.data?.message || e.message, color: 'error' })
  }
}

async function loadSubmissions() {
  if (!attachForm.game_id) {
    submissions.value = []
    return
  }

  loadingSubmissions.value = true
  try {
    submissions.value = await $fetch(`/api/admin/games/${attachForm.game_id}/submissions`, {
      query: {
        type: submissionFilters.type,
        count: submissionFilters.count,
      },
    })
  }
  catch (e: any) {
    submissions.value = []
    toast.add({ title: '提交记录加载失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    loadingSubmissions.value = false
  }
}

async function loadCheatClues() {
  if (!attachForm.game_id) {
    cheatClues.value = []
    return
  }

  loadingCheatClues.value = true
  try {
    cheatClues.value = await $fetch(`/api/admin/games/${attachForm.game_id}/cheat-clues`, {
      query: {
        count: 20,
      },
    })
  }
  catch (e: any) {
    cheatClues.value = []
    toast.add({ title: '可疑线索加载失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    loadingCheatClues.value = false
  }
}

async function loadAnnouncements() {
  if (!attachForm.game_id) {
    announcements.value = []
    return
  }

  loadingAnnouncements.value = true
  try {
    announcements.value = await $fetch<typeof announcements.value>(`/api/admin/games/${attachForm.game_id}/announcements`)
  }
  catch (e: any) {
    announcements.value = []
    toast.add({ title: '比赛公告加载失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    loadingAnnouncements.value = false
  }
}

async function loadScoreboard() {
  if (!attachForm.game_id) {
    scoreboardEntries.value = []
    scoreboardChallenges.value = []
    scoreboardFrozen.value = false
    scoreboardFreezeTime.value = null
    return
  }

  loadingScoreboard.value = true
  try {
    const scoreboard = await $api('get', '/api/games/{id}/scoreboard', {
      params: {
        id: attachForm.game_id,
      },
      query: selectedScoreboardDivision.value ? { division: selectedScoreboardDivision.value } : {},
    })
    scoreboardEntries.value = scoreboard.entries || []
    scoreboardChallenges.value = scoreboard.challenges || []
    scoreboardFrozen.value = !!scoreboard.is_frozen
    scoreboardFreezeTime.value = scoreboard.freeze_time || null

    const validDivisions = selectedGame.value?.divisions || []
    if (selectedScoreboardDivision.value && !validDivisions.includes(selectedScoreboardDivision.value)) {
      selectedScoreboardDivision.value = ''
    }
  }
  catch (e: any) {
    scoreboardEntries.value = []
    scoreboardChallenges.value = []
    scoreboardFrozen.value = false
    scoreboardFreezeTime.value = null
    toast.add({ title: '排行榜加载失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    loadingScoreboard.value = false
  }
}

function resetSelectedGameContext() {
  selectedGameChallenges.value = []
  participants.value = []
  instanceLeases.value = []
  writeups.value = []
  submissions.value = []
  cheatClues.value = []
  announcements.value = []
  scoreboardEntries.value = []
  scoreboardChallenges.value = []
  scoreboardFrozen.value = false
  scoreboardFreezeTime.value = null
  selectedScoreboardDivision.value = ''
  announcementForm.content = ''

  for (const key of Object.keys(participantStatusDrafts)) {
    delete participantStatusDrafts[Number(key)]
  }
  for (const key of Object.keys(participantDivisionDrafts)) {
    delete participantDivisionDrafts[Number(key)]
  }
  for (const key of Object.keys(writeupReviewDrafts)) {
    delete writeupReviewDrafts[Number(key)]
  }
  for (const key of Object.keys(writeupRemarkDrafts)) {
    delete writeupRemarkDrafts[Number(key)]
  }
}

async function createAnnouncement() {
  if (!attachForm.game_id) {
    return
  }

  announcementSubmitting.value = true
  try {
    const created = await $fetch<(typeof announcements.value)[number]>(`/api/admin/games/${attachForm.game_id}/announcements`, {
      method: 'POST',
      body: {
        content: announcementForm.content,
      },
    })
    announcements.value = [created, ...announcements.value]
    announcementForm.content = ''
    announcementModalOpen.value = false
    toast.add({ title: '比赛公告已发布', color: 'success' })
  }
  catch (e: any) {
    toast.add({ title: '发布比赛公告失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    announcementSubmitting.value = false
  }
}

async function deleteAnnouncement(announcementId: number) {
  if (!attachForm.game_id) {
    return
  }

  const target = announcements.value.find(item => item.id === announcementId)
  openConfirmAction({
    type: 'delete-announcement',
    id: announcementId,
    title: '确认删除比赛公告',
    description: target?.content || '这条公告删除后将不再对参赛队伍可见。',
    confirmLabel: '删除公告',
  })
}

async function runDeleteAnnouncement(announcementId: number) {
  deletingAnnouncementId.value = announcementId
  try {
    await $fetch(`/api/admin/games/${attachForm.game_id}/announcements/${announcementId}`, {
      method: 'DELETE',
    })
    announcements.value = announcements.value.filter(item => item.id !== announcementId)
    toast.add({ title: '比赛公告已删除', color: 'success' })
  }
  catch (e: any) {
    toast.add({ title: '删除比赛公告失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    deletingAnnouncementId.value = null
  }
}

async function updateParticipantStatus(teamId: number) {
  if (!attachForm.game_id) {
    return
  }

  updatingParticipantId.value = teamId
  try {
    const status = participantStatusDrafts[teamId]
    if (!status) {
      toast.add({ title: '请先选择参赛状态', color: 'warning' })
      return
    }

    const updated = await $api('put', '/api/games/{id}/participants/{teamId}', {
      params: {
        id: attachForm.game_id,
        teamId,
      },
      body: {
        status,
        division: participantDivisionDrafts[teamId] || null,
      },
    })

    const index = participants.value.findIndex(item => item.team_id === teamId)
    if (index >= 0) {
      participants.value[index] = updated
    }
    participantStatusDrafts[teamId] = updated.status
    participantDivisionDrafts[teamId] = updated.division || ''
    toast.add({ title: '参赛状态已更新', color: 'success' })
  }
  catch (e: any) {
    toast.add({ title: '更新参赛状态失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    updatingParticipantId.value = null
  }
}

async function removeParticipant(teamId: number) {
  if (!attachForm.game_id) {
    return
  }

  const participant = participants.value.find(item => item.team_id === teamId)
  openConfirmAction({
    type: 'remove-participant',
    id: teamId,
    title: '确认移除参赛队伍',
    description: `队伍「${participant?.team_name || `#${teamId}`}」的当前比赛报名记录会被移除。`,
    confirmLabel: '移除报名',
  })
}

async function runRemoveParticipant(teamId: number) {
  const gameId = attachForm.game_id
  if (!gameId) {
    return
  }

  removingParticipantId.value = teamId
  try {
    await $api('delete', '/api/games/{id}/participants/{teamId}', {
      params: {
        id: gameId,
        teamId,
      },
    })
    participants.value = participants.value.filter(item => item.team_id !== teamId)
    delete participantStatusDrafts[teamId]
    delete participantDivisionDrafts[teamId]
    toast.add({ title: '参赛队伍已移除', color: 'success' })
  }
  catch (e: any) {
    toast.add({ title: '移除参赛队伍失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    removingParticipantId.value = null
  }
}

async function reviewWriteup(teamId: number) {
  if (!attachForm.game_id) {
    return
  }

  try {
    const status = writeupReviewDrafts[teamId]
    if (!status) {
      toast.add({ title: '请先选择审核结果', color: 'warning' })
      return
    }

    const updated = await $api('put', '/api/admin/games/{id}/writeups/{teamId}', {
      params: {
        id: attachForm.game_id,
        teamId,
      },
      body: {
        status,
        remark: writeupRemarkDrafts[teamId] || '',
      },
    })
    const index = writeups.value.findIndex(item => item.team_id === teamId)
    if (index >= 0) {
      writeups.value[index] = updated as typeof writeups.value[number]
    }
    toast.add({ title: 'Writeup 审核已更新', color: 'success' })
  }
  catch (e: any) {
    toast.add({ title: 'Writeup 审核失败', description: e.data?.message || e.message, color: 'error' })
  }
}

function getParticipantStatusColor(status: 'pending' | 'accepted' | 'rejected') {
  if (status === 'accepted') {
    return 'success' as const
  }
  if (status === 'pending') {
    return 'warning' as const
  }
  return 'error' as const
}

function getParticipantStatusLabel(status: 'pending' | 'accepted' | 'rejected') {
  if (status === 'accepted') {
    return '已通过'
  }
  if (status === 'pending') {
    return '待审核'
  }
  return '已拒绝'
}

function getRegistrationModeLabel(mode?: 'review' | 'auto_accept') {
  return mode === 'auto_accept' ? '自动通过' : '人工审核'
}

function getPracticeModeLabel(enabled?: boolean) {
  return enabled ? '赛后练习开启' : '仅正赛'
}

function getInstanceLeaseStatusColor(lease: { is_expired: boolean, status: string }) {
  if (lease.is_expired) {
    return 'warning' as const
  }
  if (lease.status === 'running') {
    return 'success' as const
  }
  return 'neutral' as const
}

function getInstanceLeaseStatusLabel(lease: { is_expired: boolean, status: string }) {
  if (lease.is_expired) {
    return '已过期'
  }
  if (lease.status === 'running') {
    return '运行中'
  }
  return lease.status || '未知'
}

function getInstanceLeaseProviderColor(lease: { provider?: string, launch_url?: string, host?: string, port?: string }) {
  if (lease.provider === 'docker' && lease.host === '127.0.0.1' && lease.port) {
    return 'success' as const
  }
  if (lease.provider === 'docker') {
    return 'info' as const
  }
  if (lease.provider) {
    return 'neutral' as const
  }
  return 'neutral' as const
}

function getInstanceLeaseProviderLabel(lease: { provider?: string, launch_url?: string, host?: string, port?: string }) {
  if (lease.provider === 'docker' && lease.host === '127.0.0.1' && lease.port) {
    return '本地 Docker'
  }
  if (lease.provider === 'docker') {
    return 'Docker'
  }
  if (lease.provider === 'k8s' || lease.provider === 'kubernetes') {
    return 'Kubernetes'
  }
  if (lease.provider === 'proxy' || lease.provider === 'platformproxy') {
    return '平台代理'
  }
  return lease.provider || '未标注'
}

function getInstanceLeaseEntryHint(lease: { launch_url?: string, host?: string, port?: string }) {
  if (lease.host && lease.port) {
    return `${lease.host}:${lease.port}`
  }
  if (lease.launch_url) {
    return lease.launch_url
  }
  return '当前没有可展示的实例入口'
}

async function copyInstanceLeaseEntry(lease: { launch_url?: string, host?: string, port?: string }) {
  const value = getInstanceLeaseEntryHint(lease)
  if (!value || value === '当前没有可展示的实例入口') {
    toast.add({ title: '没有可复制的实例入口', color: 'warning' })
    return
  }

  try {
    await navigator.clipboard.writeText(value)
    toast.add({ title: '实例入口已复制', description: value, color: 'success' })
  }
  catch (e: any) {
    toast.add({ title: '复制实例入口失败', description: e?.message || '当前浏览器不支持复制', color: 'error' })
  }
}

function getSubmissionResultColor(result: 'accepted' | 'wrong_flag' | 'already_solved' | 'rejected') {
  if (result === 'accepted') {
    return 'success' as const
  }
  if (result === 'already_solved') {
    return 'info' as const
  }
  if (result === 'rejected') {
    return 'warning' as const
  }
  return 'error' as const
}

function getSubmissionResultLabel(result: 'accepted' | 'wrong_flag' | 'already_solved' | 'rejected') {
  if (result === 'accepted') {
    return '正确'
  }
  if (result === 'already_solved') {
    return '重复提交'
  }
  if (result === 'rejected') {
    return '已拒绝'
  }
  return '错误 Flag'
}

function jumpToAdminAnchor(target: string) {
  if (!target.startsWith('#')) {
    return
  }

  const id = target.slice(1)
  const el = document.getElementById(id)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.location.hash = target
  }
}

function handleSetupAction(step: { actionTo: string, contextGameId?: number }) {
  if (step.contextGameId) {
    selectGameContext(step.contextGameId)
  }

  if (step.actionTo.startsWith('#')) {
    jumpToAdminAnchor(step.actionTo)
  }
}

function handlePreflightAction(check: { actionTo?: string }) {
  if (!check.actionTo) {
    return
  }

  if (check.actionTo.startsWith('#')) {
    jumpToAdminAnchor(check.actionTo)
  }
}

function fillStarterGameTemplate() {
  const now = new Date()
  const start = new Date(now.getTime() + 30 * 60 * 1000)
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
  const freeze = new Date(end.getTime() - 30 * 60 * 1000)
  const writeupDeadline = new Date(end.getTime() + 24 * 60 * 60 * 1000)

  gameForm.name = `${start.getFullYear()} 平台基础比赛`
  gameForm.description = '用于快速建立公开比赛基础结构的精简模板。'
  gameForm.notice = '建议在发布前补全题面、附件、规则补充与开放设置。'
  gameForm.divisions_text = ''
  gameForm.start_time = start.toISOString().slice(0, 16)
  gameForm.end_time = end.toISOString().slice(0, 16)
  gameForm.scoreboard_freeze_at = freeze.toISOString().slice(0, 16)
  gameForm.registration_mode = 'auto_accept'
  gameForm.max_team_members = 4
  gameForm.practice_mode = true
  gameForm.writeup_required = false
  gameForm.writeup_deadline = writeupDeadline.toISOString().slice(0, 16)
  gameForm.is_public = true

  toast.add({ title: '已填充比赛模板', description: '已写入一份公开比赛默认值。', color: 'success' })
}

function fillStarterChallengeTemplate() {
  challengeForm.title = '基础静态题'
  challengeForm.description = '这是一个基础静态题模板，用于补齐题面、提示、附件和计分配置。'
  challengeForm.hints = JSON.stringify([
    '请在发布前补充正式题面、提示和附件信息。',
    '保存前请确认 Flag、分值和可见性设置已经完成。',
  ])
  challengeForm.attachments = '[]'
  challengeForm.container_spec = JSON.stringify({
    connection: {
      url: '',
      note: '如需提供统一访问入口，请在这里填写题目实例、靶机或代理地址。',
    },
    links: [
      {
        label: '附件或入口说明',
        url: '',
      },
    ],
  }, null, 2)
  challengeForm.category = 'misc'
  challengeForm.type = 'static'
  challengeForm.difficulty = 'easy'
  challengeForm.flag = ''
  challengeForm.base_score = 100
  challengeForm.min_score = 100
  challengeForm.decay_rate = 0
  challengeForm.max_attempts = 0
  challengeForm.is_visible = true

  toast.add({ title: '已填充题目模板', description: '已写入一份基础题目默认配置。', color: 'success' })
}

function fillStaticWebTemplate() {
  challengeForm.title = 'Web Instance'
  challengeForm.description = '这是一个带统一访问入口的 Web 题模板，用于记录题面、提示和访问地址。'
  challengeForm.hints = JSON.stringify([
    '请确认选手侧访问入口、账号体系和附加依赖已经准备完成。',
    '如果题目依赖额外凭据或访问限制，请写入接入说明。',
  ], null, 2)
  challengeForm.attachments = '[]'
  challengeForm.container_spec = JSON.stringify({
    connection: {
      url: '',
      note: '请填写统一访问入口，例如反向代理、负载均衡地址或固定靶机地址。',
    },
    links: [
      {
        label: '打开 Web 实例',
        url: '',
      },
    ],
  }, null, 2)
  challengeForm.category = 'web'
  challengeForm.type = 'static'
  challengeForm.difficulty = 'easy'
  challengeForm.flag = ''
  challengeForm.base_score = 100
  challengeForm.min_score = 10
  challengeForm.decay_rate = 0.1
  challengeForm.max_attempts = 0
  challengeForm.is_visible = true

  toast.add({ title: '已填充 Web 实例模板', description: '已写入统一入口型 Web 题默认值。', color: 'success' })
}

function fillPwnNetcatTemplate() {
  challengeForm.title = 'Pwn Service'
  challengeForm.description = '这是一个 nc / tcp 服务题模板，用于记录 host、port、连接命令和附件。'
  challengeForm.hints = JSON.stringify([
    '优先把题目附件放到 attachments 里。',
    '如果服务地址会变化，请保留一个稳定代理入口。',
  ], null, 2)
  challengeForm.attachments = '[]'
  challengeForm.container_spec = JSON.stringify({
    connection: {
      host: '127.0.0.1',
      port: 1337,
      command: 'nc 127.0.0.1 1337',
      note: '把这里替换成实际的 tcp 服务地址；如果有公网代理，也可以额外填写 url。',
    },
  }, null, 2)
  challengeForm.category = 'pwn'
  challengeForm.type = 'static'
  challengeForm.difficulty = 'medium'
  challengeForm.flag = ''
  challengeForm.base_score = 300
  challengeForm.min_score = 100
  challengeForm.decay_rate = 0.1
  challengeForm.max_attempts = 0
  challengeForm.is_visible = true

  toast.add({ title: '已填充 Pwn 服务模板', description: '已写入 host / port / nc 连接方式默认值。', color: 'success' })
}

function fillDynamicContainerTemplate() {
  challengeForm.title = '动态容器 Web 题'
  challengeForm.description = '这是一个动态容器题模板。启用本地 Docker provider 后，平台会按 runtime.image 与 runtime.expose 启动实例。'
  challengeForm.hints = JSON.stringify([
    '请先确认运行节点已启用对应 provider，并能拉取题目镜像。',
    '实例启动后，应以平台回填的 host、port 和 launch_url 作为选手入口。',
    '如需为不同队伍分配独立入口，可改用“每队独立入口”模板。',
  ], null, 2)
  challengeForm.attachments = '[]'
  challengeForm.container_spec = JSON.stringify({
    runtime: {
      provider: 'docker',
      image: 'nginx:alpine',
      expose: [80],
    },
    connection: {
      note: '实例启动后，平台会把实际 host、port 和 launch_url 回填到实例响应里。',
    },
    links: [
      {
        label: '实例入口',
        url: '由平台在实例启动后回填真实 launch_url',
      },
      {
        label: '本地运行说明',
        url: '/docs/get-started/local-docker-provider',
      },
    ],
    metadata: {
      purpose: 'local-docker-web',
      expected_service: 'nginx default page',
      expected_port: 80,
    },
  }, null, 2)
  challengeForm.category = 'web'
  challengeForm.type = 'dynamic'
  challengeForm.difficulty = 'medium'
  challengeForm.flag = ''
  challengeForm.base_score = 300
  challengeForm.min_score = 100
  challengeForm.decay_rate = 0.1
  challengeForm.max_attempts = 0
  challengeForm.is_visible = true

  toast.add({ title: '已填充动态容器模板', description: '默认使用 nginx:alpine。', color: 'success' })
}

function fillTeamScopedDynamicTemplate() {
  challengeForm.title = '每队独立入口题'
  challengeForm.description = '这是一个按队伍生成独立入口的动态题模板，用于需要稳定队伍级地址分发的场景。'
  challengeForm.hints = JSON.stringify([
    '请根据实际部署方式调整 runtime、connection 和 links 字段。',
    '如果后端后续接入新的实例 provider，可以继续复用这份结构。',
  ], null, 2)
  challengeForm.attachments = '[]'
  challengeForm.container_spec = JSON.stringify({
    runtime: {
      provider: 'docker',
      image: 'ghcr.io/example/ctf-web:latest',
      expose: [8080],
    },
    connection: {
      url: '/local-instance/{{game_id}}/{{challenge_id}}/{{team_hash}}?team={{team_id}}',
      host: 'team-{{team_hash}}.instance.local',
      port: 443,
      command: '访问平台分配的专属入口',
      note: '每支队伍都会获得独立入口。请在上线前替换为真实的入口分发地址或代理规则。',
    },
    links: [
      {
        label: '题目入口',
        url: '/local-instance/{{game_id}}/{{challenge_id}}/{{team_hash}}?team={{team_id}}',
      },
    ],
  }, null, 2)
  challengeForm.category = 'web'
  challengeForm.type = 'dynamic'
  challengeForm.difficulty = 'hard'
  challengeForm.flag = ''
  challengeForm.base_score = 500
  challengeForm.min_score = 200
  challengeForm.decay_rate = 0.1
  challengeForm.max_attempts = 0
  challengeForm.is_visible = true

  toast.add({ title: '已填充每队独立实例模板', description: '已写入带队伍独立入口的动态题默认值。', color: 'success' })
}

async function createStarterProvision() {
  const now = new Date()
  const start = new Date(now.getTime() + 30 * 60 * 1000)
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
  const freeze = new Date(end.getTime() - 30 * 60 * 1000)

  starterProvisioning.value = true
  try {
    const game = await $api('post', '/api/games', {
      body: {
        name: `${start.getFullYear()} 平台基础比赛`,
        description: '用于快速建立公开比赛基础结构的精简模板。',
        notice: '建议在发布前补全题面、附件、规则补充与开放设置。',
        divisions: [],
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        scoreboard_freeze_at: freeze.toISOString(),
        registration_mode: 'auto_accept',
        max_team_members: 4,
        practice_mode: true,
        writeup_required: false,
        writeup_deadline: null,
        is_public: true,
      },
    })

    const challenge = await $api('post', '/api/challenges', {
      body: {
        title: '基础静态题',
        description: '这是一个基础静态题模板，用于补齐题面、提示、附件和计分配置。',
        hints: JSON.stringify([
          '请在发布前补充正式题面、提示和附件信息。',
          '保存前请确认 Flag、分值和可见性设置已经完成。',
        ]),
        attachments: '[]',
        category: 'misc',
        type: 'static',
        difficulty: 'easy',
        flag: 'flag{platform-baseline}',
        base_score: 100,
        min_score: 100,
        decay_rate: 0,
        is_visible: true,
      },
    })

    await $api('post', '/api/games/{id}/challenges', {
      params: {
        id: game.id,
      },
      body: {
        challenge_id: challenge.id,
      },
    })

    await loadAdminResources()
    selectGameContext(game.id)
    attachForm.challenge_id = challenge.id
    toast.add({
      title: '基础比赛模板已创建',
      description: `已创建 ${game.name}，并自动挂载一道基础题目。现在可以继续补全配置并确认公开展示。`,
      color: 'success',
    })
    jumpToAdminAnchor('#attach-challenge')
  }
  catch (e: any) {
    toast.add({ title: '创建基础比赛模板失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    starterProvisioning.value = false
  }
}

async function createDynamicProvision() {
  const now = new Date()
  const start = new Date(now.getTime() + 30 * 60 * 1000)
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
  const freeze = new Date(end.getTime() - 30 * 60 * 1000)

  dynamicProvisioning.value = true
  try {
    const game = await $api('post', '/api/games', {
      body: {
        name: `${start.getFullYear()} 动态实例比赛`,
        description: '用于快速建立动态实例能力的公开比赛模板。',
        notice: '发布前请确认实例入口、镜像与运行状态配置正确。',
        divisions: [],
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        scoreboard_freeze_at: freeze.toISOString(),
        registration_mode: 'auto_accept',
        max_team_members: 4,
        practice_mode: true,
        writeup_required: false,
        writeup_deadline: null,
        is_public: true,
      },
    })

    const challenge = await $api('post', '/api/challenges', {
      body: {
        title: '每队独立入口题',
        description: '这是一个按队伍分配独立入口的动态题模板。',
        hints: JSON.stringify([
          '请先确认入口模板、分发规则和实例 provider 已经准备完成。',
          '实例启动后，应优先看到当前队伍的真实入口，而不是占位符原文。',
        ]),
        attachments: '[]',
        container_spec: JSON.stringify({
          runtime: {
            provider: 'docker',
            image: 'ghcr.io/example/ctf-web:latest',
            expose: [8080],
          },
          connection: {
            url: '/local-instance/{{game_id}}/{{challenge_id}}/{{team_hash}}?team={{team_id}}',
            host: 'team-{{team_hash}}.instance.local',
            port: 443,
            command: '访问平台分配的专属入口',
            note: '每支队伍都会获得独立入口。请在上线前替换为真实的入口分发地址或代理规则。',
          },
          links: [
            {
              label: '题目入口',
              url: '/local-instance/{{game_id}}/{{challenge_id}}/{{team_hash}}?team={{team_id}}',
            },
          ],
        }),
        category: 'web',
        type: 'dynamic',
        difficulty: 'hard',
        flag: 'flag{dynamic-instance-baseline}',
        base_score: 300,
        min_score: 100,
        decay_rate: 0.1,
        is_visible: true,
      },
    })

    await $api('post', '/api/games/{id}/challenges', {
      params: {
        id: game.id,
      },
      body: {
        challenge_id: challenge.id,
      },
    })

    await loadAdminResources()
    selectGameContext(game.id)
    attachForm.challenge_id = challenge.id
    toast.add({
      title: '动态实例比赛已创建',
      description: `已创建 ${game.name}，并自动挂载一道动态实例题。现在可以继续补全入口与实例配置。`,
      color: 'success',
    })
    jumpToAdminAnchor('#attach-challenge')
  }
  catch (e: any) {
    toast.add({ title: '创建动态实例模板失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    dynamicProvisioning.value = false
  }
}

async function createLocalDockerProvision() {
  const now = new Date()
  const start = new Date(now.getTime() + 30 * 60 * 1000)
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
  const freeze = new Date(end.getTime() - 30 * 60 * 1000)

  localDockerProvisioning.value = true
  try {
    const game = await $api('post', '/api/games', {
      body: {
        name: `${start.getFullYear()} 容器实例比赛`,
        description: '用于快速建立容器实例能力的公开比赛模板。',
        notice: '发布前请确认本地 Docker provider、镜像与实例入口配置正确。',
        divisions: [],
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        scoreboard_freeze_at: freeze.toISOString(),
        registration_mode: 'auto_accept',
        max_team_members: 4,
        practice_mode: true,
        writeup_required: false,
        writeup_deadline: null,
        is_public: true,
      },
    })

    const challenge = await $api('post', '/api/challenges', {
      body: {
        title: '动态容器 Web 题',
        description: '这是一个动态容器题模板，用于补齐镜像、端口和入口配置。',
        hints: JSON.stringify([
          '请先确认运行节点已启用本地 Docker provider，且 Docker daemon 可用。',
          '实例启动后，应优先看到平台回填的真实 host、port 和 launch_url。',
        ]),
        attachments: '[]',
        container_spec: JSON.stringify({
          runtime: {
            provider: 'docker',
            image: 'nginx:alpine',
            expose: [80],
          },
          connection: {
            note: '实例启动后，平台会为当前题目回填真实容器实例入口。',
          },
          links: [
            {
              label: '实例入口',
              url: '由平台在实例启动后回填真实 launch_url',
            },
          ],
          metadata: {
            purpose: 'local-docker-web',
            expected_service: 'nginx default page',
            expected_port: 80,
          },
        }),
        category: 'web',
        type: 'dynamic',
        difficulty: 'medium',
        flag: 'flag{docker-instance-baseline}',
        base_score: 300,
        min_score: 100,
        decay_rate: 0.1,
        is_visible: true,
      },
    })

    await $api('post', '/api/games/{id}/challenges', {
      params: {
        id: game.id,
      },
      body: {
        challenge_id: challenge.id,
      },
    })

    await loadAdminResources()
    selectGameContext(game.id)
    attachForm.challenge_id = challenge.id
    toast.add({
      title: '容器实例比赛已创建',
      description: `已创建 ${game.name}，并自动挂上一道动态 Web 题。现在可以继续前往公开页完成配置并确认实例入口。`,
      color: 'success',
    })
    jumpToAdminAnchor('#attach-challenge')
  }
  catch (e: any) {
    toast.add({ title: '创建容器实例模板失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    localDockerProvisioning.value = false
  }
}

function selectGameContext(gameId?: number) {
  attachForm.game_id = gameId
  gameSettingsForm.game_id = gameId
  gameEditForm.game_id = gameId
}

async function createGame() {
  const timelineError = validateGameTimeline(gameForm, { requireStartEnd: true })
  if (timelineError) {
    toast.add({ title: '比赛时间配置无效', description: timelineError, color: 'warning' })
    return
  }

  gameSubmitting.value = true
  try {
    await $api('post', '/api/games', {
      body: {
        name: gameForm.name,
        description: gameForm.description,
        notice: gameForm.notice,
        invitation_code: gameForm.invitation_code,
        divisions: parseDivisionList(gameForm.divisions_text),
        start_time: new Date(gameForm.start_time).toISOString(),
        end_time: new Date(gameForm.end_time).toISOString(),
        ...(gameForm.scoreboard_freeze_at ? { scoreboard_freeze_at: new Date(gameForm.scoreboard_freeze_at).toISOString() } : {}),
        registration_mode: gameForm.registration_mode,
        max_team_members: gameForm.max_team_members,
        practice_mode: gameForm.practice_mode,
        writeup_required: gameForm.writeup_required,
        writeup_deadline: gameForm.writeup_deadline ? new Date(gameForm.writeup_deadline).toISOString() : null,
        is_public: gameForm.is_public,
      },
    })
    toast.add({ title: '比赛创建成功', color: 'success' })
    createGameModalOpen.value = false
    gameForm.name = ''
    gameForm.description = ''
    gameForm.notice = ''
    gameForm.invitation_code = ''
    gameForm.divisions_text = ''
    gameForm.start_time = ''
    gameForm.end_time = ''
    gameForm.scoreboard_freeze_at = ''
    gameForm.registration_mode = 'review'
    gameForm.max_team_members = 0
    gameForm.practice_mode = false
    gameForm.writeup_required = false
    gameForm.writeup_deadline = ''
    gameForm.is_public = true
    await loadAdminResources()
  }
  catch (e: any) {
    toast.add({ title: '比赛创建失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    gameSubmitting.value = false
  }
}

async function createChallenge() {
  const challengeError = validateChallengeDraft(challengeForm)
  if (challengeError) {
    toast.add({ title: '题目配置无效', description: challengeError, color: 'warning' })
    return
  }

  challengeSubmitting.value = true
  try {
    await $api('post', '/api/challenges', {
      body: {
        title: challengeForm.title,
        description: challengeForm.description,
        hints: challengeForm.hints,
        attachments: challengeForm.attachments,
        container_spec: challengeForm.container_spec,
        category: challengeForm.category as 'web',
        type: challengeForm.type as 'static',
        difficulty: challengeForm.difficulty as 'easy',
        flag: challengeForm.flag,
        base_score: challengeForm.base_score,
        min_score: challengeForm.min_score,
        decay_rate: challengeForm.decay_rate,
        max_attempts: challengeForm.max_attempts,
        is_visible: challengeForm.is_visible,
      },
    })
    toast.add({ title: '题目创建成功', color: 'success' })
    createChallengeModalOpen.value = false
    challengeForm.title = ''
    challengeForm.description = ''
    challengeForm.hints = '[]'
    challengeForm.attachments = '[]'
    challengeForm.container_spec = ''
    challengeAttachmentUploadForm.file = undefined
    challengeForm.category = 'web'
    challengeForm.type = 'static'
    challengeForm.difficulty = 'easy'
    challengeForm.flag = ''
    challengeForm.base_score = 100
    challengeForm.min_score = 10
    challengeForm.decay_rate = 0.1
    challengeForm.max_attempts = 0
    challengeForm.is_visible = true
    await loadAdminResources()
  }
  catch (e: any) {
    toast.add({ title: '题目创建失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    challengeSubmitting.value = false
  }
}

async function uploadChallengeAttachment() {
  if (!challengeAttachmentUploadForm.file) {
    toast.add({ title: '请先选择文件', color: 'warning' })
    return
  }

  challengeAttachmentUploading.value = true
  try {
    const formData = new FormData()
    formData.append('file', challengeAttachmentUploadForm.file)

    const result = await $fetch<{ name: string, url: string }>('/api/admin/challenges/attachments', {
      method: 'POST',
      body: formData,
    })

    challengeForm.attachments = appendAttachmentUrl(challengeForm.attachments, result.url)
    challengeAttachmentUploadForm.file = undefined
    toast.add({ title: '附件上传成功', description: `已加入 ${result.url}`, color: 'success' })
  }
  catch (e: any) {
    toast.add({ title: '附件上传失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    challengeAttachmentUploading.value = false
  }
}

async function updateChallengeDetails() {
  if (!challengeEditForm.challenge_id) {
    toast.add({ title: '请先选择题目', color: 'warning' })
    return
  }

  const challengeError = validateChallengeDraft(challengeEditForm)
  if (challengeError) {
    toast.add({ title: '题目配置无效', description: challengeError, color: 'warning' })
    return
  }

  challengeEditing.value = true
  try {
    await $api('put', '/api/challenges/{id}', {
      params: {
        id: challengeEditForm.challenge_id,
      },
      body: {
        title: challengeEditForm.title,
        description: challengeEditForm.description,
        hints: challengeEditForm.hints,
        attachments: challengeEditForm.attachments,
        container_spec: challengeEditForm.container_spec,
        category: challengeEditForm.category,
        type: challengeEditForm.type,
        difficulty: challengeEditForm.difficulty,
        base_score: challengeEditForm.base_score,
        min_score: challengeEditForm.min_score,
        decay_rate: challengeEditForm.decay_rate,
        max_attempts: challengeEditForm.max_attempts,
        is_visible: challengeEditForm.is_visible,
      },
    })

    challengeEditModalOpen.value = false
    toast.add({ title: '题目信息已更新', color: 'success' })
    await loadAdminResources()
  }
  catch (e: any) {
    toast.add({ title: '题目信息更新失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    challengeEditing.value = false
  }
}

async function uploadChallengeEditAttachment() {
  if (!challengeEditAttachmentUploadForm.file) {
    toast.add({ title: '请先选择文件', color: 'warning' })
    return
  }

  challengeEditAttachmentUploading.value = true
  try {
    const formData = new FormData()
    formData.append('file', challengeEditAttachmentUploadForm.file)

    const result = await $fetch<{ name: string, url: string }>('/api/admin/challenges/attachments', {
      method: 'POST',
      body: formData,
    })

    challengeEditForm.attachments = appendAttachmentUrl(challengeEditForm.attachments, result.url)
    challengeEditAttachmentUploadForm.file = undefined
    toast.add({ title: '附件上传成功', description: `已加入 ${result.url}`, color: 'success' })
  }
  catch (e: any) {
    toast.add({ title: '附件上传失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    challengeEditAttachmentUploading.value = false
  }
}

async function deleteChallenge(challengeId: number) {
  const challenge = challenges.value.find(item => item.id === challengeId)
  openConfirmAction({
    type: 'delete-challenge',
    id: challengeId,
    title: '确认删除题目',
    description: `题目「${challenge?.title || `#${challengeId}`}」删除后，将无法继续被比赛挂载或编辑。`,
    confirmLabel: '删除题目',
  })
}

async function runDeleteChallenge(challengeId: number) {
  deletingChallengeId.value = challengeId
  try {
    await $api('delete', '/api/challenges/{id}', {
      params: {
        id: challengeId,
      },
    })

    if (challengeEditForm.challenge_id === challengeId) {
      challengeEditForm.challenge_id = undefined
    }
    if (attachForm.challenge_id === challengeId) {
      attachForm.challenge_id = undefined
    }

    toast.add({ title: '题目已删除', color: 'success' })
    await loadAdminResources()
  }
  catch (e: any) {
    toast.add({ title: '删除题目失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    deletingChallengeId.value = null
  }
}

async function updateGameSettings() {
  if (!gameSettingsForm.game_id) {
    toast.add({ title: '请先选择比赛', color: 'warning' })
    return
  }

  const selected = selectedSettingsGame.value
  const timelineError = validateGameTimeline({
    start_time: selected?.start_time?.slice(0, 16) || '',
    end_time: selected?.end_time?.slice(0, 16) || '',
    scoreboard_freeze_at: gameSettingsForm.scoreboard_freeze_at,
    writeup_deadline: gameSettingsForm.writeup_deadline,
    writeup_required: gameSettingsForm.writeup_required,
  }, { requireStartEnd: true })
  if (timelineError) {
    toast.add({ title: '比赛设置无效', description: timelineError, color: 'warning' })
    return
  }

  settingsSubmitting.value = true
  try {
    const body: {
      status: 'draft' | 'active' | 'ended'
      invitation_code: string
      divisions: string[]
      registration_mode: 'review' | 'auto_accept'
      max_team_members: number
      practice_mode: boolean
      writeup_required: boolean
      writeup_deadline?: string | null
      is_public: boolean
      scoreboard_freeze_at?: string | null
    } = {
      status: gameSettingsForm.status,
      invitation_code: gameSettingsForm.invitation_code,
      divisions: parseDivisionList(gameSettingsForm.divisions_text),
      registration_mode: gameSettingsForm.registration_mode,
      max_team_members: gameSettingsForm.max_team_members,
      practice_mode: gameSettingsForm.practice_mode,
      writeup_required: gameSettingsForm.writeup_required,
      writeup_deadline: gameSettingsForm.writeup_deadline
        ? new Date(gameSettingsForm.writeup_deadline).toISOString()
        : null,
      is_public: gameSettingsForm.is_public,
      scoreboard_freeze_at: gameSettingsForm.scoreboard_freeze_at
        ? new Date(gameSettingsForm.scoreboard_freeze_at).toISOString()
        : null,
    }

    await $api('put', '/api/games/{id}', {
      params: {
        id: gameSettingsForm.game_id,
      },
      body,
    })

    toast.add({ title: '比赛设置已更新', color: 'success' })
    await loadAdminResources()
  }
  catch (e: any) {
    toast.add({ title: '比赛设置更新失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    settingsSubmitting.value = false
  }
}

async function updateGameDetails() {
  if (!gameEditForm.game_id) {
    toast.add({ title: '请先选择比赛', color: 'warning' })
    return
  }

  const timelineError = validateGameTimeline(gameEditForm, { requireStartEnd: true })
  if (timelineError) {
    toast.add({ title: '比赛信息无效', description: timelineError, color: 'warning' })
    return
  }

  gameEditing.value = true
  try {
    await $api('put', '/api/games/{id}', {
      params: {
        id: gameEditForm.game_id,
      },
      body: {
        name: gameEditForm.name,
        description: gameEditForm.description,
        notice: gameEditForm.notice,
        invitation_code: gameEditForm.invitation_code,
        divisions: parseDivisionList(gameEditForm.divisions_text),
        start_time: new Date(gameEditForm.start_time).toISOString(),
        end_time: new Date(gameEditForm.end_time).toISOString(),
        practice_mode: gameEditForm.practice_mode,
        writeup_required: gameEditForm.writeup_required,
        writeup_deadline: gameEditForm.writeup_deadline
          ? new Date(gameEditForm.writeup_deadline).toISOString()
          : null,
      },
    })

    gameEditModalOpen.value = false
    toast.add({ title: '比赛信息已更新', color: 'success' })
    await loadAdminResources()
  }
  catch (e: any) {
    toast.add({ title: '比赛信息更新失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    gameEditing.value = false
  }
}

async function deleteGame(gameId: number) {
  const game = games.value.find(item => item.id === gameId)
  openConfirmAction({
    type: 'delete-game',
    id: gameId,
    title: '确认删除比赛',
    description: `比赛「${game?.name || `#${gameId}`}」删除后，会同时清理该比赛下的报名、解题、Writeup 和挂题关系。`,
    confirmLabel: '删除比赛',
  })
}

async function runDeleteGame(gameId: number) {
  deletingGameId.value = gameId
  try {
    await $api('delete', '/api/admin/games/{id}', {
      params: {
        id: gameId,
      },
    })

    if (attachForm.game_id === gameId) {
      attachForm.game_id = undefined
      resetSelectedGameContext()
    }
    if (gameSettingsForm.game_id === gameId) {
      gameSettingsForm.game_id = undefined
    }
    if (gameEditForm.game_id === gameId) {
      gameEditForm.game_id = undefined
    }

    toast.add({ title: '比赛已删除', color: 'success' })
    await loadAdminResources()
  }
  catch (e: any) {
    toast.add({ title: '删除比赛失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    deletingGameId.value = null
  }
}

async function exportGame(gameId: number) {
  exportingGameId.value = gameId
  try {
    await downloadArchive(
      `/api/admin/games/${gameId}/export`,
      `game-${gameId}-export.zip`,
      '比赛导出成功',
    )
  }
  catch (e: any) {
    toast.add({ title: '比赛导出失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    exportingGameId.value = null
  }
}

async function downloadArchive(url: string, fallbackFilename: string, successTitle: string) {
  const response = await $fetch.raw(url, {
    method: 'POST',
    responseType: 'blob',
  })

  const blob = response._data as Blob
  const contentDisposition = response.headers.get('content-disposition') || ''
  const match = contentDisposition.match(/filename="([^"]+)"/)
  const filename = match?.[1] || fallbackFilename
  const objectUrl = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(objectUrl)

  toast.add({ title: successTitle, description: `已下载 ${filename}`, color: 'success' })
}

async function exportScoreboard(gameId: number, division?: string) {
  exportingScoreboardGameId.value = gameId
  try {
    const query = division ? `?division=${encodeURIComponent(division)}` : ''
    const fallbackFilename = division
      ? `game-${gameId}-scoreboard-${division}-export.zip`
      : `game-${gameId}-scoreboard-export.zip`
    await downloadArchive(
      `/api/admin/games/${gameId}/scoreboard/export${query}`,
      fallbackFilename,
      '榜单导出成功',
    )
  }
  catch (e: any) {
    toast.add({ title: '榜单导出失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    exportingScoreboardGameId.value = null
  }
}

async function exportWriteups(gameId: number) {
  exportingWriteupsGameId.value = gameId
  try {
    await downloadArchive(
      `/api/admin/games/${gameId}/writeups/export`,
      `game-${gameId}-writeups-export.zip`,
      'Writeup 导出成功',
    )
  }
  catch (e: any) {
    toast.add({ title: 'Writeup 导出失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    exportingWriteupsGameId.value = null
  }
}

async function exportSubmissions(gameId: number) {
  exportingSubmissionsGameId.value = gameId
  try {
    await downloadArchive(
      `/api/admin/games/${gameId}/submissions/export`,
      `game-${gameId}-submissions-export.zip`,
      '提交记录导出成功',
    )
  }
  catch (e: any) {
    toast.add({ title: '提交记录导出失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    exportingSubmissionsGameId.value = null
  }
}

async function importGamePackage() {
  if (!importForm.file) {
    toast.add({ title: '请先选择导入文件', color: 'warning' })
    return
  }

  importingGame.value = true
  try {
    const formData = new FormData()
    formData.append('file', importForm.file)

    const game = await $fetch<AdminGameSummary>('/api/admin/games/import', {
      method: 'POST',
      body: formData,
    })

    importModalOpen.value = false
    importForm.file = undefined
    await loadAdminResources()
    attachForm.game_id = game.id
    gameSettingsForm.game_id = game.id
    gameEditForm.game_id = game.id
    toast.add({ title: '比赛导入成功', description: `已创建 ${game.name}，当前保持 draft，可继续在管理端核对挂题和配置。`, color: 'success' })
  }
  catch (e: any) {
    toast.add({ title: '比赛导入失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    importingGame.value = false
  }
}

async function attachChallengeToGame() {
  if (!attachForm.game_id || !attachForm.challenge_id) {
    toast.add({ title: '请先选择比赛和题目', color: 'warning' })
    return
  }

  attachSubmitting.value = true
  try {
    await $api('post', '/api/games/{id}/challenges', {
      params: {
        id: attachForm.game_id,
      },
      body: {
        challenge_id: attachForm.challenge_id,
        ...(attachForm.score_override !== undefined ? { score_override: attachForm.score_override } : {}),
      },
    })

    toast.add({ title: '题目已加入比赛', color: 'success' })
    attachChallengeModalOpen.value = false
    attachForm.challenge_id = undefined
    attachForm.score_override = undefined
    await loadSelectedGameChallenges()
  }
  catch (e: any) {
    toast.add({ title: '挂载题目失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    attachSubmitting.value = false
  }
}

async function removeChallengeFromGame(challengeId: number) {
  if (!attachForm.game_id) {
    return
  }

  removingChallengeId.value = challengeId
  try {
    await $api('delete', '/api/games/{id}/challenges/{challengeId}', {
      params: {
        id: attachForm.game_id,
        challengeId,
      },
    })

    toast.add({ title: '题目已从比赛移除', color: 'success' })
    await loadSelectedGameChallenges()
  }
  catch (e: any) {
    toast.add({ title: '移除题目失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    removingChallengeId.value = null
  }
}

function quickEditGame(gameId: number) {
  selectGameContext(gameId)
  gameEditModalOpen.value = true
  toast.add({ title: '已填充比赛管理表单', color: 'info' })
}

function quickEditChallenge(challengeId: number) {
  challengeEditForm.challenge_id = challengeId
  attachForm.challenge_id = challengeId
  challengeEditModalOpen.value = true
  toast.add({ title: '已填充题目管理表单', color: 'info' })
}

function openConfirmAction(payload: {
  type: ConfirmActionType
  id: number
  title: string
  description: string
  confirmLabel: string
}) {
  confirmActionState.type = payload.type
  confirmActionState.id = payload.id
  confirmActionState.title = payload.title
  confirmActionState.description = payload.description
  confirmActionState.confirmLabel = payload.confirmLabel
  confirmModalOpen.value = true
}

function resetConfirmAction() {
  confirmActionState.type = null
  confirmActionState.id = null
  confirmActionState.title = ''
  confirmActionState.description = ''
  confirmActionState.confirmLabel = '确认'
}

async function confirmAction() {
  const actionType = confirmActionState.type
  const actionId = confirmActionState.id

  if (!actionType || actionId === null) {
    return
  }

  confirmModalOpen.value = false

  if (actionType === 'destroy-instance') {
    await runDestroyInstanceLease(actionId)
  }
  else if (actionType === 'delete-announcement') {
    await runDeleteAnnouncement(actionId)
  }
  else if (actionType === 'remove-participant') {
    await runRemoveParticipant(actionId)
  }
  else if (actionType === 'delete-challenge') {
    await runDeleteChallenge(actionId)
  }
  else if (actionType === 'delete-game') {
    await runDeleteGame(actionId)
  }

  resetConfirmAction()
}

watch(() => challengeEditForm.challenge_id, () => {
  if (!challengeEditForm.challenge_id) {
    challengeEditForm.title = ''
    challengeEditForm.description = ''
    challengeEditForm.hints = '[]'
    challengeEditForm.attachments = '[]'
    challengeEditForm.container_spec = ''
    challengeEditAttachmentUploadForm.file = undefined
    challengeEditForm.category = 'web'
    challengeEditForm.type = 'static'
    challengeEditForm.difficulty = 'easy'
    challengeEditForm.base_score = 100
    challengeEditForm.min_score = 10
    challengeEditForm.decay_rate = 0.1
    challengeEditForm.max_attempts = 0
    challengeEditForm.is_visible = true
    return
  }

  const challenge = challenges.value.find(item => item.id === challengeEditForm.challenge_id)
  if (!challenge) {
    return
  }

  challengeEditForm.title = challenge.title
  challengeEditForm.description = challenge.description || ''
  challengeEditForm.hints = challenge.hints || '[]'
  challengeEditForm.attachments = challenge.attachments || '[]'
  challengeEditForm.container_spec = challenge.container_spec || ''
  challengeEditAttachmentUploadForm.file = undefined
  challengeEditForm.category = challenge.category
  challengeEditForm.type = challenge.type || 'static'
  challengeEditForm.difficulty = challenge.difficulty || 'easy'
  challengeEditForm.base_score = challenge.base_score || 100
  challengeEditForm.min_score = challenge.min_score || 10
  challengeEditForm.decay_rate = challenge.decay_rate || 0.1
  challengeEditForm.max_attempts = challenge.max_attempts || 0
  challengeEditForm.is_visible = challenge.is_visible ?? true
})

watch(() => gameEditForm.game_id, () => {
  if (!gameEditForm.game_id) {
    gameEditForm.name = ''
    gameEditForm.description = ''
    gameEditForm.notice = ''
    gameEditForm.invitation_code = ''
    gameEditForm.divisions_text = ''
    gameEditForm.start_time = ''
    gameEditForm.end_time = ''
    gameEditForm.practice_mode = false
    gameEditForm.writeup_required = false
    gameEditForm.writeup_deadline = ''
    return
  }

  const game = games.value.find(item => item.id === gameEditForm.game_id)
  if (!game) {
    return
  }

  gameEditForm.name = game.name
  gameEditForm.description = game.description || ''
  gameEditForm.notice = game.notice || ''
  gameEditForm.invitation_code = game.invitation_code || ''
  gameEditForm.divisions_text = formatDivisionList(game.divisions)
  gameEditForm.start_time = game.start_time.slice(0, 16)
  gameEditForm.end_time = game.end_time.slice(0, 16)
  gameEditForm.practice_mode = game.practice_mode ?? false
  gameEditForm.writeup_required = game.writeup_required ?? false
  gameEditForm.writeup_deadline = game.writeup_deadline ? game.writeup_deadline.slice(0, 16) : ''
})

watch(() => gameSettingsForm.game_id, () => {
  if (!gameSettingsForm.game_id) {
    gameSettingsForm.status = 'draft'
    gameSettingsForm.invitation_code = ''
    gameSettingsForm.divisions_text = ''
    gameSettingsForm.scoreboard_freeze_at = ''
    gameSettingsForm.registration_mode = 'review'
    gameSettingsForm.max_team_members = 0
    gameSettingsForm.practice_mode = false
    gameSettingsForm.writeup_required = false
    gameSettingsForm.writeup_deadline = ''
    gameSettingsForm.is_public = true
    return
  }

  const game = games.value.find(item => item.id === gameSettingsForm.game_id)
  if (!game) {
    return
  }

  gameSettingsForm.status = game.status
  gameSettingsForm.invitation_code = game.invitation_code || ''
  gameSettingsForm.divisions_text = formatDivisionList(game.divisions)
  gameSettingsForm.scoreboard_freeze_at = game.scoreboard_freeze_at ? game.scoreboard_freeze_at.slice(0, 16) : ''
  gameSettingsForm.registration_mode = game.registration_mode || 'review'
  gameSettingsForm.max_team_members = game.max_team_members || 0
  gameSettingsForm.practice_mode = game.practice_mode ?? false
  gameSettingsForm.writeup_required = game.writeup_required ?? false
  gameSettingsForm.writeup_deadline = game.writeup_deadline ? game.writeup_deadline.slice(0, 16) : ''
  gameSettingsForm.is_public = game.is_public ?? true
})

watch(() => attachForm.game_id, async () => {
  await loadSelectedGameChallenges()
  await loadParticipants()
  await loadInstanceLeases()
  await loadWriteups()
  await loadScoreboard()
  await loadSubmissions()
  await loadCheatClues()
  await loadAnnouncements()
})

watch(() => [submissionFilters.type, submissionFilters.count], async () => {
  if (!attachForm.game_id) {
    return
  }
  await loadSubmissions()
})

watch(() => selectedScoreboardDivision.value, async () => {
  if (!attachForm.game_id) {
    return
  }
  await loadScoreboard()
})

onMounted(async () => {
  await ensureInitialized()

  if (!isAdmin.value) {
    await router.push('/console')
    toast.add({ title: '无权限访问管理页', color: 'warning' })
    return
  }

  await loadAdminResources()
})
</script>

<template>
  <div class="py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-bold">
        赛事管理
      </h1>
      <p class="text-muted mt-1">
        使用现有管理 API 创建比赛、题目并挂载到比赛
      </p>
    </div>

    <div v-if="!isAdmin" class="text-sm text-muted">
      正在校验权限...
    </div>

    <div v-else class="space-y-6">
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <UPageCard
          title="比赛"
          :description="loadingResources ? '正在加载...' : `当前 ${games.length} 场`"
          icon="i-lucide-trophy"
        />
        <UPageCard
          title="题目"
          :description="loadingResources ? '正在加载...' : `当前 ${challenges.length} 道`"
          icon="i-lucide-flag"
        />
        <UPageCard
          title="挂载能力"
          description="可将已有题目加入指定比赛"
          icon="i-lucide-link"
        />
      </div>

      <UPageCard title="快速模板" icon="i-lucide-layout-template">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div class="space-y-2">
            <p class="text-sm text-muted">
              可直接生成一套精简的比赛与题目配置，便于快速建立标准化赛事基础结构。
            </p>
            <UAlert
              color="info"
              variant="soft"
              title="使用说明"
              description="模板仅写入基础配置。正式发布前仍应补全题面、入口、镜像、附件与规则设置。"
            />
          </div>

          <div class="flex shrink-0 flex-wrap gap-2">
            <UButton icon="i-lucide-layout-template" :loading="starterProvisioning" @click="createStarterProvision">
              创建基础比赛
            </UButton>
            <UButton
              variant="outline"
              icon="i-lucide-box"
              :loading="dynamicProvisioning"
              @click="createDynamicProvision"
            >
              创建动态实例比赛
            </UButton>
            <UButton
              variant="outline"
              icon="i-lucide-container"
              :loading="localDockerProvisioning"
              @click="createLocalDockerProvision"
            >
              创建容器实例比赛
            </UButton>
            <UButton variant="outline" icon="i-lucide-wand-sparkles" @click="fillStarterGameTemplate">
              填充比赛表单
            </UButton>
            <UButton variant="outline" icon="i-lucide-wand-sparkles" @click="fillStarterChallengeTemplate">
              填充题目表单
            </UButton>
          </div>
        </div>
      </UPageCard>

      <UPageCard title="配置概览" icon="i-lucide-list-checks">
        <div class="space-y-3">
          <UAlert
            color="info"
            variant="soft"
            title="建议顺序：比赛、题目、挂载、发布确认"
            description="用于集中查看当前配置缺口，减少未完成内容提前公开的风险。"
          />

          <div class="grid gap-3 xl:grid-cols-2">
            <div
              v-for="step in adminSetupSteps"
              :key="step.key"
              class="rounded-lg border border-default px-3 py-3"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <UIcon
                      :name="step.done ? 'i-lucide-circle-check-big' : 'i-lucide-arrow-right-circle'"
                      :class="step.done ? 'text-success' : 'text-primary'"
                      class="size-4 shrink-0"
                    />
                    <div class="font-medium">
                      {{ step.title }}
                    </div>
                  </div>
                  <div class="mt-2 text-sm text-muted">
                    {{ step.description }}
                  </div>
                </div>
                <UBadge :color="step.done ? 'success' : 'warning'" variant="soft">
                  {{ step.done ? '已就绪' : '待处理' }}
                </UBadge>
              </div>

              <div class="mt-3 flex justify-end">
                <UButton size="sm" variant="outline" :to="step.actionTo" @click="handleSetupAction(step)">
                  {{ step.actionLabel }}
                </UButton>
              </div>
            </div>
          </div>
        </div>
      </UPageCard>

      <div class="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <UPageCard title="当前比赛概览" icon="i-lucide-clipboard-list">
          <div v-if="selectedAdminOverview" class="space-y-4">
            <div class="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div class="text-lg font-medium">
                  {{ selectedAdminOverview.game.name }}
                </div>
                <div class="mt-1 text-sm text-muted">
                  {{ new Date(selectedAdminOverview.game.start_time).toLocaleString() }} - {{ new Date(selectedAdminOverview.game.end_time).toLocaleString() }}
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                <UBadge :color="selectedAdminOverview.game.status === 'active' ? 'success' : selectedAdminOverview.game.status === 'draft' ? 'warning' : 'neutral'" variant="soft">
                  {{ selectedAdminOverview.game.status }}
                </UBadge>
                <UBadge :color="selectedAdminOverview.game.is_public ? 'info' : 'neutral'" variant="soft">
                  {{ selectedAdminOverview.game.is_public ? '公开比赛' : '私有比赛' }}
                </UBadge>
                <UBadge :color="selectedAdminOverview.game.practice_mode ? 'success' : 'neutral'" variant="soft">
                  {{ getPracticeModeLabel(selectedAdminOverview.game.practice_mode) }}
                </UBadge>
              </div>
            </div>

            <UPageGrid :cols="{ default: 1, sm: 2, xl: 3 }">
              <UPageCard title="挂题数量" :description="`${selectedAdminOverview.mountedChallengeCount} 道`" icon="i-lucide-link" />
              <UPageCard title="参赛队伍" :description="`${selectedAdminOverview.participantCount} 支`" icon="i-lucide-users" />
              <UPageCard title="已通过报名" :description="`${selectedAdminOverview.acceptedParticipantCount} 支`" icon="i-lucide-circle-check-big" />
              <UPageCard title="待审核报名" :description="`${selectedAdminOverview.pendingParticipantCount} 支`" icon="i-lucide-hourglass" />
              <UPageCard title="已拒绝报名" :description="`${selectedAdminOverview.rejectedParticipantCount} 支`" icon="i-lucide-circle-x" />
              <UPageCard title="Writeup 记录" :description="`${selectedAdminOverview.writeupCount} 份`" icon="i-lucide-file-text" />
            </UPageGrid>

            <div class="flex flex-wrap gap-2">
              <UButton size="sm" variant="outline" icon="i-lucide-sliders-horizontal" to="#game-settings">
                去比赛设置
              </UButton>
              <UButton size="sm" variant="outline" icon="i-lucide-link" to="#attach-challenge">
                去挂题
              </UButton>
              <UButton size="sm" variant="outline" icon="i-lucide-arrow-up-right" :to="`/games/${selectedAdminOverview.game.id}`">
                打开公开页
              </UButton>
            </div>
          </div>

          <UEmpty
            v-else
            icon="i-lucide-clipboard-list"
            title="还没有选中比赛"
            description="先在下方任意比赛选择框里选中一场比赛，或直接从资源列表点“编辑”，这里就会变成该比赛的一屏概览。"
          >
            <template v-if="adminSetupContextMeta" #footer>
              <div class="space-y-3">
                <UAlert
                  color="info"
                  variant="soft"
                  icon="i-lucide-route"
                  title="已有可继续配置的比赛"
                  :description="adminSetupContextMeta.description"
                />
                <div class="flex flex-wrap justify-center gap-2">
                  <UButton
                    size="sm"
                    variant="outline"
                    @click="selectGameContext(adminSetupContextMeta.game.id); jumpToAdminAnchor(adminSetupContextMeta.actionTo)"
                  >
                    {{ adminSetupContextMeta.actionLabel }}
                  </UButton>
                  <UButton
                    size="sm"
                    variant="ghost"
                    @click="selectGameContext(adminSetupContextMeta.game.id)"
                  >
                    只选中 {{ adminSetupContextMeta.game.name }}
                  </UButton>
                </div>
              </div>
            </template>
          </UEmpty>
        </UPageCard>

        <UPageCard title="赛前检查" icon="i-lucide-shield-alert">
          <div v-if="selectedGamePreflightChecks.length" class="space-y-3">
            <UAlert
              color="info"
              variant="soft"
              title="开赛前先确认这几项"
              description="这里只保留当前最影响公开运行的检查项，便于快速判断是否可以继续发布。"
            />

            <div
              v-for="check in selectedGamePreflightChecks"
              :key="check.key"
              class="rounded-lg border border-default px-3 py-3"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <UIcon
                      :name="check.done ? 'i-lucide-circle-check-big' : 'i-lucide-circle-alert'"
                      :class="check.done ? 'text-success' : 'text-warning'"
                      class="size-4 shrink-0"
                    />
                    <div class="font-medium">
                      {{ check.label }}
                    </div>
                  </div>
                  <div class="mt-2 text-sm text-muted">
                    {{ check.description }}
                  </div>
                </div>
                <UBadge :color="check.done ? 'success' : 'warning'" variant="soft">
                  {{ check.done ? '通过' : '待补' }}
                </UBadge>
              </div>

              <div v-if="check.actionLabel && check.actionTo" class="mt-3 flex justify-end">
                <UButton size="sm" variant="outline" :to="check.actionTo" @click="handlePreflightAction(check)">
                  {{ check.actionLabel }}
                </UButton>
              </div>
            </div>
          </div>

          <UEmpty
            v-else
            icon="i-lucide-shield-alert"
            title="还没有可检查的比赛"
            description="先选择一场比赛，这里会根据挂题、报名状态和公开配置给出当前最值得补的检查项。"
          />
        </UPageCard>
      </div>

      <UPageCard
        v-if="localDockerInstanceChecklist.length"
        title="容器实例检查清单"
        icon="i-lucide-container"
        id="local-docker-checklist"
      >
        <div class="space-y-3">
          <UAlert
            color="info"
            variant="soft"
            title="当前比赛包含容器实例题"
            description="按这组检查项确认报名、实例启动、入口回填和资源回收状态。"
          />

          <div
            v-for="item in localDockerInstanceChecklist"
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
                    {{ item.label }}
                  </div>
                </div>
                <div class="mt-2 text-sm text-muted">
                  {{ item.description }}
                </div>
              </div>
              <UBadge :color="item.done ? 'success' : 'warning'" variant="soft">
                {{ item.done ? '已完成' : '待检查' }}
              </UBadge>
            </div>

            <div class="mt-3 flex justify-end">
              <UButton size="sm" variant="outline" :to="item.actionTo">
                {{ item.actionLabel }}
              </UButton>
            </div>
          </div>
        </div>
      </UPageCard>

      <UPageCard title="赛事监控" icon="i-lucide-activity" id="monitoring">
        <div v-if="selectedAdminOverview" class="space-y-5">
          <div class="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div class="text-lg font-medium">
                {{ selectedAdminOverview.game.name }}
              </div>
              <div class="mt-1 text-sm text-muted">
                当前比赛的提交流、待处理项和运行状态。
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <UButton
                size="sm"
                variant="outline"
                icon="i-lucide-refresh-cw"
                :loading="loadingSubmissions || loadingCheatClues || loadingAnnouncements || loadingParticipants || loadingInstances"
                @click="selectGameContext(selectedAdminOverview.game.id)"
              >
                刷新监控
              </UButton>
              <UButton
                size="sm"
                variant="outline"
                icon="i-lucide-arrow-up-right"
                :to="`/games/${selectedAdminOverview.game.id}`"
              >
                打开公开页
              </UButton>
            </div>
          </div>

          <UPageGrid :cols="{ default: 1, sm: 2, xl: 3 }">
            <UPageCard
              v-for="stat in selectedMonitorStats"
              :key="stat.label"
              :title="stat.value"
              :description="stat.label"
              :icon="stat.icon"
            />
          </UPageGrid>

          <div v-if="monitorFocusItems.length" class="grid gap-3 xl:grid-cols-2">
            <div
              v-for="item in monitorFocusItems"
              :key="item.key"
              class="rounded-lg border border-default px-3 py-3"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="font-medium">
                    {{ item.title }}
                  </div>
                  <div class="mt-2 text-sm text-muted">
                    {{ item.description }}
                  </div>
                </div>
                <UBadge :color="item.color" variant="soft">
                  {{ item.badge }}
                </UBadge>
              </div>

              <div class="mt-3 flex justify-end">
                <UButton
                  size="sm"
                  variant="outline"
                  @click="item.to.startsWith('#') ? jumpToAdminAnchor(item.to) : navigateTo(item.to)"
                >
                  立即处理
                </UButton>
              </div>
            </div>
          </div>

          <UTabs v-model="activeMonitorTab" :items="monitorTabItems" />

          <div v-if="activeMonitorTab === 'overview'" class="grid gap-4 xl:grid-cols-3">
            <div class="rounded-lg border border-default px-3 py-3 xl:col-span-2">
              <div class="mb-3 flex items-center justify-between gap-2">
                <div class="font-medium">
                  待处理事项
                </div>
                <div class="flex items-center gap-2">
                  <UBadge color="warning" variant="soft">
                    报名 {{ participants.filter(item => item.status === 'pending').length }}
                  </UBadge>
                  <UBadge color="info" variant="soft">
                    Writeup {{ writeups.filter(item => item.status === 'submitted').length }}
                  </UBadge>
                </div>
              </div>

              <div class="grid gap-3 xl:grid-cols-2">
                <div class="rounded-md bg-elevated/60 px-3 py-3">
                  <div class="mb-2 flex items-center justify-between gap-2">
                    <div class="text-sm font-medium">
                      报名审核
                    </div>
                    <UBadge color="warning" variant="soft">
                      {{ participants.filter(item => item.status === 'pending').length }}
                    </UBadge>
                  </div>
                  <div v-if="participants.some(item => item.status === 'pending')" class="space-y-2">
                    <div
                      v-for="participant in participants.filter(item => item.status === 'pending').slice(0, 4)"
                      :key="participant.team_id"
                      class="rounded-md bg-default px-3 py-2"
                    >
                      <div class="text-sm font-medium">
                        {{ participant.team_name }}
                      </div>
                      <div class="text-xs text-muted">
                        {{ new Date(participant.joined_at).toLocaleString() }}
                      </div>
                    </div>
                  </div>
                  <UEmpty
                    v-else
                    icon="i-lucide-hourglass"
                    title="没有待审核报名"
                    description="新的报名提交后，会自动出现在这里。"
                    :actions="[{
                      label: '查看参赛队伍',
                      icon: 'i-lucide-users',
                      color: 'neutral',
                      variant: 'outline',
                      onClick: () => jumpToAdminAnchor('#participants'),
                    }]"
                  />
                </div>

                <div class="rounded-md bg-elevated/60 px-3 py-3">
                  <div class="mb-2 flex items-center justify-between gap-2">
                    <div class="text-sm font-medium">
                      Writeup 审核
                    </div>
                    <UBadge color="info" variant="soft">
                      {{ writeups.filter(item => item.status === 'submitted').length }}
                    </UBadge>
                  </div>
                  <div v-if="writeups.some(item => item.status === 'submitted')" class="space-y-2">
                    <div
                      v-for="writeup in writeups.filter(item => item.status === 'submitted').slice(0, 4)"
                      :key="writeup.team_id"
                      class="rounded-md bg-default px-3 py-2"
                    >
                      <div class="text-sm font-medium">
                        {{ writeup.team_name }}
                      </div>
                      <div class="text-xs text-muted">
                        {{ new Date(writeup.submitted_at).toLocaleString() }}
                      </div>
                    </div>
                  </div>
                  <UEmpty
                    v-else
                    icon="i-lucide-file-check"
                    title="没有待审 Writeup"
                    description="新的 Writeup 提交后，会自动出现在这里。"
                    :actions="[{
                      label: '打开 Writeup 审核',
                      icon: 'i-lucide-file-text',
                      color: 'neutral',
                      variant: 'outline',
                      onClick: () => jumpToAdminAnchor('#writeups'),
                    }]"
                  />
                </div>
              </div>
            </div>

            <div class="rounded-lg border border-default px-3 py-3">
              <div class="mb-3 flex items-center justify-between gap-2">
                <div class="font-medium">
                  最新公告
                </div>
                <UBadge color="info" variant="soft">
                  {{ announcements.length }}
                </UBadge>
              </div>
              <div v-if="announcements.length" class="space-y-2">
                <div
                  v-for="announcement in announcements.slice(0, 3)"
                  :key="announcement.id"
                  class="rounded-md bg-elevated/60 px-3 py-2"
                >
                  <div class="text-xs text-muted">
                    {{ new Date(announcement.created_at).toLocaleString() }}
                  </div>
                  <div class="mt-1 text-sm line-clamp-3">
                    {{ announcement.content }}
                  </div>
                </div>
              </div>
              <UEmpty
                v-else
                icon="i-lucide-megaphone"
                title="当前还没有公告"
                description="这场比赛还没有发布赛时通知。可以补一条开赛提醒、规则补充或维护公告，方便参赛队伍同步状态。"
                :actions="[{
                  label: '去公告区',
                  icon: 'i-lucide-send',
                  color: 'neutral',
                  variant: 'outline',
                  onClick: () => { activeMonitorTab = 'ops' },
                }]"
              />
            </div>

            <div class="rounded-lg border border-default px-3 py-3 xl:col-span-3">
              <div class="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div class="font-medium">
                    实例监控
                  </div>
                  <div class="text-sm text-muted">
                    当前比赛下所有动态实例租约，可用于判断是否有队伍实例已经过期。
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <UBadge color="success" variant="soft">
                    运行中 {{ instanceLeases.filter(item => !item.is_expired).length }}
                  </UBadge>
                  <UBadge color="warning" variant="soft">
                    已过期 {{ instanceLeases.filter(item => item.is_expired).length }}
                  </UBadge>
                </div>
              </div>

              <div v-if="instanceLeases.length" class="space-y-2">
                <div
                  v-for="lease in instanceLeases"
                  :key="lease.id"
                  class="rounded-md bg-elevated/60 px-3 py-3"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="text-sm font-medium">
                        {{ lease.team_name }} · {{ lease.challenge_title }}
                      </div>
                      <div class="mt-1 text-xs text-muted">
                        Team #{{ lease.team_id }} · Challenge #{{ lease.challenge_id }}{{ lease.provider ? ` · ${lease.provider}` : '' }}{{ lease.image ? ` · ${lease.image}` : '' }}
                      </div>
                      <div class="mt-2 flex flex-wrap items-center gap-2">
                        <UBadge :color="getInstanceLeaseProviderColor(lease)" variant="soft">
                          {{ getInstanceLeaseProviderLabel(lease) }}
                        </UBadge>
                        <UBadge v-if="lease.host && lease.port" color="neutral" variant="subtle">
                          {{ lease.host }}:{{ lease.port }}
                        </UBadge>
                      </div>
                      <div class="mt-2 grid gap-2 text-xs text-muted md:grid-cols-2 xl:grid-cols-4">
                        <div>启动：{{ new Date(lease.started_at).toLocaleString() }}</div>
                        <div>续期：{{ new Date(lease.last_renewed_at).toLocaleString() }}</div>
                        <div>到期：{{ new Date(lease.expires_at).toLocaleString() }}</div>
                        <div>{{ lease.is_expired ? '当前已过期' : `剩余 ${lease.seconds_left} 秒` }}</div>
                      </div>
                      <div v-if="lease.host || lease.port" class="mt-2 text-xs text-muted">
                        当前入口主机：{{ lease.host || '未返回 host' }}<template v-if="lease.port">:{{ lease.port }}</template>
                      </div>
                      <div v-if="lease.launch_url" class="mt-2 text-xs text-muted break-all">
                        入口：{{ lease.launch_url }}
                      </div>
                    </div>
                    <div class="flex shrink-0 flex-col items-end gap-2">
                      <UBadge :color="getInstanceLeaseStatusColor(lease)" variant="soft">
                        {{ getInstanceLeaseStatusLabel(lease) }}
                      </UBadge>
                      <UButton
                        v-if="lease.launch_url"
                        size="xs"
                        variant="ghost"
                        icon="i-lucide-arrow-up-right"
                        :to="lease.launch_url"
                        target="_blank"
                      >
                        打开
                      </UButton>
                      <UButton
                        size="xs"
                        variant="ghost"
                        icon="i-lucide-copy"
                        @click="copyInstanceLeaseEntry(lease)"
                      >
                        复制入口
                      </UButton>
                      <UButton
                        size="xs"
                        color="error"
                        variant="soft"
                        icon="i-lucide-trash-2"
                        :loading="deletingInstanceLeaseId === lease.id"
                        @click="destroyInstanceLease(lease.id)"
                      >
                        销毁
                      </UButton>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else-if="loadingInstances" class="text-sm text-muted">
                正在加载实例租约...
              </div>
              <UEmpty
                v-else
                icon="i-lucide-box"
                title="当前还没有实例租约"
                description="当前比赛下还没有运行中的动态实例。等队伍启动实例后，这里会显示租约状态、入口和到期时间。"
                :actions="[{
                  label: '打开公开页',
                  icon: 'i-lucide-arrow-up-right',
                  to: selectedAdminOverview ? `/games/${selectedAdminOverview.game.id}` : '/games',
                  color: 'neutral',
                  variant: 'outline',
                }]"
              />
            </div>
          </div>

          <div v-else-if="activeMonitorTab === 'scoreboard'" class="space-y-4">
            <UAlert
              :color="scoreboardFrozen ? 'warning' : 'info'"
              variant="soft"
              title="当前榜单视图"
              :description="scoreboardViewDescription"
            />

            <UPageGrid :cols="{ default: 1, sm: 2, xl: 4 }">
              <UPageCard
                v-for="card in scoreboardSummaryCards"
                :key="card.label"
                :title="card.value"
                :description="card.label"
                :icon="card.icon"
              >
                <template #footer>
                  <div class="text-xs text-muted">
                    {{ card.hint }}
                  </div>
                </template>
              </UPageCard>
            </UPageGrid>

            <div class="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
              <UPageCard title="队伍榜单" icon="i-lucide-trophy">
                <div class="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <UFormField label="查看分组" name="scoreboard-division" class="max-w-sm">
                    <USelect
                      v-model="selectedScoreboardDivision"
                      :items="scoreboardDivisionOptions"
                      class="w-full"
                    />
                  </UFormField>

                  <div class="flex flex-wrap gap-2">
                    <UButton
                      size="sm"
                      variant="outline"
                      icon="i-lucide-refresh-cw"
                      :loading="loadingScoreboard"
                      @click="loadScoreboard"
                    >
                      刷新榜单
                    </UButton>
                    <UButton
                      v-if="selectedGame"
                      size="sm"
                      variant="outline"
                      icon="i-lucide-download"
                      :loading="exportingScoreboardGameId === selectedGame.id"
                      @click="exportScoreboard(selectedGame.id, selectedScoreboardDivision || undefined)"
                    >
                      导出榜单
                    </UButton>
                  </div>
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
                  :data="scoreboardEntries"
                  :columns="[
                    { accessorKey: 'rank', header: '#' },
                    { accessorKey: 'team_name', header: '队伍' },
                    { accessorKey: 'score', header: '分数' },
                    { accessorKey: 'solve_count', header: '解题数' },
                    { accessorKey: 'last_solve', header: '最后解题' },
                  ]"
                  :loading="loadingScoreboard"
                  :empty-state="{ icon: 'i-lucide-trophy', label: '当前没有榜单数据' }"
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

              <UPageCard title="分题观察" icon="i-lucide-chart-column-big">
                <div v-if="scoreboardCategoryGroups.length" class="space-y-4">
                  <div
                    v-for="group in scoreboardCategoryGroups"
                    :key="group.category"
                    class="rounded-lg border border-default px-3 py-3"
                  >
                    <div class="mb-3 flex items-center justify-between gap-2">
                      <div class="font-medium">
                        {{ group.category.toUpperCase() }}
                      </div>
                      <UBadge color="info" variant="soft">
                        {{ group.items.length }} 道题
                      </UBadge>
                    </div>

                    <div class="space-y-2">
                      <div
                        v-for="challenge in group.items"
                        :key="challenge.id"
                        class="rounded-md bg-elevated/60 px-3 py-2 text-sm"
                      >
                        <div class="flex items-center justify-between gap-3">
                          <div class="font-medium">
                            {{ challenge.title }}
                          </div>
                          <UBadge :color="challenge.blood_team ? 'error' : 'neutral'" variant="soft">
                            {{ challenge.score }} pts
                          </UBadge>
                        </div>
                        <div class="mt-2 grid gap-2 text-muted">
                          <div>解出队伍：{{ challenge.solved_count }}</div>
                          <div>一血队伍：{{ challenge.blood_team || '暂无' }}</div>
                          <div>二血队伍：{{ challenge.second_blood_team || '暂无' }}</div>
                          <div>三血队伍：{{ challenge.third_blood_team || '暂无' }}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              <div v-else class="text-sm text-muted">
                当前还没有可展示的分题统计。
              </div>
              </UPageCard>
            </div>
          </div>

          <div v-else-if="activeMonitorTab === 'submissions'" class="space-y-3">
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div class="text-sm text-muted">
                保留最近提交的即时视角，可在开赛后快速观察正确率与重复提交流量。
              </div>
              <div class="flex items-center gap-2">
                <USelect
                  v-model="submissionFilters.type"
                  :items="submissionTypeOptions"
                  size="sm"
                  class="w-36"
                />
                <USelect
                  v-model="submissionFilters.count"
                  :items="[
                    { label: '20 条', value: 20 },
                    { label: '50 条', value: 50 },
                    { label: '100 条', value: 100 },
                    { label: '200 条', value: 200 },
                  ]"
                  size="sm"
                  class="w-28"
                />
              </div>
            </div>

            <div v-if="submissions.length" class="space-y-2">
              <div
                v-for="submission in submissions.slice(0, 12)"
                :key="submission.id"
                class="rounded-lg border border-default px-3 py-3 text-sm"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="font-medium">
                    {{ submission.team_name }} · {{ submission.challenge_title }}
                  </div>
                  <UBadge :color="getSubmissionResultColor(submission.result)" variant="soft">
                    {{ getSubmissionResultLabel(submission.result) }}
                  </UBadge>
                </div>
                <div class="mt-2 grid gap-2 text-muted md:grid-cols-2">
                  <div>选手：{{ submission.username }} (#{{ submission.user_id }})</div>
                  <div>分类：{{ submission.category }}{{ submission.is_practice ? ' · 练习模式' : '' }}</div>
                  <div>提交时间：{{ new Date(submission.submitted_at).toLocaleString() }}</div>
                  <div>得分：{{ submission.score }}{{ submission.blood_type ? ` · ${submission.blood_type}` : '' }}</div>
                </div>
                <div class="mt-2 text-muted">
                  结果说明：{{ submission.message || '无' }}
                </div>
              </div>
            </div>
            <div v-else class="text-sm text-muted">
              这场比赛还没有提交记录。
            </div>
          </div>

          <div v-else-if="activeMonitorTab === 'clues'" class="space-y-3">
            <UAlert
              color="warning"
              variant="soft"
              title="当前线索仅基于跨队重复错误 Flag"
              description="这是轻量版排查入口，先帮你定位最值得复核的题目与 Flag 传播迹象。"
            />

            <div v-if="cheatClues.length" class="space-y-2">
              <div
                v-for="clue in cheatClues"
                :key="`${clue.challenge_id}-${clue.submitted_flag}`"
                class="rounded-lg border border-default px-3 py-3 text-sm"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="font-medium">
                    {{ clue.challenge_title }} · {{ clue.team_count }} 支队伍
                  </div>
                  <UBadge color="warning" variant="soft">
                    {{ clue.submission_count }} 次重复错误提交
                  </UBadge>
                </div>
                <div class="mt-2 text-muted break-all">
                  错误 Flag：{{ clue.submitted_flag }}
                </div>
                <div class="mt-2 grid gap-2 text-muted md:grid-cols-2">
                  <div>首次出现：{{ new Date(clue.first_seen_at).toLocaleString() }}</div>
                  <div>最近出现：{{ new Date(clue.last_seen_at).toLocaleString() }}</div>
                </div>
                <div class="mt-2 text-muted">
                  涉及队伍：{{ clue.teams.join(' / ') }}
                </div>
              </div>
            </div>
            <div v-else class="text-sm text-muted">
              当前还没有发现跨队重复错误 Flag 的线索。
            </div>
          </div>

          <div v-else-if="activeMonitorTab === 'timeline'" class="space-y-3">
            <UAlert
              color="info"
              variant="soft"
              title="时间线会混合展示公告、正确提交与可疑线索"
              description="可在赛时快速回放最近发生了什么，帮助管理员判断是正常比赛推进，还是需要插入运维或排查动作。"
            />

            <div v-if="selectedMonitorTimeline.length" class="space-y-2">
              <div
                v-for="item in selectedMonitorTimeline"
                :key="item.key"
                class="rounded-lg border border-default px-3 py-3"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <UIcon :name="item.icon" :class="`size-4 text-${item.color}`" />
                      <div class="font-medium">
                        {{ item.title }}
                      </div>
                    </div>
                    <div class="mt-2 text-sm text-muted whitespace-pre-wrap break-all">
                      {{ item.description }}
                    </div>
                  </div>
                  <div class="shrink-0 text-right">
                    <UBadge :color="item.color" variant="soft">
                      {{ item.badge }}
                    </UBadge>
                    <div class="mt-2 text-xs text-muted">
                      {{ new Date(item.occurredAt).toLocaleString() }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="text-sm text-muted">
              当前还没有可串到时间线里的赛时事件。
            </div>
          </div>

          <div v-else class="grid gap-4 xl:grid-cols-2">
            <div class="rounded-lg border border-default px-3 py-3">
              <div class="mb-3 flex items-center justify-between gap-2">
                <div class="font-medium">
                  赛后归档
                </div>
                <UBadge color="info" variant="soft">
                  ZIP
                </UBadge>
              </div>
              <div class="space-y-2 text-sm text-muted">
                <p>这里可以把当前比赛的配置、榜单、Writeup 和提交记录统一下载下来，用于赛后复盘、存档或交付。</p>
                <p v-if="selectedScoreboardDivision">
                  当前榜单导出会跟随“榜单”标签里的分组选择：{{ selectedScoreboardDivision }}。
                </p>
              </div>
              <div v-if="selectedAdminOverview" class="mt-3 grid gap-2 md:grid-cols-2">
                <UButton
                  size="sm"
                  variant="outline"
                  icon="i-lucide-package"
                  :loading="exportingGameId === selectedAdminOverview.game.id"
                  @click="exportGame(selectedAdminOverview.game.id)"
                >
                  导出比赛包
                </UButton>
                <UButton
                  size="sm"
                  variant="outline"
                  icon="i-lucide-trophy"
                  :loading="exportingScoreboardGameId === selectedAdminOverview.game.id"
                  @click="exportScoreboard(selectedAdminOverview.game.id, selectedScoreboardDivision || undefined)"
                >
                  导出榜单包
                </UButton>
                <UButton
                  size="sm"
                  variant="outline"
                  icon="i-lucide-file-text"
                  :loading="exportingWriteupsGameId === selectedAdminOverview.game.id"
                  @click="exportWriteups(selectedAdminOverview.game.id)"
                >
                  导出 Writeup
                </UButton>
                <UButton
                  size="sm"
                  variant="outline"
                  icon="i-lucide-file-stack"
                  :loading="exportingSubmissionsGameId === selectedAdminOverview.game.id"
                  @click="exportSubmissions(selectedAdminOverview.game.id)"
                >
                  导出提交记录
                </UButton>
              </div>
              <div v-else class="mt-3 text-sm text-muted">
                先选中一场比赛，这里才会显示可用的归档导出动作。
              </div>
            </div>

            <div class="rounded-lg border border-default px-3 py-3">
              <div class="mb-3 flex items-center justify-between gap-2">
                <div class="font-medium">
                  公告运维
                </div>
                <UBadge color="neutral" variant="soft">
                  {{ announcements.length }}
                </UBadge>
              </div>
              <div class="space-y-2 text-sm text-muted">
                <p>用于维护当前比赛的赛时通知、规则补充和维护说明。</p>
                <p>如果比赛已经公开但仍无公告，建议至少补一条状态说明。</p>
              </div>
              <div class="mt-3 flex justify-end">
                <UButton size="sm" variant="outline" @click="jumpToAdminAnchor('#announcements')">
                  去公告区
                </UButton>
              </div>
            </div>

            <div class="rounded-lg border border-default px-3 py-3">
              <div class="mb-3 flex items-center justify-between gap-2">
                <div class="font-medium">
                  比赛出口
                </div>
                <UBadge :color="selectedAdminOverview.game.status === 'active' ? 'success' : 'warning'" variant="soft">
                  {{ selectedAdminOverview.game.status }}
                </UBadge>
              </div>
              <div class="space-y-2 text-sm text-muted">
                <p>继续配置时，可直接回到比赛设置、挂题和参赛队伍区。</p>
                <p>如果已经开赛，可以直接打开公开页观察报名、题目和排行榜状态。</p>
              </div>
              <div class="mt-3 flex flex-wrap justify-end gap-2">
                <UButton size="sm" variant="outline" @click="jumpToAdminAnchor('#game-settings')">
                  比赛设置
                </UButton>
                <UButton size="sm" variant="outline" :to="`/games/${selectedAdminOverview.game.id}`">
                  打开公开页
                </UButton>
              </div>
            </div>
          </div>
        </div>

        <UEmpty
          v-else
          icon="i-lucide-activity"
          title="还没有可监控的比赛"
          description="先选中一场比赛，这里会把最近提交、可疑线索、报名和公告收拢成一块赛事监控面板。"
        />
      </UPageCard>

      <UPageCard id="create-game" title="比赛录入" icon="i-lucide-trophy">
        <div class="space-y-4">
          <UAlert
            color="info"
            variant="soft"
            title="比赛基础信息通过弹层录入"
            description="创建、编辑和导入统一收进弹层处理；页面主体只保留状态、设置、审核和监控视图。"
          />

          <div class="flex flex-wrap gap-2">
            <UButton icon="i-lucide-plus" @click="createGameModalOpen = true">
              创建比赛
            </UButton>
            <UButton
              icon="i-lucide-wand-sparkles"
              variant="outline"
              @click="fillStarterGameTemplate(); createGameModalOpen = true"
            >
              使用基础模板
            </UButton>
            <UButton icon="i-lucide-pencil-line" variant="outline" @click="gameEditModalOpen = true">
              编辑比赛信息
            </UButton>
            <UButton icon="i-lucide-upload" variant="ghost" @click="importModalOpen = true">
              导入比赛包
            </UButton>
          </div>

          <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div class="rounded-lg border border-default px-3 py-3 text-sm text-muted">
              <div class="mb-2 font-medium text-highlighted">
                新建比赛默认会进入草稿状态
              </div>
              <ul class="space-y-2">
                <li>建议先完成题目录入、挂题和公开页检查，再切换到 `active`。</li>
                <li>需要快速起步时，可先载入基础模板，再在弹层里补齐正式时间、规则和公告。</li>
              </ul>
            </div>

            <div class="rounded-lg border border-default px-3 py-3 text-sm text-muted">
              <div class="mb-2 font-medium text-highlighted">
                当前上下文
              </div>
              <div v-if="selectedEditableGame">
                {{ selectedEditableGame.name }} · {{ selectedEditableGame.status }}
              </div>
              <div v-else>
                还没有选中比赛。可直接创建新比赛，或从资源列表选择现有比赛进入维护上下文。
              </div>
            </div>
          </div>
        </div>
      </UPageCard>

      <div class="grid gap-6 xl:grid-cols-2">
        <UPageCard id="game-settings" title="比赛设置" icon="i-lucide-sliders-horizontal">
          <UForm :state="gameSettingsForm" class="space-y-4" @submit="updateGameSettings">
            <UFormField label="选择比赛" name="game_id">
              <USelect
                v-model="gameSettingsForm.game_id"
                :items="gameOptions"
                class="w-full"
                placeholder="选择一个比赛"
              />
            </UFormField>

            <UFormField label="比赛状态" name="status">
              <USelect
                v-model="gameSettingsForm.status"
                :items="gameStatusOptions"
                class="w-full"
              />
            </UFormField>

            <UFormField label="比赛邀请码" name="invitation_code" description="公开接口只会暴露“需要邀请码”，不会返回这里的明文">
              <UInput v-model="gameSettingsForm.invitation_code" class="w-full" placeholder="留空表示不需要邀请码" />
            </UFormField>

            <UFormField label="比赛分组" name="divisions_text" description="按行或逗号分隔，榜单和参赛分配都会使用这里的分组">
              <UTextarea v-model="gameSettingsForm.divisions_text" class="w-full" :rows="3" placeholder="本科组, 公开组" />
            </UFormField>

            <UFormField label="封榜时间" name="scoreboard_freeze_at" description="留空表示不封榜；到达这个时间后公开榜单冻结，但比赛仍可继续提交">
              <UInput v-model="gameSettingsForm.scoreboard_freeze_at" type="datetime-local" class="w-full" />
            </UFormField>

            <UFormField label="报名模式" name="registration_mode" description="决定队伍报名后是直接获得参赛资格，还是进入待审核">
              <USelect
                v-model="gameSettingsForm.registration_mode"
                :items="registrationModeOptions"
                class="w-full"
              />
            </UFormField>

            <UFormField label="队伍人数上限" name="max_team_members" description="0 表示不限制">
              <UInput v-model.number="gameSettingsForm.max_team_members" type="number" min="0" class="w-full" />
            </UFormField>

            <UFormField label="Writeup 截止时间" name="writeup_deadline" description="留空表示不额外设置截止时间；如果填写，应晚于比赛结束时间">
              <UInput v-model="gameSettingsForm.writeup_deadline" type="datetime-local" class="w-full" />
            </UFormField>

            <div class="grid gap-4 md:grid-cols-3">
              <UFormField label="公开比赛" name="is_public">
                <USwitch v-model="gameSettingsForm.is_public" />
              </UFormField>

              <UFormField label="启用赛后练习" name="practice_mode">
                <USwitch v-model="gameSettingsForm.practice_mode" />
              </UFormField>

              <UFormField label="要求 Writeup" name="writeup_required">
                <USwitch v-model="gameSettingsForm.writeup_required" />
              </UFormField>
            </div>

            <div v-if="selectedSettingsGame" class="rounded-lg border border-default px-3 py-3 text-sm text-muted">
              当前比赛：{{ selectedSettingsGame.name }} · {{ new Date(selectedSettingsGame.start_time).toLocaleString() }} · {{ getRegistrationModeLabel(selectedSettingsGame.registration_mode) }} · {{ selectedSettingsGame.max_team_members ? `最多 ${selectedSettingsGame.max_team_members} 人` : '人数不限' }} · {{ selectedSettingsGame.invitation_required ? '需要邀请码' : '无需邀请码' }} · {{ getPracticeModeLabel(selectedSettingsGame.practice_mode) }} · {{ selectedSettingsGame.writeup_required ? '需要 Writeup' : '不要求 Writeup' }} · {{ selectedSettingsGame.scoreboard_freeze_at ? `封榜于 ${new Date(selectedSettingsGame.scoreboard_freeze_at).toLocaleString()}` : '不封榜' }}
            </div>

            <div v-if="settingsRuleSummary.length" class="rounded-lg border border-default px-3 py-3 text-sm text-muted">
              <div class="mb-2 font-medium text-highlighted">
                当前设置摘要
              </div>
              <ul class="space-y-2">
                <li v-for="item in settingsRuleSummary" :key="item">
                  {{ item }}
                </li>
              </ul>
            </div>

            <UButton type="submit" :loading="settingsSubmitting">
              保存比赛设置
            </UButton>
          </UForm>
        </UPageCard>

        <UPageCard id="create-challenge" title="题目维护" icon="i-lucide-flag">
          <div class="space-y-4">
            <UAlert
              color="info"
              variant="soft"
              title="题目录入通过弹层处理"
              description="创建、编辑和模板填充集中在这里完成，再继续挂题或回到当前比赛检查展示效果。"
            />

            <div class="flex flex-wrap gap-2">
              <UButton icon="i-lucide-plus" @click="createChallengeModalOpen = true">
                创建题目
              </UButton>
              <UButton
                icon="i-lucide-wand-sparkles"
                variant="outline"
                @click="fillStarterChallengeTemplate(); createChallengeModalOpen = true"
              >
                使用基础模板
              </UButton>
              <UButton icon="i-lucide-file-pen-line" variant="outline" @click="challengeEditModalOpen = true">
                编辑题目
              </UButton>
              <UButton icon="i-lucide-link" variant="ghost" @click="jumpToAdminAnchor('#attach-challenge')">
                去挂题
              </UButton>
            </div>

            <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div class="rounded-lg border border-default px-3 py-3 text-sm text-muted">
                <div class="mb-2 font-medium text-highlighted">
                  维护顺序
                </div>
                <ul class="space-y-2">
                  <li>先补齐题面、提示、附件和接入信息，再挂到比赛里。</li>
                  <li>动态题建议保存前先看一遍实例预览，确认入口语义和运行配置。</li>
                </ul>
              </div>

              <div class="rounded-lg border border-default px-3 py-3 text-sm text-muted">
                <div class="mb-2 font-medium text-highlighted">
                  当前上下文
                </div>
                <div v-if="selectedEditableChallenge">
                  {{ selectedEditableChallenge.title }} · {{ selectedEditableChallenge.category }}
                </div>
                <div v-else>
                  还没有选中题目。可直接创建新题，或从资源列表选择现有题目继续维护。
                </div>
              </div>
            </div>
          </div>
        </UPageCard>
      </div>

      <div class="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <UPageCard id="attach-challenge" title="比赛挂题" icon="i-lucide-link">
          <div class="mb-4 flex flex-wrap gap-2">
            <UButton icon="i-lucide-link" @click="attachChallengeModalOpen = true">
              挂载题目
            </UButton>
          </div>

          <div class="mt-6 border-t border-default pt-4">
            <div class="mb-2 text-sm font-medium">
              当前比赛题目
            </div>
            <p v-if="selectedGame" class="mb-3 text-sm text-muted">
              {{ selectedGame.name }} · {{ loadingGameChallenges ? '正在加载题目...' : `${selectedGameChallenges.length} 道已挂载` }}
            </p>
            <p v-else class="text-sm text-muted">
              先选择比赛，再查看该比赛下已挂载的题目。
            </p>

            <div v-if="selectedGameChallenges.length" class="space-y-2">
              <div
                v-for="challenge in selectedGameChallenges"
                :key="challenge.id"
                class="flex items-start justify-between gap-3 rounded-lg border border-default px-3 py-2"
              >
                <div class="min-w-0">
                  <div class="font-medium">
                    #{{ challenge.id }} {{ challenge.title }}
                  </div>
                  <div class="space-y-1 text-sm text-muted">
                    <div>
                      {{ challenge.category }} · {{ challenge.score }} 分 · {{ challenge.solve_count || 0 }} 解
                    </div>
                    <div
                      v-for="blood in getBloodRows(challenge)"
                      :key="`${challenge.id}-${blood.label}`"
                      class="flex items-center gap-2"
                    >
                      <span>{{ blood.label }}</span>
                      <span>{{ blood.team || '暂无' }}</span>
                    </div>
                  </div>
                </div>

                <UButton
                  color="error"
                  variant="soft"
                  size="sm"
                  icon="i-lucide-trash-2"
                  :loading="removingChallengeId === challenge.id"
                  @click="removeChallengeFromGame(challenge.id)"
                >
                  移除
                </UButton>
              </div>
            </div>

            <UEmpty
              v-else-if="selectedGame && !loadingGameChallenges"
              icon="i-lucide-link"
              title="这场比赛还没有挂载题目"
              description="先把现有题目挂到当前比赛，公开页里才会开始出现可见题目和分题统计。"
              :actions="[{
                label: '继续挂题',
                icon: 'i-lucide-plus',
                color: 'neutral',
                variant: 'outline',
                onClick: () => jumpToAdminAnchor('#attach-challenge'),
              }]"
            />
          </div>
        </UPageCard>

        <div class="space-y-6">
          <UPageCard title="维护入口" icon="i-lucide-briefcase" id="maintenance-actions">
            <div class="space-y-4">
              <UAlert
                color="info"
                variant="soft"
                title="低频维护动作集中在这里"
                description="导入比赛包、发布公告和跳转公开页都保留为入口动作，避免在页面主体分散重复出现。"
              />

              <div class="flex flex-wrap gap-2">
                <UButton
                  icon="i-lucide-file-up"
                  variant="outline"
                  @click="importModalOpen = true"
                >
                  导入比赛包
                </UButton>
                <UButton
                  icon="i-lucide-send"
                  variant="outline"
                  :disabled="!selectedGame"
                  @click="announcementModalOpen = true"
                >
                  发布公告
                </UButton>
                <UButton
                  icon="i-lucide-arrow-up-right"
                  variant="ghost"
                  :disabled="!selectedGame"
                  :to="selectedGame ? `/games/${selectedGame.id}` : undefined"
                >
                  打开公开页
                </UButton>
              </div>

              <div class="rounded-lg border border-default px-3 py-3 text-sm text-muted">
                <div class="mb-2 font-medium text-highlighted">
                  当前上下文
                </div>
                <div v-if="selectedGame">
                  {{ selectedGame.name }} · {{ announcements.length }} 条公告 · {{ participants.length }} 支队伍
                </div>
                <div v-else>
                  还没有选中比赛。导入比赛包不受影响；发布公告和公开页跳转需先进入某场比赛上下文。
                </div>
              </div>
            </div>
          </UPageCard>

          <UPageCard title="参赛队伍" icon="i-lucide-users" id="participants">
            <div v-if="selectedGame" class="mb-3 flex items-center justify-between gap-3">
              <div class="text-sm text-muted">
                {{ selectedGame.name }} · {{ loadingParticipants ? '正在加载队伍...' : `${participants.length} 支队伍` }}
              </div>
              <div class="flex items-center gap-2">
                <UBadge color="warning" variant="soft">
                  待审核 {{ participants.filter(item => item.status === 'pending').length }}
                </UBadge>
                <UBadge color="success" variant="soft">
                  已通过 {{ participants.filter(item => item.status === 'accepted').length }}
                </UBadge>
              </div>
            </div>
            <div v-else class="text-sm text-muted">
              先选择比赛，再查看这场比赛的参赛队伍。
            </div>

            <div v-if="participants.length" class="space-y-2">
              <div
                v-for="participant in participants"
                :key="participant.team_id"
                class="rounded-lg border border-default px-3 py-3 text-sm"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="font-medium">
                    {{ participant.team_name }}
                  </div>
                  <UBadge :color="getParticipantStatusColor(participant.status)" variant="soft">
                    {{ getParticipantStatusLabel(participant.status) }}
                  </UBadge>
                </div>
                <div class="mt-2 grid gap-2 text-muted md:grid-cols-3">
                  <div>报名时间：{{ new Date(participant.joined_at).toLocaleString() }}</div>
                  <div>当前得分：{{ participant.score }}</div>
                  <div>解题数量：{{ participant.solve_count }}</div>
                </div>
                <div class="mt-2 text-muted">
                  当前分组：{{ participant.division || '未分配' }}
                </div>
                <div class="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] md:items-end">
                  <UFormField label="参赛状态" :name="`participant-status-${participant.team_id}`">
                    <USelect
                      v-model="participantStatusDrafts[participant.team_id]"
                      :items="participantStatusOptions"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField label="所属分组" :name="`participant-division-${participant.team_id}`">
                    <USelect
                      v-if="selectedGameDivisionOptions.length"
                      v-model="participantDivisionDrafts[participant.team_id]"
                      :items="selectedGameDivisionOptions"
                      class="w-full"
                      placeholder="未分配"
                    />
                    <UInput
                      v-else
                      v-model="participantDivisionDrafts[participant.team_id]"
                      class="w-full"
                      placeholder="当前比赛未配置分组"
                      disabled
                    />
                  </UFormField>
                  <UButton
                    size="sm"
                    icon="i-lucide-check-check"
                    :loading="updatingParticipantId === participant.team_id"
                    @click="updateParticipantStatus(participant.team_id)"
                  >
                    保存状态
                  </UButton>
                  <UButton
                    color="error"
                    variant="soft"
                    size="sm"
                    icon="i-lucide-user-round-x"
                    :loading="removingParticipantId === participant.team_id"
                    @click="removeParticipant(participant.team_id)"
                  >
                    移除报名
                  </UButton>
                </div>
              </div>
            </div>

            <UEmpty
              v-else-if="selectedGame && !loadingParticipants"
              icon="i-lucide-users"
              title="这场比赛还没有参赛队伍"
              description="当前还没有队伍完成报名或通过审核。可从公开比赛页查看当前对外展示效果。"
              :actions="[{
                label: '打开公开页',
                icon: 'i-lucide-arrow-up-right',
                to: selectedGame ? `/games/${selectedGame.id}` : '/games',
                color: 'neutral',
                variant: 'outline',
              }]"
            />
          </UPageCard>

          <UPageCard title="Writeup 审核" icon="i-lucide-file-check" id="writeups">
            <div v-if="selectedGame" class="mb-3 flex items-center justify-between gap-3">
              <div class="text-sm text-muted">
                {{ selectedGame.name }} · {{ writeups.length }} 份 Writeup
              </div>
              <div class="flex items-center gap-2">
                <UBadge color="info" variant="soft">
                  待审 {{ writeups.filter(item => item.status === 'submitted').length }}
                </UBadge>
                <UButton
                  size="sm"
                  variant="ghost"
                  icon="i-lucide-download"
                  :loading="exportingWriteupsGameId === selectedGame.id"
                  @click="exportWriteups(selectedGame.id)"
                >
                  导出 Writeup
                </UButton>
              </div>
            </div>
            <div v-else class="text-sm text-muted">
              先选择比赛，再查看当前比赛的 Writeup。
            </div>

            <div v-if="writeups.length" class="space-y-3">
              <div
                v-for="writeup in writeups"
                :key="`${writeup.game_id}-${writeup.team_id}`"
                class="rounded-lg border border-default px-3 py-3 text-sm space-y-3"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="font-medium">
                    {{ writeup.team_name }}
                  </div>
                  <UBadge :color="writeup.status === 'approved' ? 'success' : writeup.status === 'rejected' ? 'error' : 'warning'" variant="soft">
                    {{ writeup.status }}
                  </UBadge>
                </div>

                <div class="text-muted leading-6 whitespace-pre-wrap">
                  {{ writeup.content }}
                </div>

                <div class="grid gap-2 text-muted md:grid-cols-2">
                  <div>提交时间：{{ new Date(writeup.submitted_at).toLocaleString() }}</div>
                  <div>审核时间：{{ writeup.reviewed_at ? new Date(writeup.reviewed_at).toLocaleString() : '未审核' }}</div>
                </div>

                <div class="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end">
                  <UFormField label="审核结果" :name="`writeup-status-${writeup.team_id}`">
                    <USelect
                      v-model="writeupReviewDrafts[writeup.team_id]"
                      :items="[
                        { label: '通过', value: 'approved' },
                        { label: '驳回', value: 'rejected' },
                      ]"
                      class="w-full"
                    />
                  </UFormField>

                  <UFormField label="审核备注" :name="`writeup-remark-${writeup.team_id}`">
                    <UInput
                      v-model="writeupRemarkDrafts[writeup.team_id]"
                      class="w-full"
                      placeholder="可选，例如：请补充关键截图"
                    />
                  </UFormField>

                  <UButton
                    size="sm"
                    icon="i-lucide-file-check-2"
                    @click="reviewWriteup(writeup.team_id)"
                  >
                    保存审核
                  </UButton>
                </div>
              </div>
            </div>

            <UEmpty
              v-else-if="selectedGame"
              icon="i-lucide-file-check"
              title="这场比赛还没有队伍提交 Writeup"
              description="当前还没有收到任何 Writeup。开启 Writeup 要求并进入赛后阶段后，这里会开始出现待审核内容。"
              :actions="[{
                label: '去比赛设置',
                icon: 'i-lucide-sliders-horizontal',
                onClick: () => jumpToAdminAnchor('#game-settings'),
                color: 'neutral',
                variant: 'outline',
              }]"
            />
          </UPageCard>

          <UPageCard title="比赛公告" icon="i-lucide-megaphone" id="announcements">
            <div v-if="selectedGame" class="mb-3 flex items-center justify-between gap-3">
              <div class="text-sm text-muted">
                {{ selectedGame.name }} · {{ loadingAnnouncements ? '正在加载公告...' : `${announcements.length} 条公告` }}
              </div>
              <div class="flex items-center gap-2">
                <UButton
                  icon="i-lucide-send"
                  size="sm"
                  variant="outline"
                  @click="announcementModalOpen = true"
                >
                  发布公告
                </UButton>
              </div>
            </div>
            <div v-else class="text-sm text-muted">
              先选择比赛，再为当前比赛发布公告。
            </div>

            <div v-if="selectedGame" class="space-y-4">
              <div v-if="announcements.length" class="space-y-2">
                <div
                  v-for="announcement in announcements"
                  :key="announcement.id"
                  class="rounded-lg border border-default px-3 py-3 text-sm"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <div class="text-muted text-xs">
                        {{ new Date(announcement.created_at).toLocaleString() }}
                      </div>
                      <div class="mt-2 whitespace-pre-wrap leading-6">
                        {{ announcement.content }}
                      </div>
                    </div>
                    <UButton
                      color="error"
                      variant="soft"
                      size="sm"
                      icon="i-lucide-trash-2"
                      :loading="deletingAnnouncementId === announcement.id"
                      @click="deleteAnnouncement(announcement.id)"
                    >
                      删除
                    </UButton>
                  </div>
                </div>
              </div>

              <UEmpty
                v-else-if="!loadingAnnouncements"
                icon="i-lucide-megaphone"
                title="当前还没有比赛公告"
                description="这场比赛还没有对外发布通知。你可以在上方直接补充开赛提醒、规则变更或维护说明。"
              />
            </div>
          </UPageCard>

          <UPageCard title="最近提交" icon="i-lucide-logs" id="submissions">
            <div v-if="selectedGame" class="mb-3 flex items-center justify-between gap-3">
              <div class="text-sm text-muted">
                {{ selectedGame.name }} · {{ loadingSubmissions ? '正在加载提交记录...' : `最近 ${submissions.length} 条` }}
              </div>
              <div class="flex items-center gap-2">
                <USelect
                  v-model="submissionFilters.type"
                  :items="submissionTypeOptions"
                  size="sm"
                  class="w-36"
                />
                <USelect
                  v-model="submissionFilters.count"
                  :items="[
                    { label: '20 条', value: 20 },
                    { label: '50 条', value: 50 },
                    { label: '100 条', value: 100 },
                    { label: '200 条', value: 200 },
                  ]"
                  size="sm"
                  class="w-28"
                />
                <UButton
                  size="sm"
                  variant="ghost"
                  icon="i-lucide-refresh-cw"
                  :loading="loadingSubmissions"
                  @click="loadSubmissions"
                >
                  刷新
                </UButton>
              </div>
            </div>
            <div v-else class="text-sm text-muted">
              先选择比赛，再查看当前比赛的最近提交。
            </div>

            <div v-if="submissions.length" class="space-y-2">
              <div
                v-for="submission in submissions"
                :key="submission.id"
                class="rounded-lg border border-default px-3 py-3 text-sm"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="font-medium">
                    {{ submission.team_name }} · {{ submission.challenge_title }}
                  </div>
                  <UBadge :color="getSubmissionResultColor(submission.result)" variant="soft">
                    {{ getSubmissionResultLabel(submission.result) }}
                  </UBadge>
                </div>
                <div class="mt-2 grid gap-2 text-muted md:grid-cols-2">
                  <div>选手：{{ submission.username }} (#{{ submission.user_id }})</div>
                  <div>分类：{{ submission.category }}{{ submission.is_practice ? ' · 练习模式' : '' }}</div>
                  <div>提交时间：{{ new Date(submission.submitted_at).toLocaleString() }}</div>
                  <div>得分：{{ submission.score }}{{ submission.blood_type ? ` · ${submission.blood_type}` : '' }}</div>
                </div>
                <div class="mt-2 text-muted">
                  结果说明：{{ submission.message || '无' }}
                </div>
              </div>
            </div>

            <UEmpty
              v-else-if="selectedGame && !loadingSubmissions"
              icon="i-lucide-logs"
              title="这场比赛还没有提交记录"
              description="当前还没有队伍提交题目。等比赛开始并产生提交后，这里会同步显示最新记录。"
              :actions="[{
                label: '查看公开页',
                icon: 'i-lucide-arrow-up-right',
                to: selectedGame ? `/games/${selectedGame.id}` : '/games',
                color: 'neutral',
                variant: 'outline',
              }]"
            />
          </UPageCard>

          <UPageCard title="可疑提交线索" icon="i-lucide-shield-alert">
            <div v-if="selectedGame" class="mb-3 flex items-center justify-between gap-3">
              <div class="text-sm text-muted">
                {{ selectedGame.name }} · {{ loadingCheatClues ? '正在分析线索...' : `${cheatClues.length} 条线索` }}
              </div>
              <UButton
                size="sm"
                variant="ghost"
                icon="i-lucide-refresh-cw"
                :loading="loadingCheatClues"
                @click="loadCheatClues"
              >
                刷新
              </UButton>
            </div>
            <div v-else class="text-sm text-muted">
              先选择比赛，再查看当前比赛的可疑提交线索。
            </div>

            <div v-if="cheatClues.length" class="space-y-2">
              <div
                v-for="clue in cheatClues"
                :key="`${clue.challenge_id}-${clue.submitted_flag}`"
                class="rounded-lg border border-default px-3 py-3 text-sm"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="font-medium">
                    {{ clue.challenge_title }} · {{ clue.team_count }} 支队伍
                  </div>
                  <UBadge color="warning" variant="soft">
                    {{ clue.submission_count }} 次重复错误提交
                  </UBadge>
                </div>
                <div class="mt-2 text-muted break-all">
                  错误 Flag：{{ clue.submitted_flag }}
                </div>
                <div class="mt-2 grid gap-2 text-muted md:grid-cols-2">
                  <div>首次出现：{{ new Date(clue.first_seen_at).toLocaleString() }}</div>
                  <div>最近出现：{{ new Date(clue.last_seen_at).toLocaleString() }}</div>
                </div>
                <div class="mt-2 text-muted">
                  涉及队伍：{{ clue.teams.join(' / ') }}
                </div>
              </div>
            </div>

            <UEmpty
              v-else-if="selectedGame && !loadingCheatClues"
              icon="i-lucide-shield-check"
              title="当前还没有异常提交线索"
              description="还没有发现跨队重复错误 Flag 的聚集模式。出现可疑情况后，这里会自动汇总。"
              :actions="[{
                label: '查看最近提交',
                icon: 'i-lucide-logs',
                onClick: () => jumpToAdminAnchor('#submissions'),
                color: 'neutral',
                variant: 'outline',
              }]"
            />
          </UPageCard>

          <UPageCard title="已加载资源" icon="i-lucide-list">
            <div class="grid gap-5 md:grid-cols-2 xl:grid-cols-1">
            <div>
              <div class="mb-2 text-sm font-medium">
                比赛列表
              </div>
              <div class="mb-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                <UInput
                  v-model="resourceFilters.gameKeyword"
                  icon="i-lucide-search"
                  placeholder="搜索比赛名称、说明或规则补充"
                  class="w-full"
                />
                <USelect
                  v-model="resourceFilters.gameStatus"
                  :items="resourceGameStatusOptions"
                  class="w-full"
                />
              </div>
              <div v-if="filteredGames.length" class="space-y-2 text-sm">
                <div
                  v-for="game in filteredGames"
                  :key="game.id"
                  class="flex items-start justify-between gap-3 rounded-lg border border-default px-3 py-2"
                >
                  <div class="min-w-0">
                    <div class="font-medium">
                      #{{ game.id }} {{ game.name }}
                    </div>
                    <div class="text-muted">
                      {{ game.status }} · {{ getRegistrationModeLabel(game.registration_mode) }} · {{ new Date(game.start_time).toLocaleString() }}
                    </div>
                    <div class="text-muted">
                      {{ game.max_team_members ? `队伍上限 ${game.max_team_members} 人` : '队伍人数不限' }}
                    </div>
                    <div class="text-muted">
                      {{ game.divisions?.length ? `分组：${game.divisions.join(' / ')}` : '未启用分组' }}
                    </div>
                    <div class="text-muted">
                      {{ getPracticeModeLabel(game.practice_mode) }} · {{ game.writeup_required ? '需要 Writeup' : '不要求 Writeup' }}
                    </div>
                    <div class="text-muted">
                      {{ game.scoreboard_freeze_at ? `封榜时间 ${new Date(game.scoreboard_freeze_at).toLocaleString()}` : '不封榜' }}
                    </div>
                    <div v-if="game.writeup_deadline" class="text-muted">
                      Writeup 截止：{{ new Date(game.writeup_deadline).toLocaleString() }}
                    </div>
                    <div v-if="game.notice" class="text-muted line-clamp-2">
                      公告：{{ game.notice }}
                    </div>
                  </div>

                  <div class="flex shrink-0 gap-2">
                    <UButton
                      size="sm"
                      variant="soft"
                      icon="i-lucide-pencil-line"
                      @click="quickEditGame(game.id)"
                    >
                      编辑
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
                      size="sm"
                      variant="ghost"
                      icon="i-lucide-download"
                      :loading="exportingGameId === game.id"
                      @click="exportGame(game.id)"
                    >
                      导出
                    </UButton>
                    <UButton
                      size="sm"
                      variant="ghost"
                      icon="i-lucide-table-properties"
                      :loading="exportingScoreboardGameId === game.id"
                      @click="exportScoreboard(game.id)"
                    >
                      导出榜单
                    </UButton>
                    <UButton
                      color="error"
                      variant="soft"
                      size="sm"
                      icon="i-lucide-trash-2"
                      :loading="deletingGameId === game.id"
                      @click="deleteGame(game.id)"
                    >
                      删除
                    </UButton>
                  </div>
                </div>
              </div>
              <UEmpty
                v-else-if="games.length"
                icon="i-lucide-search-x"
                title="没有匹配的比赛"
                description="调整关键字或状态筛选后，再试一次。"
              />
              <UEmpty
                v-else
                icon="i-lucide-trophy"
                title="当前还没有比赛"
                description="先创建一场比赛，资源列表、挂题、监控和审核区才会逐步出现内容。"
                :actions="[{
                  label: '去创建比赛',
                  icon: 'i-lucide-plus',
                  onClick: () => jumpToAdminAnchor('#create-game'),
                  color: 'neutral',
                  variant: 'outline',
                }]"
              />
            </div>

            <div>
              <div class="mb-2 text-sm font-medium">
                题目列表
              </div>
              <div class="mb-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
                <UInput
                  v-model="resourceFilters.challengeKeyword"
                  icon="i-lucide-search"
                  placeholder="搜索题目名称、题面、提示或接入信息"
                  class="w-full"
                />
                <USelect
                  v-model="resourceFilters.challengeCategory"
                  :items="resourceChallengeCategoryOptions"
                  class="w-full"
                />
                <USelect
                  v-model="resourceFilters.challengeVisibility"
                  :items="resourceChallengeVisibilityOptions"
                  class="w-full"
                />
              </div>
              <div v-if="filteredChallenges.length" class="space-y-2 text-sm">
                <div
                  v-for="challenge in filteredChallenges"
                  :key="challenge.id"
                  class="flex items-start justify-between gap-3 rounded-lg border border-default px-3 py-2"
                >
                  <div class="min-w-0">
                    <div class="font-medium">
                      #{{ challenge.id }} {{ challenge.title }}
                    </div>
                    <div class="text-muted">
                      {{ challenge.category }} · {{ challenge.is_visible ? 'visible' : 'hidden' }}
                    </div>
                    <div v-if="challenge.hints" class="text-muted line-clamp-2">
                      提示：{{ challenge.hints }}
                    </div>
                    <div v-if="challenge.container_spec" class="text-muted line-clamp-2">
                      接入：{{ challenge.container_spec }}
                    </div>
                  </div>

                  <div class="flex shrink-0 gap-2">
                    <UButton
                      size="sm"
                      variant="soft"
                      icon="i-lucide-pencil-line"
                      @click="quickEditChallenge(challenge.id)"
                    >
                      编辑
                    </UButton>
                    <UButton
                      color="error"
                      variant="soft"
                      size="sm"
                      icon="i-lucide-trash-2"
                      :loading="deletingChallengeId === challenge.id"
                      @click="deleteChallenge(challenge.id)"
                    >
                      删除
                    </UButton>
                  </div>
                </div>
              </div>
              <UEmpty
                v-else-if="challenges.length"
                icon="i-lucide-search-x"
                title="没有匹配的题目"
                description="调整关键字、分类或可见性筛选后，再试一次。"
              />
              <UEmpty
                v-else
                icon="i-lucide-flag"
                title="当前还没有题目"
                description="先创建至少一道题目，再把它挂到比赛中，公开页才会出现真正可参与的内容。"
                :actions="[{
                  label: '去创建题目',
                  icon: 'i-lucide-plus',
                  onClick: () => jumpToAdminAnchor('#create-challenge'),
                  color: 'neutral',
                  variant: 'outline',
                }]"
              />
            </div>
          </div>
          </UPageCard>
        </div>
      </div>
    </div>
  </div>

  <UModal
    v-model:open="createGameModalOpen"
    title="创建比赛"
    description="录入比赛基础信息，创建后可继续在比赛设置中调整公开性、状态和报名规则。"
    :ui="{ body: 'space-y-4', footer: 'justify-end' }"
  >
    <template #body>
      <UForm :state="gameForm" class="space-y-4" @submit="createGame">
        <UFormField label="比赛名称" name="name">
          <UInput v-model="gameForm.name" class="w-full" placeholder="例如：2026 校内选拔赛" />
        </UFormField>

        <UFormField label="比赛描述" name="description">
          <UTextarea v-model="gameForm.description" class="w-full" :rows="3" placeholder="面向选手展示的比赛简介" />
        </UFormField>

        <UFormField label="规则补充" name="notice" description="适合填写长期有效的规则说明或补充约束">
          <UTextarea v-model="gameForm.notice" class="w-full" :rows="3" placeholder="例如：禁止账号共享、禁止队伍间共享 Flag。" />
        </UFormField>

        <UFormField label="比赛邀请码" name="invitation_code" description="留空表示任何队伍都可报名">
          <UInput v-model="gameForm.invitation_code" class="w-full" placeholder="例如：spring-2026" />
        </UFormField>

        <UFormField label="比赛分组" name="divisions_text" description="按行或逗号分隔，例如：本科组, 公开组">
          <UTextarea v-model="gameForm.divisions_text" class="w-full" :rows="2" placeholder="本科组, 公开组" />
        </UFormField>

        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="开始时间" name="start_time">
            <UInput v-model="gameForm.start_time" type="datetime-local" class="w-full" />
          </UFormField>

          <UFormField label="结束时间" name="end_time">
            <UInput v-model="gameForm.end_time" type="datetime-local" class="w-full" />
          </UFormField>
        </div>

        <UFormField label="封榜时间" name="scoreboard_freeze_at" description="留空表示不封榜">
          <UInput v-model="gameForm.scoreboard_freeze_at" type="datetime-local" class="w-full" />
        </UFormField>

        <UFormField label="报名模式" name="registration_mode">
          <USelect v-model="gameForm.registration_mode" :items="registrationModeOptions" class="w-full" />
        </UFormField>

        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="队伍人数上限" name="max_team_members" description="0 表示不限制">
            <UInput v-model.number="gameForm.max_team_members" type="number" min="0" class="w-full" />
          </UFormField>

          <UFormField label="Writeup 截止时间" name="writeup_deadline" description="留空表示不额外设置">
            <UInput v-model="gameForm.writeup_deadline" type="datetime-local" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 md:grid-cols-3">
          <UFormField label="公开比赛" name="is_public">
            <USwitch v-model="gameForm.is_public" />
          </UFormField>

          <UFormField label="启用赛后练习" name="practice_mode">
            <USwitch v-model="gameForm.practice_mode" />
          </UFormField>

          <UFormField label="要求 Writeup" name="writeup_required">
            <USwitch v-model="gameForm.writeup_required" />
          </UFormField>
        </div>

        <div class="rounded-lg border border-default px-3 py-3 text-sm text-muted">
          <div class="mb-2 font-medium text-highlighted">
            当前规则摘要
          </div>
          <ul class="space-y-2">
            <li v-for="item in createGameRuleSummary" :key="item">
              {{ item }}
            </li>
          </ul>
        </div>
      </UForm>
    </template>

    <template #footer="{ close }">
      <UButton variant="ghost" :disabled="gameSubmitting" @click="close()">
        取消
      </UButton>
      <UButton :loading="gameSubmitting" @click="createGame">
        创建比赛
      </UButton>
    </template>
  </UModal>

  <UModal
    v-model:open="createChallengeModalOpen"
    title="创建题目"
    description="录入题目基础信息、接入说明和计分规则。"
    :ui="{ body: 'space-y-4', footer: 'justify-end' }"
  >
    <template #body>
      <div class="flex flex-wrap gap-2">
        <UButton size="sm" variant="outline" icon="i-lucide-wand-sparkles" @click="fillStarterChallengeTemplate">
          基础题
        </UButton>
        <UButton size="sm" variant="outline" icon="i-lucide-globe" @click="fillStaticWebTemplate">
          Web 实例
        </UButton>
        <UButton size="sm" variant="outline" icon="i-lucide-terminal" @click="fillPwnNetcatTemplate">
          Pwn 服务
        </UButton>
        <UButton size="sm" variant="outline" icon="i-lucide-box" @click="fillDynamicContainerTemplate">
          动态 Web
        </UButton>
        <UButton size="sm" variant="outline" icon="i-lucide-waypoints" @click="fillTeamScopedDynamicTemplate">
          每队独立入口
        </UButton>
      </div>

      <UForm :state="challengeForm" class="space-y-4" @submit="createChallenge">
        <UFormField label="题目名称" name="title">
          <UInput v-model="challengeForm.title" class="w-full" placeholder="例如：Easy XSS" />
        </UFormField>

        <UFormField label="题目描述" name="description">
          <UTextarea v-model="challengeForm.description" class="w-full" :rows="4" placeholder="题目简介、提示或附件说明" />
        </UFormField>

        <UFormField label="提示列表" name="hints" description='使用 JSON 数组，例如 ["先看首页","再看接口返回"]'>
          <UTextarea v-model="challengeForm.hints" class="w-full" :rows="3" placeholder='["提示 1","提示 2"]' />
        </UFormField>

        <UFormField label="附件链接" name="attachments" description='使用 JSON 数组，例如 ["https://example.com/files/web.zip"]'>
          <div class="space-y-3">
            <UFileUpload
              v-model="challengeAttachmentUploadForm.file"
              class="min-h-24"
              label="上传本地附件"
              description="上传后会自动把返回的 /attachments 路径写入下方 JSON 数组。"
            />
            <div class="flex justify-end">
              <UButton
                size="sm"
                variant="outline"
                icon="i-lucide-upload"
                :loading="challengeAttachmentUploading"
                @click="uploadChallengeAttachment"
              >
                上传并插入
              </UButton>
            </div>
            <UTextarea v-model="challengeForm.attachments" class="w-full" :rows="3" placeholder='["https://example.com/files/challenge.zip"]' />
          </div>
        </UFormField>

        <UFormField label="实例接入信息" name="container_spec" description='使用 JSON 记录实例 URL、host/port、连接命令或代理入口'>
          <UTextarea v-model="challengeForm.container_spec" class="w-full font-mono" :rows="8" placeholder='{"connection":{"url":"","note":"请填写实际入口或接入说明"}}' />
        </UFormField>

        <UPageCard title="模板占位符" icon="i-lucide-braces" description="动态题的 connection 字段可以直接使用这些占位符，为不同队伍生成不同入口。">
          <div class="flex flex-wrap gap-2">
            <UBadge v-for="token in instanceTemplateTokens" :key="token" color="neutral" variant="subtle">
              {{ token }}
            </UBadge>
          </div>
        </UPageCard>

        <UPageCard v-if="challengeFormInstanceSpec" title="实例预览" icon="i-lucide-box" description="这里会按比赛页的展示逻辑预览当前实例接入信息。">
          <div class="space-y-2 text-sm text-muted">
            <UAlert
              v-if="challengeFormAccessMode"
              :color="challengeFormAccessMode.color"
              variant="soft"
              :title="challengeFormAccessMode.title"
              :description="challengeFormAccessMode.description"
            />
            <p v-if="challengeFormInstanceSpec.note" class="whitespace-pre-wrap">
              {{ challengeFormInstanceSpec.note }}
            </p>
            <div v-if="challengeFormInstanceSpec.url">
              入口：{{ challengeFormInstanceSpec.url }}
            </div>
            <div v-if="challengeFormInstanceSpec.host || challengeFormInstanceSpec.port">
              主机：{{ challengeFormInstanceSpec.host || 'host' }}<template v-if="challengeFormInstanceSpec.port">:{{ challengeFormInstanceSpec.port }}</template>
            </div>
            <div v-if="challengeFormInstanceSpec.command" class="rounded-md border border-default bg-default px-3 py-2 font-mono text-xs whitespace-pre-wrap">
              {{ challengeFormInstanceSpec.command }}
            </div>
            <div v-if="challengeFormInstanceSpec.links.length" class="space-y-1">
              <div v-for="(link, index) in challengeFormInstanceSpec.links" :key="`${link.url}-${index}`">
                附加入口：{{ link.label }} -> {{ link.url }}
              </div>
            </div>
            <div v-if="challengeFormInstanceSpec.runtimeProvider || challengeFormInstanceSpec.runtimeImage || challengeFormInstanceSpec.runtimeExpose.length" class="rounded-md border border-default bg-default px-3 py-2 text-xs">
              <div v-if="challengeFormInstanceSpec.runtimeProvider">
                运行环境：{{ challengeFormInstanceSpec.runtimeProvider }}
              </div>
              <div v-if="challengeFormInstanceSpec.runtimeImage">
                镜像：{{ challengeFormInstanceSpec.runtimeImage }}
              </div>
              <div v-if="challengeFormInstanceSpec.runtimeExpose.length">
                暴露端口：{{ challengeFormInstanceSpec.runtimeExpose.join(' / ') }}
              </div>
            </div>
          </div>
        </UPageCard>

        <div class="grid gap-4 md:grid-cols-3">
          <UFormField label="分类" name="category">
            <USelect v-model="challengeForm.category" :items="categoryOptions" class="w-full" />
          </UFormField>

          <UFormField label="类型" name="type">
            <USelect v-model="challengeForm.type" :items="typeOptions" class="w-full" />
          </UFormField>

          <UFormField label="难度" name="difficulty">
            <USelect v-model="challengeForm.difficulty" :items="difficultyOptions" class="w-full" />
          </UFormField>
        </div>

        <UFormField label="Flag" name="flag">
          <UInput v-model="challengeForm.flag" class="w-full" placeholder="请填写正式 Flag" />
        </UFormField>

        <div class="grid gap-4 md:grid-cols-3">
          <UFormField label="基础分值" name="base_score">
            <UInput v-model.number="challengeForm.base_score" type="number" class="w-full" />
          </UFormField>

          <UFormField label="最低分值" name="min_score">
            <UInput v-model.number="challengeForm.min_score" type="number" class="w-full" />
          </UFormField>

          <UFormField label="衰减率" name="decay_rate">
            <UInput v-model.number="challengeForm.decay_rate" type="number" step="0.1" class="w-full" />
          </UFormField>
        </div>

        <UFormField label="错误尝试上限" name="max_attempts" description="0 表示不限制；达到上限后该队伍在当前比赛中不能再继续提交这道题。">
          <UInput v-model.number="challengeForm.max_attempts" type="number" min="0" class="w-full" />
        </UFormField>

        <UFormField label="是否可见" name="is_visible">
          <USwitch v-model="challengeForm.is_visible" />
        </UFormField>
      </UForm>
    </template>

    <template #footer="{ close }">
      <UButton variant="ghost" :disabled="challengeSubmitting" @click="close()">
        取消
      </UButton>
      <UButton :loading="challengeSubmitting" @click="createChallenge">
        创建题目
      </UButton>
    </template>
  </UModal>

  <UModal
    v-model:open="attachChallengeModalOpen"
    title="比赛挂题"
    description="将现有题目加入比赛，并按需覆盖比赛内分值。"
    :ui="{ body: 'space-y-4', footer: 'justify-end' }"
  >
    <template #body>
      <UForm :state="attachForm" class="space-y-4" @submit="attachChallengeToGame">
        <UFormField label="选择比赛" name="game_id">
          <USelect
            v-model="attachForm.game_id"
            :items="gameOptions"
            class="w-full"
            placeholder="选择一个比赛"
          />
        </UFormField>

        <UFormField label="选择题目" name="challenge_id">
          <USelect
            v-model="attachForm.challenge_id"
            :items="challengeOptions"
            class="w-full"
            placeholder="选择一个题目"
          />
        </UFormField>

        <UFormField label="覆盖分值" name="score_override" description="留空时沿用题目基础分值">
          <UInput v-model.number="attachForm.score_override" type="number" min="0" class="w-full" placeholder="例如：500" />
        </UFormField>
      </UForm>
    </template>

    <template #footer="{ close }">
      <UButton variant="ghost" :disabled="attachSubmitting" @click="close()">
        取消
      </UButton>
      <UButton :loading="attachSubmitting" @click="attachChallengeToGame">
        加入比赛
      </UButton>
    </template>
  </UModal>

  <UModal
    v-model:open="announcementModalOpen"
    title="发布公告"
    description="向当前比赛发布赛时通知、规则补充或维护说明。"
    :ui="{ body: 'space-y-4', footer: 'justify-end' }"
  >
    <template #body>
      <UForm :state="announcementForm" class="space-y-3" @submit="createAnnouncement">
        <UFormField
          label="公告内容"
          name="content"
          description="适合发布开赛提醒、规则补充、实例维护通知或 Writeup 截止提醒。"
        >
          <UTextarea
            v-model="announcementForm.content"
            class="w-full"
            :rows="6"
            placeholder="例如：平台将在 10 分钟后开放，请提前确认队伍成员与网络环境。"
          />
        </UFormField>
      </UForm>
    </template>

    <template #footer="{ close }">
      <UButton variant="ghost" :disabled="announcementSubmitting" @click="close()">
        取消
      </UButton>
      <UButton icon="i-lucide-send" :loading="announcementSubmitting" @click="createAnnouncement">
        发布公告
      </UButton>
    </template>
  </UModal>

  <UModal
    v-model:open="gameEditModalOpen"
    title="编辑比赛信息"
    description="修改比赛的基础信息、时间和补充规则。"
    :ui="{ body: 'space-y-4', footer: 'justify-end' }"
  >
    <template #body>
      <UForm :state="gameEditForm" class="space-y-4" @submit="updateGameDetails">
        <UFormField label="选择比赛" name="game_id">
          <USelect
            v-model="gameEditForm.game_id"
            :items="gameOptions"
            class="w-full"
            placeholder="选择一个比赛"
          />
        </UFormField>

        <UFormField label="比赛名称" name="name">
          <UInput v-model="gameEditForm.name" class="w-full" placeholder="例如：Spring CTF 2026" />
        </UFormField>

        <UFormField label="比赛描述" name="description">
          <UTextarea v-model="gameEditForm.description" class="w-full" :rows="4" placeholder="简要介绍比赛规则或主题" />
        </UFormField>

        <UFormField label="规则补充" name="notice" description="这里适合填写长期有效的补充规则，会展示在公开比赛页的“规则补充”区域">
          <UTextarea v-model="gameEditForm.notice" class="w-full" :rows="4" placeholder="例如：禁止共享 Flag；比赛开始前 15 分钟开放平台。" />
        </UFormField>

        <UFormField label="比赛邀请码" name="invitation_code" description="留空表示关闭邀请码门槛">
          <UInput v-model="gameEditForm.invitation_code" class="w-full" placeholder="例如：spring-2026" />
        </UFormField>

        <UFormField label="比赛分组" name="divisions_text" description="按行或逗号分隔，留空表示不分组">
          <UTextarea v-model="gameEditForm.divisions_text" class="w-full" :rows="3" placeholder="本科组, 公开组" />
        </UFormField>

        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="开始时间" name="start_time">
            <UInput v-model="gameEditForm.start_time" type="datetime-local" class="w-full" />
          </UFormField>

          <UFormField label="结束时间" name="end_time">
            <UInput v-model="gameEditForm.end_time" type="datetime-local" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="Writeup 截止时间" name="writeup_deadline" description="留空表示不额外设置截止时间；如果填写，应晚于比赛结束时间">
            <UInput v-model="gameEditForm.writeup_deadline" type="datetime-local" class="w-full" />
          </UFormField>

          <div class="grid gap-4 md:grid-cols-2">
            <UFormField label="启用赛后练习" name="practice_mode">
              <USwitch v-model="gameEditForm.practice_mode" />
            </UFormField>

            <UFormField label="要求 Writeup" name="writeup_required">
              <USwitch v-model="gameEditForm.writeup_required" />
            </UFormField>
          </div>
        </div>

        <div v-if="selectedEditableGame" class="rounded-lg border border-default px-3 py-3 text-sm text-muted">
          正在编辑：{{ selectedEditableGame.name }} · 当前状态 {{ selectedEditableGame.status }} · {{ getPracticeModeLabel(selectedEditableGame.practice_mode) }} · {{ selectedEditableGame.writeup_required ? '需要 Writeup' : '不要求 Writeup' }}
        </div>

        <div v-if="editGameRuleSummary.length" class="rounded-lg border border-default px-3 py-3 text-sm text-muted">
          <div class="mb-2 font-medium text-highlighted">
            编辑后规则摘要
          </div>
          <ul class="space-y-2">
            <li v-for="item in editGameRuleSummary" :key="item">
              {{ item }}
            </li>
          </ul>
        </div>
      </UForm>
    </template>

    <template #footer="{ close }">
      <UButton variant="ghost" :disabled="gameEditing" @click="close()">
        取消
      </UButton>
      <UButton :loading="gameEditing" @click="updateGameDetails">
        保存比赛信息
      </UButton>
    </template>
  </UModal>

  <UModal
    v-model:open="challengeEditModalOpen"
    title="编辑题目"
    description="修改题面、接入信息和计分参数。"
    :ui="{ body: 'space-y-4', footer: 'justify-end' }"
  >
    <template #body>
      <UForm :state="challengeEditForm" class="space-y-4" @submit="updateChallengeDetails">
        <UFormField label="选择题目" name="challenge_id">
          <USelect
            v-model="challengeEditForm.challenge_id"
            :items="challengeOptions"
            class="w-full"
            placeholder="选择一个题目"
          />
        </UFormField>

        <UFormField label="题目名称" name="title">
          <UInput v-model="challengeEditForm.title" class="w-full" placeholder="例如：Easy XSS" />
        </UFormField>

        <UFormField label="题目描述" name="description">
          <UTextarea v-model="challengeEditForm.description" class="w-full" :rows="4" placeholder="题目简介、提示或附件说明" />
        </UFormField>

        <UFormField
          label="提示列表"
          name="hints"
          description='使用 JSON 数组，例如 ["先看首页","再看接口返回"]'
        >
          <UTextarea v-model="challengeEditForm.hints" class="w-full" :rows="3" placeholder='["提示 1","提示 2"]' />
        </UFormField>

        <UFormField
          label="附件链接"
          name="attachments"
          description='使用 JSON 数组，例如 ["https://example.com/files/web.zip"]'
        >
          <div class="space-y-3">
            <UFileUpload
              v-model="challengeEditAttachmentUploadForm.file"
              class="min-h-24"
              label="上传本地附件"
              description="上传后会自动把返回的 /attachments 路径写入下方 JSON 数组。"
            />
            <div class="flex justify-end">
              <UButton
                size="sm"
                variant="outline"
                icon="i-lucide-upload"
                :loading="challengeEditAttachmentUploading"
                @click="uploadChallengeEditAttachment"
              >
                上传并插入
              </UButton>
            </div>
            <UTextarea v-model="challengeEditForm.attachments" class="w-full" :rows="3" placeholder='["https://example.com/files/challenge.zip"]' />
          </div>
        </UFormField>

        <UFormField
          label="实例接入信息"
          name="container_spec"
          description='使用 JSON 记录实例 URL、host/port、连接命令或代理入口'
        >
          <UTextarea v-model="challengeEditForm.container_spec" class="w-full font-mono" :rows="8" placeholder='{"connection":{"url":"","note":"请填写实际入口或接入说明"}}' />
        </UFormField>

        <UPageCard
          title="模板占位符"
          icon="i-lucide-braces"
          description="编辑动态题时同样可以在 connection 字段里使用这些占位符。"
        >
          <div class="flex flex-wrap gap-2">
            <UBadge
              v-for="token in instanceTemplateTokens"
              :key="`edit-${token}`"
              color="neutral"
              variant="subtle"
            >
              {{ token }}
            </UBadge>
          </div>
        </UPageCard>

        <UPageCard
          v-if="challengeEditInstanceSpec"
          title="实例预览"
          icon="i-lucide-box"
          description="编辑时也会按比赛页的展示逻辑预览当前实例接入信息。"
        >
          <div class="space-y-2 text-sm text-muted">
            <UAlert
              v-if="challengeEditAccessMode"
              :color="challengeEditAccessMode.color"
              variant="soft"
              :title="challengeEditAccessMode.title"
              :description="challengeEditAccessMode.description"
            />
            <p v-if="challengeEditInstanceSpec.note" class="whitespace-pre-wrap">
              {{ challengeEditInstanceSpec.note }}
            </p>
            <div v-if="challengeEditInstanceSpec.url">
              入口：{{ challengeEditInstanceSpec.url }}
            </div>
            <div v-if="challengeEditInstanceSpec.host || challengeEditInstanceSpec.port">
              主机：{{ challengeEditInstanceSpec.host || 'host' }}<template v-if="challengeEditInstanceSpec.port">:{{ challengeEditInstanceSpec.port }}</template>
            </div>
            <div v-if="challengeEditInstanceSpec.command" class="rounded-md border border-default bg-default px-3 py-2 font-mono text-xs whitespace-pre-wrap">
              {{ challengeEditInstanceSpec.command }}
            </div>
            <div v-if="challengeEditInstanceSpec.links.length" class="space-y-1">
              <div
                v-for="(link, index) in challengeEditInstanceSpec.links"
                :key="`${link.url}-${index}`"
              >
                附加入口：{{ link.label }} -> {{ link.url }}
              </div>
            </div>
            <div v-if="challengeEditInstanceSpec.runtimeProvider || challengeEditInstanceSpec.runtimeImage || challengeEditInstanceSpec.runtimeExpose.length" class="rounded-md border border-default bg-default px-3 py-2 text-xs">
              <div v-if="challengeEditInstanceSpec.runtimeProvider">
                运行环境：{{ challengeEditInstanceSpec.runtimeProvider }}
              </div>
              <div v-if="challengeEditInstanceSpec.runtimeImage">
                镜像：{{ challengeEditInstanceSpec.runtimeImage }}
              </div>
              <div v-if="challengeEditInstanceSpec.runtimeExpose.length">
                暴露端口：{{ challengeEditInstanceSpec.runtimeExpose.join(' / ') }}
              </div>
            </div>
          </div>
        </UPageCard>

        <div class="grid gap-4 md:grid-cols-3">
          <UFormField label="分类" name="category">
            <USelect v-model="challengeEditForm.category" :items="categoryOptions" class="w-full" />
          </UFormField>

          <UFormField label="类型" name="type">
            <USelect v-model="challengeEditForm.type" :items="typeOptions" class="w-full" />
          </UFormField>

          <UFormField label="难度" name="difficulty">
            <USelect v-model="challengeEditForm.difficulty" :items="difficultyOptions" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 md:grid-cols-3">
          <UFormField label="基础分值" name="base_score">
            <UInput v-model.number="challengeEditForm.base_score" type="number" class="w-full" />
          </UFormField>

          <UFormField label="最低分值" name="min_score">
            <UInput v-model.number="challengeEditForm.min_score" type="number" class="w-full" />
          </UFormField>

          <UFormField label="衰减率" name="decay_rate">
            <UInput v-model.number="challengeEditForm.decay_rate" type="number" step="0.1" class="w-full" />
          </UFormField>
        </div>

        <UFormField label="错误尝试上限" name="max_attempts" description="0 表示不限制；达到上限后该队伍在当前比赛中不能再继续提交这道题。">
          <UInput v-model.number="challengeEditForm.max_attempts" type="number" min="0" class="w-full" />
        </UFormField>

        <UFormField label="是否可见" name="is_visible">
          <USwitch v-model="challengeEditForm.is_visible" />
        </UFormField>

        <div v-if="selectedEditableChallenge" class="rounded-lg border border-default px-3 py-3 text-sm text-muted">
          正在编辑：{{ selectedEditableChallenge.title }} · {{ selectedEditableChallenge.category }}
        </div>
      </UForm>
    </template>

    <template #footer="{ close }">
      <UButton variant="ghost" :disabled="challengeEditing" @click="close()">
        取消
      </UButton>
      <UButton :loading="challengeEditing" @click="updateChallengeDetails">
        保存题目信息
      </UButton>
    </template>
  </UModal>

  <UModal
    v-model:open="importModalOpen"
    title="导入比赛包"
    description="上传导出的比赛 ZIP 包，系统会创建新的比赛和题目副本。"
    :ui="{ body: 'space-y-4', footer: 'justify-end' }"
  >
    <template #body>
      <p class="text-sm text-muted">
        支持 `sauryctf.export.v1` / `v2`，其中 `v2` 会额外恢复包内嵌入的本地附件文件。
      </p>

      <UFormField label="ZIP 文件" name="import-file">
        <UFileUpload
          v-model="importForm.file"
          accept=".zip,application/zip"
          class="min-h-32"
          label="拖拽比赛包到这里"
          description="或点击选择一个 ZIP 文件"
        />
      </UFormField>
    </template>

    <template #footer="{ close }">
      <UButton variant="ghost" :disabled="importingGame" @click="close()">
        取消
      </UButton>
      <UButton icon="i-lucide-file-up" :loading="importingGame" @click="importGamePackage">
        导入比赛
      </UButton>
    </template>
  </UModal>

  <UModal
    v-model:open="confirmModalOpen"
    :title="confirmActionState.title"
    :description="confirmActionState.description"
    :dismissible="!confirmActionBusy"
    :ui="{ description: 'whitespace-pre-wrap', footer: 'justify-end' }"
  >
    <template #footer>
      <UButton
        variant="ghost"
        :disabled="confirmActionBusy"
        @click="confirmModalOpen = false; resetConfirmAction()"
      >
        取消
      </UButton>
      <UButton
        color="error"
        :loading="confirmActionBusy"
        @click="confirmAction"
      >
        {{ confirmActionState.confirmLabel }}
      </UButton>
    </template>
  </UModal>
</template>
