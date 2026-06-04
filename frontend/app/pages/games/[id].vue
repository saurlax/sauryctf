<script setup lang="ts">
import type { components } from '~/types/api'

type Game = components['schemas']['Game']
type GameChallengeDetail = components['schemas']['GameChallengeDetail']
type ScoreboardEntry = components['schemas']['ScoreboardEntry']
type GameParticipation = components['schemas']['GameParticipation']
type ScoreboardChallengeStat = components['schemas']['ScoreboardChallengeStat']

const route = useRoute()
const toast = useToast()
const { authState, fetchUser } = useAuth()
const isAdmin = computed(() => ['admin', 'super_admin'].includes(authState.user?.role || ''))

const game = ref<Game | null>(null)
const challenges = ref<GameChallengeDetail[]>([])
const scoreboard = ref<ScoreboardEntry[]>([])
const scoreboardChallenges = ref<ScoreboardChallengeStat[]>([])
const participation = ref<GameParticipation | null>(null)
const loading = ref(true)
const participationLoading = ref(false)
const joining = ref(false)
const leaving = ref(false)
const activeTab = ref('challenges')
const submitting = ref<number | null>(null) // challenge id being submitted
const flagInputs = reactive<Record<number, string>>({})
const now = ref(Date.now())

const gameId = route.params.id as string

async function fetchAll() {
  loading.value = true
  try {
    const gameRequest = $api('get', '/api/games/{id}', { params: { id: Number(gameId) } })
    const challengesRequest = $api('get', '/api/games/{id}/challenges', { params: { id: Number(gameId) } })
    const participationRequest = authState.user
      ? $api('get', '/api/games/{id}/participation', { params: { id: Number(gameId) } })
      : Promise.resolve(null)

    const [gameRes, challengesRes, participationRes] = await Promise.all([
      gameRequest,
      challengesRequest,
      participationRequest,
    ])
    game.value = gameRes
    challenges.value = challengesRes
    participation.value = participationRes
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

async function fetchScoreboard() {
  try {
    const res = await $api('get', '/api/games/{id}/scoreboard', { params: { id: Number(gameId) } })
    scoreboard.value = res.entries || []
    scoreboardChallenges.value = res.challenges || []
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
    toast.add({ title: '报名申请已提交', description: '等待管理员审核通过后即可正式参赛。', color: 'success' })
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
  && gameStatusMeta.value.label === '未开始',
)

const canSubmitFlag = computed(() =>
  !!authState.user
  && participation.value?.status === 'accepted'
  && gameStatusMeta.value.label === '进行中',
)

const participationHint = computed(() => {
  if (!authState.user) {
    return {
      title: '请先登录',
      description: '登录后即可查看你的队伍状态，并决定是否报名当前比赛。',
      color: 'neutral' as const,
    }
  }

  if (!participation.value?.has_team) {
    return {
      title: '需要先加入队伍',
      description: '当前比赛以内队形式参赛。请先创建或加入队伍，再返回此页面报名。',
      color: 'warning' as const,
    }
  }

  if (participation.value.participated) {
    if (participation.value.status === 'pending') {
      return {
        title: '报名待审核',
        description: '当前队伍已经提交报名，等待管理员审核通过后才能正式参赛与提交 Flag。',
        color: 'warning' as const,
      }
    }

    if (participation.value.status === 'rejected') {
      return {
        title: '报名已被拒绝',
        description: '当前队伍的报名未通过。你可以根据比赛公告调整后重新提交报名申请。',
        color: 'error' as const,
      }
    }

    if (canLeaveGame.value) {
      return {
        title: '当前已报名，可在开赛前退赛',
        description: '队伍已进入比赛。若信息有误，可以在比赛开始前退出。',
        color: 'success' as const,
      }
    }

    return {
      title: '当前已报名',
      description: gameStatusMeta.value.label === '进行中'
        ? '比赛进行中，当前队伍可以直接前往题目区提交 Flag。'
        : '比赛开始后不可退赛；比赛结束后也无法继续提交 Flag。',
      color: 'success' as const,
    }
  }

  if (gameStatusMeta.value.label === '已结束') {
    return {
      title: '比赛已结束，无法再报名',
      description: '你仍然可以查看比赛信息、题目和排行榜，但不能再加入本场比赛。',
      color: 'error' as const,
    }
  }

  return {
    title: '当前可报名',
    description: '当前队伍尚未报名，进入本场比赛前请确认队伍成员已准备完成。',
    color: 'info' as const,
  }
})

const submitHint = computed(() => {
  if (!authState.user) {
    return '请先登录后再参与比赛。'
  }
  if (!participation.value?.has_team) {
    return '当前需要先加入队伍，才能报名比赛并提交 Flag。'
  }
  if (!participation.value.participated) {
    return '当前队伍尚未报名本场比赛，请先在上方完成报名。'
  }
  if (participation.value.status === 'pending') {
    return '当前报名还在等待管理员审核，审核通过后才可以提交 Flag。'
  }
  if (participation.value.status === 'rejected') {
    return '当前报名已被拒绝，请重新报名或联系管理员确认参赛资格。'
  }
  if (gameStatusMeta.value.label === '未开始') {
    return '比赛尚未开始，当前暂时不能提交 Flag。'
  }
  if (gameStatusMeta.value.label === '已结束') {
    return '比赛已结束，当前不能继续提交 Flag。'
  }
  return '当前队伍已具备提交资格。'
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

const tabItems = [
  { label: '概览', value: 'overview', icon: 'i-lucide-layout-template' },
  { label: '题目', value: 'challenges', icon: 'i-lucide-flag' },
  { label: '排行榜', value: 'scoreboard', icon: 'i-lucide-trophy' },
]

watch(activeTab, (v) => {
  if (v === 'scoreboard') fetchScoreboard()
})

onMounted(async () => {
  if (!authState.user) {
    await fetchUser()
  }
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

      <UPageCard v-if="authState.user" class="mb-6">
        <div class="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p class="text-sm text-muted mb-1">
              我的报名状态
            </p>
            <div v-if="participationLoading" class="flex items-center gap-2 text-sm text-muted">
              <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
              <span>加载中...</span>
            </div>
            <div v-else class="flex items-center gap-2 flex-wrap">
              <UBadge
                :color="participation?.participated ? 'success' : participation?.has_team ? 'warning' : 'neutral'"
                variant="soft"
              >
                {{ participation?.participated ? '已报名' : participation?.has_team ? '未报名' : '未加入队伍' }}
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
              v-if="participation?.has_team && !participation?.participated"
              icon="i-lucide-badge-plus"
              :loading="joining"
              :disabled="!canJoinGame"
              @click="joinGame"
            >
              报名比赛
            </UButton>
            <UButton
              v-else-if="participation?.participated"
              color="error"
              variant="outline"
              icon="i-lucide-log-out"
              :loading="leaving"
              :disabled="!canLeaveGame"
              @click="leaveGame"
            >
              退出比赛
            </UButton>
            <UButton
              v-else
              to="/console/team"
              variant="outline"
              icon="i-lucide-users"
            >
              去加入队伍
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
                <li>2. 题目页会根据你当前队伍显示已解状态和一血队伍。</li>
                <li>3. 比赛开始后不可退出比赛，比赛结束后将无法继续得分。</li>
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
                    {{ ch.description || '当前题目暂未填写详细题面。' }}
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
                      <div class="flex items-center justify-between gap-3">
                        <span class="text-muted">一血队伍</span>
                        <span>{{ challenge.blood_team || '暂无' }}</span>
                      </div>
                    </div>
                  </UPageCard>
                </div>
              </UPageCard>
            </div>
          </UPageCard>
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
