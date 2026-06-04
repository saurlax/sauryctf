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
    const tasks: Promise<unknown>[] = [
      $api('get', '/api/games/{id}', { params: { id: Number(gameId) } }),
      $api('get', '/api/games/{id}/challenges', { params: { id: Number(gameId) } }),
    ]

    if (authState.user) {
      tasks.push($api('get', '/api/games/{id}/participation', { params: { id: Number(gameId) } }))
    }

    const [gameRes, challengesRes, participationRes] = await Promise.all(tasks)
    game.value = gameRes
    challenges.value = challengesRes || []
    participation.value = (participationRes as GameParticipation | undefined) || null
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
    toast.add({ title: '报名成功', color: 'success' })
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
          </div>

          <div class="flex gap-2">
            <UButton
              v-if="participation?.has_team && !participation?.participated"
              icon="i-lucide-badge-plus"
              :loading="joining"
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
            <div class="rounded-lg border border-default bg-muted/40 p-4">
              <p class="font-medium mb-2">
                参赛提示
              </p>
              <ul class="space-y-2 text-muted">
                <li>1. 先在控制台创建或加入队伍，再报名比赛。</li>
                <li>2. 题目页会根据你当前队伍显示已解状态和一血队伍。</li>
                <li>3. 比赛结束后将无法继续得分，请留意结束时间。</li>
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
                <span>{{ participation?.participated ? '是' : '否' }}</span>
              </div>
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

        <div v-else class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <UPageCard
            v-for="ch in challenges"
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

            <div v-if="!ch.solved" class="flex gap-2">
              <UInput
                v-model="flagInputs[ch.id]"
                placeholder="flag{...}"
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
            <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <UPageCard
                v-for="challenge in scoreboardChallenges"
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
      </div>
    </template>

    <div v-else class="text-center py-16">
      <p class="text-muted">
        比赛不存在
      </p>
    </div>
  </UContainer>
</template>
