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
  category: 'web',
  type: 'static',
  difficulty: 'easy',
  flag: '',
  base_score: 100,
  min_score: 10,
  decay_rate: 0.1,
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
  category: 'web',
  type: 'static',
  difficulty: 'easy',
  base_score: 100,
  min_score: 10,
  decay_rate: 0.1,
  is_visible: true,
})

const importForm = reactive({
  file: undefined as File | undefined,
})

const gameSubmitting = ref(false)
const challengeSubmitting = ref(false)
const attachSubmitting = ref(false)
const settingsSubmitting = ref(false)
const gameEditing = ref(false)
const challengeEditing = ref(false)
const smokeProvisioning = ref(false)
const loadingResources = ref(false)
const loadingGameChallenges = ref(false)
const loadingParticipants = ref(false)
const updatingParticipantId = ref<number | null>(null)
const removingParticipantId = ref<number | null>(null)
const removingChallengeId = ref<number | null>(null)
const deletingGameId = ref<number | null>(null)
const exportingGameId = ref<number | null>(null)
const importingGame = ref(false)
const deletingChallengeId = ref<number | null>(null)
const games = ref<Array<{
  id: number
  name: string
  description?: string
  notice?: string
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
  category: 'web' | 'pwn' | 'crypto' | 'reverse' | 'misc' | 'forensics' | 'awd'
  type?: 'static' | 'dynamic'
  difficulty?: 'easy' | 'medium' | 'hard'
  base_score?: number
  min_score?: number
  decay_rate?: number
  is_visible?: boolean
}>>([])
const selectedGameChallenges = ref<Array<{
  id: number
  title: string
  category: 'web' | 'pwn' | 'crypto' | 'reverse' | 'misc' | 'forensics' | 'awd'
  type: 'static' | 'dynamic'
  difficulty?: string
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
type AdminGameSummary = (typeof games.value)[number]

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
        ? '当前仍处于 draft，适合继续补题和核对配置。'
        : overview.game.status === 'active'
          ? '当前已经开赛，公开页应同步开放报名与题目可见性。'
          : '当前已结束，适合复核榜单、Writeup 和赛后练习状态。',
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
        : '当前还没有报名队伍，适合先用普通用户走一遍本地冒烟流程。',
      actionLabel: overview.participantCount > 0 ? '查看报名队伍' : '打开公开页',
      actionTo: overview.participantCount > 0 ? '#attach-challenge' : `/games/${overview.game.id}`,
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
      title: '1. 先创建一场比赛',
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
      title: '2. 再创建至少一道题目',
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
      title: '3. 把题目挂到比赛上',
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
      title: '4. 最后切到 active 并验证公开页',
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

function resetSelectedGameContext() {
  selectedGameChallenges.value = []
  participants.value = []
  writeups.value = []

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
  const confirmed = window.confirm(`确认移除队伍「${participant?.team_name || `#${teamId}`}」的比赛报名吗？`)
  if (!confirmed) {
    return
  }

  removingParticipantId.value = teamId
  try {
    await $api('delete', '/api/games/{id}/participants/{teamId}', {
      params: {
        id: attachForm.game_id,
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

function fillSmokeGameTemplate() {
  const now = new Date()
  const start = new Date(now.getTime() + 30 * 60 * 1000)
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
  const freeze = new Date(end.getTime() - 30 * 60 * 1000)
  const writeupDeadline = new Date(end.getTime() + 24 * 60 * 60 * 1000)

  gameForm.name = `Smoke Flow ${start.getFullYear()}`
  gameForm.description = '本地冒烟用最小比赛模板。建议先用它验证报名、题目显示、Flag 提交和排行榜更新。'
  gameForm.notice = '这是本地联调用的最小模板比赛。先用普通用户走一遍注册、建队、报名和提交流程，再继续补题或调规则。'
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

  toast.add({ title: '已填充比赛模板', description: '这是适合本地冒烟的最小公开比赛配置。', color: 'success' })
}

function fillSmokeChallengeTemplate() {
  challengeForm.title = 'Warmup Flag'
  challengeForm.description = '这是一个本地冒烟用的最小题目模板。创建后把它挂到比赛里，再用普通用户提交 `flag{warmup}` 验证整条链路。'
  challengeForm.hints = JSON.stringify([
    '直接提交标准示例 Flag 即可。',
    '如果提交失败，优先检查报名状态和比赛是否已开始。',
  ])
  challengeForm.attachments = '[]'
  challengeForm.category = 'misc'
  challengeForm.type = 'static'
  challengeForm.difficulty = 'easy'
  challengeForm.flag = 'flag{warmup}'
  challengeForm.base_score = 100
  challengeForm.min_score = 100
  challengeForm.decay_rate = 0
  challengeForm.is_visible = true

  toast.add({ title: '已填充题目模板', description: '当前题目适合用来验证最小提交闭环。', color: 'success' })
}

async function createSmokeProvision() {
  const now = new Date()
  const start = new Date(now.getTime() + 30 * 60 * 1000)
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
  const freeze = new Date(end.getTime() - 30 * 60 * 1000)

  smokeProvisioning.value = true
  try {
    const game = await $api('post', '/api/games', {
      body: {
        name: `Smoke Flow ${start.getFullYear()}`,
        description: '本地冒烟用最小比赛模板。建议先用它验证报名、题目显示、Flag 提交和排行榜更新。',
        notice: '这是本地联调用的最小模板比赛。先用普通用户走一遍注册、建队、报名和提交流程，再继续补题或调规则。',
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
        title: 'Warmup Flag',
        description: '这是一个本地冒烟用的最小题目模板。创建后把它挂到比赛里，再用普通用户提交 `flag{warmup}` 验证整条链路。',
        hints: JSON.stringify([
          '直接提交标准示例 Flag 即可。',
          '如果提交失败，优先检查报名状态和比赛是否已开始。',
        ]),
        attachments: '[]',
        category: 'misc',
        type: 'static',
        difficulty: 'easy',
        flag: 'flag{warmup}',
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
      title: '冒烟比赛已创建',
      description: `已创建 ${game.name}，并自动挂上 Warmup Flag。现在可以直接去公开页验证整条链路。`,
      color: 'success',
    })
    jumpToAdminAnchor('#attach-challenge')
  }
  catch (e: any) {
    toast.add({ title: '创建冒烟比赛失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    smokeProvisioning.value = false
  }
}

function selectGameContext(gameId?: number) {
  attachForm.game_id = gameId
  gameSettingsForm.game_id = gameId
  gameEditForm.game_id = gameId
}

async function createGame() {
  gameSubmitting.value = true
  try {
    await $api('post', '/api/games', {
      body: {
        name: gameForm.name,
        description: gameForm.description,
        notice: gameForm.notice,
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
    gameForm.name = ''
    gameForm.description = ''
    gameForm.notice = ''
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
  challengeSubmitting.value = true
  try {
    await $api('post', '/api/challenges', {
      body: {
        title: challengeForm.title,
        description: challengeForm.description,
        hints: challengeForm.hints,
        attachments: challengeForm.attachments,
        category: challengeForm.category as 'web',
        type: challengeForm.type as 'static',
        difficulty: challengeForm.difficulty as 'easy',
        flag: challengeForm.flag,
        base_score: challengeForm.base_score,
        min_score: challengeForm.min_score,
        decay_rate: challengeForm.decay_rate,
        is_visible: challengeForm.is_visible,
      },
    })
    toast.add({ title: '题目创建成功', color: 'success' })
    challengeForm.title = ''
    challengeForm.description = ''
    challengeForm.hints = '[]'
    challengeForm.attachments = '[]'
    challengeForm.category = 'web'
    challengeForm.type = 'static'
    challengeForm.difficulty = 'easy'
    challengeForm.flag = ''
    challengeForm.base_score = 100
    challengeForm.min_score = 10
    challengeForm.decay_rate = 0.1
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

async function updateChallengeDetails() {
  if (!challengeEditForm.challenge_id) {
    toast.add({ title: '请先选择题目', color: 'warning' })
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
        category: challengeEditForm.category,
        type: challengeEditForm.type,
        difficulty: challengeEditForm.difficulty,
        base_score: challengeEditForm.base_score,
        min_score: challengeEditForm.min_score,
        decay_rate: challengeEditForm.decay_rate,
        is_visible: challengeEditForm.is_visible,
      },
    })

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

async function deleteChallenge(challengeId: number) {
  const challenge = challenges.value.find(item => item.id === challengeId)
  const confirmed = window.confirm(`确认删除题目「${challenge?.title || `#${challengeId}`}」吗？`)
  if (!confirmed) {
    return
  }

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

  settingsSubmitting.value = true
  try {
    const body: {
      status: 'draft' | 'active' | 'ended'
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
  const confirmed = window.confirm(`确认删除比赛「${game?.name || `#${gameId}`}」吗？这会清理该比赛的报名、解题、Writeup 和挂题关系。`)
  if (!confirmed) {
    return
  }

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
    const response = await $fetch.raw(`/api/admin/games/${gameId}/export`, {
      method: 'POST',
      responseType: 'blob',
    })

    const blob = response._data as Blob
    const contentDisposition = response.headers.get('content-disposition') || ''
    const match = contentDisposition.match(/filename="([^"]+)"/)
    const filename = match?.[1] || `game-${gameId}-export.zip`
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)

    toast.add({ title: '比赛导出成功', description: `已下载 ${filename}`, color: 'success' })
  }
  catch (e: any) {
    toast.add({ title: '比赛导出失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    exportingGameId.value = null
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
  toast.add({ title: '已填充比赛管理表单', color: 'info' })
}

function quickEditChallenge(challengeId: number) {
  challengeEditForm.challenge_id = challengeId
  attachForm.challenge_id = challengeId
  toast.add({ title: '已填充题目管理表单', color: 'info' })
}

watch(() => challengeEditForm.challenge_id, () => {
  if (!challengeEditForm.challenge_id) {
    challengeEditForm.title = ''
    challengeEditForm.description = ''
    challengeEditForm.hints = '[]'
    challengeEditForm.attachments = '[]'
    challengeEditForm.category = 'web'
    challengeEditForm.type = 'static'
    challengeEditForm.difficulty = 'easy'
    challengeEditForm.base_score = 100
    challengeEditForm.min_score = 10
    challengeEditForm.decay_rate = 0.1
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
  challengeEditForm.category = challenge.category
  challengeEditForm.type = challenge.type || 'static'
  challengeEditForm.difficulty = challenge.difficulty || 'easy'
  challengeEditForm.base_score = challenge.base_score || 100
  challengeEditForm.min_score = challenge.min_score || 10
  challengeEditForm.decay_rate = challenge.decay_rate || 0.1
  challengeEditForm.is_visible = challenge.is_visible ?? true
})

watch(() => gameEditForm.game_id, () => {
  if (!gameEditForm.game_id) {
    gameEditForm.name = ''
    gameEditForm.description = ''
    gameEditForm.notice = ''
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
  await loadWriteups()
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

      <UPageCard title="本地冒烟入口" icon="i-lucide-flask-conical">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div class="space-y-2">
            <p class="text-sm text-muted">
              一次点击自动创建一场公开比赛、一道 `flag{warmup}` 题目，并完成挂题。适合空库首次启动后的最小联调。
            </p>
            <UAlert
              color="info"
              variant="soft"
              title="推荐用途"
              description="先用这条入口跑通管理员建赛、普通用户报名、Flag 提交和排行榜更新，再继续补更复杂的比赛配置。"
            />
          </div>

          <div class="flex shrink-0 flex-wrap gap-2">
            <UButton icon="i-lucide-flask-conical" :loading="smokeProvisioning" @click="createSmokeProvision">
              一键创建冒烟比赛
            </UButton>
            <UButton variant="outline" icon="i-lucide-wand-sparkles" @click="fillSmokeGameTemplate">
              只填比赛模板
            </UButton>
            <UButton variant="outline" icon="i-lucide-wand-sparkles" @click="fillSmokeChallengeTemplate">
              只填题目模板
            </UButton>
          </div>
        </div>
      </UPageCard>

      <UPageCard title="首次建赛路径" icon="i-lucide-list-checks">
        <div class="space-y-3">
          <UAlert
            color="info"
            variant="soft"
            title="推荐顺序：先建比赛，再建题、挂题，最后切到 active"
            description="这条顺序更适合空库首次启动后的最小闭环，也能减少把未配置完成的比赛提前公开。"
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
          />
        </UPageCard>

        <UPageCard title="赛前检查" icon="i-lucide-shield-alert">
          <div v-if="selectedGamePreflightChecks.length" class="space-y-3">
            <UAlert
              color="info"
              variant="soft"
              title="先看这里，再决定是否立即开赛"
              description="这组检查不替代详细配置，只帮助你快速判断当前选中的比赛是否已经具备最小可用的公开比赛形态。"
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

      <div class="grid gap-6 xl:grid-cols-2">
        <UPageCard id="create-game" title="创建比赛" icon="i-lucide-trophy">
          <template #footer>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="text-sm text-muted">
                可以先填充一个本地冒烟模板，再按需要微调时间、公告和报名规则。
              </p>
              <UButton size="sm" variant="outline" icon="i-lucide-wand-sparkles" @click="fillSmokeGameTemplate">
                填充冒烟模板
              </UButton>
            </div>
          </template>

          <UForm :state="gameForm" class="space-y-4" @submit="createGame">
            <UFormField label="比赛名称" name="name">
              <UInput v-model="gameForm.name" class="w-full" placeholder="例如：Spring CTF 2026" />
            </UFormField>

            <UFormField label="比赛描述" name="description">
              <UTextarea v-model="gameForm.description" class="w-full" :rows="4" placeholder="简要介绍比赛规则或主题" />
            </UFormField>

            <UFormField label="比赛公告" name="notice">
              <UTextarea v-model="gameForm.notice" class="w-full" :rows="4" placeholder="例如：开赛前 15 分钟开放平台，禁止共享 Flag。" />
            </UFormField>

            <UFormField label="比赛分组" name="divisions_text" description="按行或逗号分隔，例如：本科组, 公开组">
              <UTextarea v-model="gameForm.divisions_text" class="w-full" :rows="3" placeholder="本科组, 公开组" />
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

              <UFormField label="Writeup 截止时间" name="writeup_deadline" description="留空表示不要求单独截止时间">
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

            <UButton type="submit" :loading="gameSubmitting">
              创建比赛
            </UButton>
          </UForm>
        </UPageCard>

        <UPageCard title="编辑比赛信息" icon="i-lucide-pencil-line">
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

            <UFormField label="比赛公告" name="notice">
              <UTextarea v-model="gameEditForm.notice" class="w-full" :rows="4" placeholder="例如：开赛前 15 分钟开放平台，禁止共享 Flag。" />
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
              <UFormField label="Writeup 截止时间" name="writeup_deadline" description="需晚于比赛结束时间">
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

            <UButton type="submit" :loading="gameEditing">
              保存比赛信息
            </UButton>
          </UForm>
        </UPageCard>
      </div>

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

            <UFormField label="比赛分组" name="divisions_text" description="按行或逗号分隔，榜单和参赛分配都会使用这里的分组">
              <UTextarea v-model="gameSettingsForm.divisions_text" class="w-full" :rows="3" placeholder="本科组, 公开组" />
            </UFormField>

            <UFormField label="封榜时间" name="scoreboard_freeze_at" description="留空表示不封榜">
              <UInput v-model="gameSettingsForm.scoreboard_freeze_at" type="datetime-local" class="w-full" />
            </UFormField>

            <UFormField label="报名模式" name="registration_mode">
              <USelect
                v-model="gameSettingsForm.registration_mode"
                :items="registrationModeOptions"
                class="w-full"
              />
            </UFormField>

            <UFormField label="队伍人数上限" name="max_team_members" description="0 表示不限制">
              <UInput v-model.number="gameSettingsForm.max_team_members" type="number" min="0" class="w-full" />
            </UFormField>

            <UFormField label="Writeup 截止时间" name="writeup_deadline" description="留空表示不额外限制提交时间">
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
              当前比赛：{{ selectedSettingsGame.name }} · {{ new Date(selectedSettingsGame.start_time).toLocaleString() }} · {{ getRegistrationModeLabel(selectedSettingsGame.registration_mode) }} · {{ selectedSettingsGame.max_team_members ? `最多 ${selectedSettingsGame.max_team_members} 人` : '人数不限' }} · {{ getPracticeModeLabel(selectedSettingsGame.practice_mode) }} · {{ selectedSettingsGame.writeup_required ? '需要 Writeup' : '不要求 Writeup' }} · {{ selectedSettingsGame.scoreboard_freeze_at ? `封榜于 ${new Date(selectedSettingsGame.scoreboard_freeze_at).toLocaleString()}` : '不封榜' }}
            </div>

            <UButton type="submit" :loading="settingsSubmitting">
              保存比赛设置
            </UButton>
          </UForm>
        </UPageCard>

        <UPageCard id="create-challenge" title="创建题目" icon="i-lucide-flag">
          <template #footer>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="text-sm text-muted">
                冒烟题目会直接填入一个可验证的示例 Flag，适合首次联调排行榜与提交链路。
              </p>
              <UButton size="sm" variant="outline" icon="i-lucide-wand-sparkles" @click="fillSmokeChallengeTemplate">
                填充冒烟题目
              </UButton>
            </div>
          </template>

          <UForm :state="challengeForm" class="space-y-4" @submit="createChallenge">
            <UFormField label="题目名称" name="title">
              <UInput v-model="challengeForm.title" class="w-full" placeholder="例如：Easy XSS" />
            </UFormField>

            <UFormField label="题目描述" name="description">
              <UTextarea v-model="challengeForm.description" class="w-full" :rows="4" placeholder="题目简介、提示或附件说明" />
            </UFormField>

            <UFormField
              label="提示列表"
              name="hints"
              description='使用 JSON 数组，例如 ["先看首页","再看接口返回"]'
            >
              <UTextarea v-model="challengeForm.hints" class="w-full" :rows="3" placeholder='["提示 1","提示 2"]' />
            </UFormField>

            <UFormField
              label="附件链接"
              name="attachments"
              description='使用 JSON 数组，例如 ["https://example.com/files/web.zip"]'
            >
              <UTextarea v-model="challengeForm.attachments" class="w-full" :rows="3" placeholder='["https://example.com/files/challenge.zip"]' />
            </UFormField>

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
              <UInput v-model="challengeForm.flag" class="w-full" placeholder="flag{example}" />
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

            <UFormField label="是否可见" name="is_visible">
              <USwitch v-model="challengeForm.is_visible" />
            </UFormField>

            <UButton type="submit" :loading="challengeSubmitting">
              创建题目
            </UButton>
          </UForm>
        </UPageCard>

        <UPageCard title="编辑题目" icon="i-lucide-file-pen-line">
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
              <UTextarea v-model="challengeEditForm.attachments" class="w-full" :rows="3" placeholder='["https://example.com/files/challenge.zip"]' />
            </UFormField>

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

            <UFormField label="是否可见" name="is_visible">
              <USwitch v-model="challengeEditForm.is_visible" />
            </UFormField>

            <div v-if="selectedEditableChallenge" class="rounded-lg border border-default px-3 py-3 text-sm text-muted">
              正在编辑：{{ selectedEditableChallenge.title }} · {{ selectedEditableChallenge.category }}
            </div>

            <UButton type="submit" :loading="challengeEditing">
              保存题目信息
            </UButton>
          </UForm>
        </UPageCard>
      </div>

      <div class="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <UPageCard id="attach-challenge" title="比赛挂题" icon="i-lucide-link">
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

            <UButton type="submit" :loading="attachSubmitting" :disabled="loadingResources">
              加入比赛
            </UButton>
          </UForm>

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

            <div v-else-if="selectedGame && !loadingGameChallenges" class="text-sm text-muted">
              这个比赛还没有挂载题目。
            </div>
          </div>
        </UPageCard>

        <div class="space-y-6">
          <UPageCard title="导入比赛包" icon="i-lucide-upload">
            <div class="space-y-4">
              <p class="text-sm text-muted">
                上传由后台导出的比赛 ZIP 包，系统会创建一场新的比赛和一组新的题目副本。
              </p>

              <UFormField label="ZIP 文件" name="import-file" description="支持 `sauryctf.export.v1` / `v2`，其中 `v2` 会额外恢复包内嵌入的本地附件文件。">
                <UFileUpload
                  v-model="importForm.file"
                  accept=".zip,application/zip"
                  class="min-h-32"
                  label="拖拽比赛包到这里"
                  description="或点击选择一个 ZIP 文件"
                />
              </UFormField>

              <div class="flex justify-end">
                <UButton
                  icon="i-lucide-file-up"
                  :loading="importingGame"
                  @click="importGamePackage"
                >
                  导入比赛
                </UButton>
              </div>
            </div>
          </UPageCard>

          <UPageCard title="参赛队伍" icon="i-lucide-users">
            <div v-if="selectedGame" class="mb-3 text-sm text-muted">
              {{ selectedGame.name }} · {{ loadingParticipants ? '正在加载队伍...' : `${participants.length} 支队伍` }}
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

            <div v-else-if="selectedGame && !loadingParticipants" class="text-sm text-muted">
              这场比赛还没有参赛队伍。
            </div>
          </UPageCard>

          <UPageCard title="Writeup 审核" icon="i-lucide-file-check">
            <div v-if="selectedGame" class="mb-3 text-sm text-muted">
              {{ selectedGame.name }} · {{ writeups.length }} 份 Writeup
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

            <div v-else-if="selectedGame" class="text-sm text-muted">
              这场比赛还没有队伍提交 Writeup。
            </div>
          </UPageCard>

          <UPageCard title="已加载资源" icon="i-lucide-list">
            <div class="grid gap-5 md:grid-cols-2 xl:grid-cols-1">
            <div>
              <div class="mb-2 text-sm font-medium">
                比赛列表
              </div>
              <div v-if="games.length" class="space-y-2 text-sm">
                <div
                  v-for="game in games"
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
              <div v-else class="text-sm text-muted">
                暂无比赛
              </div>
            </div>

            <div>
              <div class="mb-2 text-sm font-medium">
                题目列表
              </div>
              <div v-if="challenges.length" class="space-y-2 text-sm">
                <div
                  v-for="challenge in challenges"
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
              <div v-else class="text-sm text-muted">
                暂无题目
              </div>
            </div>
          </div>
          </UPageCard>
        </div>
      </div>
    </div>
  </div>
</template>
