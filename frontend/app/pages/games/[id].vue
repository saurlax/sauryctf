<script setup lang="ts">
import type { components } from '~/types/api'

type Game = components['schemas']['Game']
type GameChallengeDetail = components['schemas']['GameChallengeDetail']
type ScoreboardEntry = components['schemas']['ScoreboardEntry']

const route = useRoute()
const toast = useToast()

const game = ref<Game | null>(null)
const challenges = ref<GameChallengeDetail[]>([])
const scoreboard = ref<ScoreboardEntry[]>([])
const loading = ref(true)
const activeTab = ref('challenges')
const submitting = ref<number | null>(null) // challenge id being submitted
const flagInputs = reactive<Record<number, string>>({})

const gameId = route.params.id as string

async function fetchAll() {
  loading.value = true
  try {
    const [gameRes, challengesRes] = await Promise.all([
      $api('get', '/api/games/{id}', { params: { id: Number(gameId) } }),
      $api('get', '/api/games/{id}/challenges', { params: { id: Number(gameId) } }),
    ])
    game.value = gameRes
    challenges.value = challengesRes || []
  }
  catch (e: any) {
    toast.add({ title: '获取比赛信息失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    loading.value = false
  }
}

async function fetchScoreboard() {
  try {
    const res = await $api('get', '/api/games/{id}/scoreboard', { params: { id: Number(gameId) } })
    scoreboard.value = res.entries || []
  }
  catch (e: any) {
    toast.add({ title: '获取排行榜失败', description: e.data?.message || e.message, color: 'error' })
  }
}

async function submitFlag(challengeId: number) {
  const flag = flagInputs[challengeId]
  if (!flag) return

  // Need team_id — get from authState or team info
  // For now, prompt user's team from the teams API
  const team = await $api('get', '/api/teams/my').catch(() => null)

  if (!team) {
    toast.add({ title: '请先加入队伍再提交', color: 'warning' })
    return
  }

  submitting.value = challengeId
  try {
    const res = await $api('post', '/api/games/{id}/challenges/{challengeId}/submit', {
      params: { id: Number(gameId), challengeId: challengeId },
      body: { flag, team_id: team.team.id },
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

const tabItems = [
  { label: '题目', value: 'challenges', icon: 'i-lucide-flag' },
  { label: '排行榜', value: 'scoreboard', icon: 'i-lucide-trophy' },
]

watch(activeTab, (v) => {
  if (v === 'scoreboard') fetchScoreboard()
})

onMounted(fetchAll)
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
            <h1 class="text-3xl font-bold mb-1">
              {{ game.name }}
            </h1>
            <p class="text-muted">
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

      <UTabs v-model="activeTab" :items="tabItems" class="mb-6" />

      <!-- Challenges Tab -->
      <div v-if="activeTab === 'challenges'">
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
      </div>
    </template>

    <div v-else class="text-center py-16">
      <p class="text-muted">
        比赛不存在
      </p>
    </div>
  </UContainer>
</template>
