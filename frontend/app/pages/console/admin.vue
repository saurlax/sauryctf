<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
})

const { authState, fetchUser } = useAuth()
const router = useRouter()
const toast = useToast()

const isAdmin = computed(() => ['admin', 'super_admin'].includes(authState.user?.role || ''))

const gameForm = reactive({
  name: '',
  description: '',
  start_time: '',
  end_time: '',
  is_public: true,
})

const challengeForm = reactive({
  title: '',
  description: '',
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

const gameSubmitting = ref(false)
const challengeSubmitting = ref(false)
const attachSubmitting = ref(false)
const loadingResources = ref(false)
const loadingGameChallenges = ref(false)
const removingChallengeId = ref<number | null>(null)
const games = ref<Array<{
  id: number
  name: string
  status: 'draft' | 'active' | 'ended'
  start_time: string
  end_time: string
}>>([])
const challenges = ref<Array<{
  id: number
  title: string
  category: 'web' | 'pwn' | 'crypto' | 'reverse' | 'misc' | 'forensics' | 'awd'
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
}>>([])

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

const gameOptions = computed(() => games.value.map(game => ({
  label: `#${game.id} ${game.name}`,
  value: game.id,
})))

const challengeOptions = computed(() => challenges.value.map(challenge => ({
  label: `#${challenge.id} ${challenge.title}`,
  value: challenge.id,
})))

const selectedGame = computed(() => games.value.find(game => game.id === attachForm.game_id) || null)

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
    selectedGameChallenges.value = await $api('get', '/api/games/{id}/challenges', {
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

async function createGame() {
  gameSubmitting.value = true
  try {
    await $api('post', '/api/games', {
      body: {
        name: gameForm.name,
        description: gameForm.description,
        start_time: new Date(gameForm.start_time).toISOString(),
        end_time: new Date(gameForm.end_time).toISOString(),
        is_public: gameForm.is_public,
      },
    })
    toast.add({ title: '比赛创建成功', color: 'success' })
    gameForm.name = ''
    gameForm.description = ''
    gameForm.start_time = ''
    gameForm.end_time = ''
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

watch(() => attachForm.game_id, async () => {
  await loadSelectedGameChallenges()
})

onMounted(async () => {
  if (!authState.user) {
    await fetchUser()
  }

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

      <div class="grid gap-6 xl:grid-cols-2">
        <UPageCard title="创建比赛" icon="i-lucide-trophy">
          <UForm :state="gameForm" class="space-y-4" @submit="createGame">
            <UFormField label="比赛名称" name="name">
              <UInput v-model="gameForm.name" class="w-full" placeholder="例如：Spring CTF 2026" />
            </UFormField>

            <UFormField label="比赛描述" name="description">
              <UTextarea v-model="gameForm.description" class="w-full" :rows="4" placeholder="简要介绍比赛规则或主题" />
            </UFormField>

            <div class="grid gap-4 md:grid-cols-2">
              <UFormField label="开始时间" name="start_time">
                <UInput v-model="gameForm.start_time" type="datetime-local" class="w-full" />
              </UFormField>

              <UFormField label="结束时间" name="end_time">
                <UInput v-model="gameForm.end_time" type="datetime-local" class="w-full" />
              </UFormField>
            </div>

            <UFormField label="公开比赛" name="is_public">
              <USwitch v-model="gameForm.is_public" />
            </UFormField>

            <UButton type="submit" :loading="gameSubmitting">
              创建比赛
            </UButton>
          </UForm>
        </UPageCard>

        <UPageCard title="创建题目" icon="i-lucide-flag">
          <UForm :state="challengeForm" class="space-y-4" @submit="createChallenge">
            <UFormField label="题目名称" name="title">
              <UInput v-model="challengeForm.title" class="w-full" placeholder="例如：Easy XSS" />
            </UFormField>

            <UFormField label="题目描述" name="description">
              <UTextarea v-model="challengeForm.description" class="w-full" :rows="4" placeholder="题目简介、提示或附件说明" />
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
      </div>

      <div class="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <UPageCard title="比赛挂题" icon="i-lucide-link">
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
                  <div class="text-sm text-muted">
                    {{ challenge.category }} · {{ challenge.score }} 分 · {{ challenge.solve_count || 0 }} 解
                    <span v-if="challenge.blood_team"> · 一血 {{ challenge.blood_team }}</span>
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

        <UPageCard title="已加载资源" icon="i-lucide-list">
          <div class="grid gap-5 md:grid-cols-2 xl:grid-cols-1">
            <div>
              <div class="mb-2 text-sm font-medium">
                比赛列表
              </div>
              <div v-if="games.length" class="space-y-2 text-sm">
                <div v-for="game in games" :key="game.id" class="rounded-lg border border-default px-3 py-2">
                  <div class="font-medium">
                    #{{ game.id }} {{ game.name }}
                  </div>
                  <div class="text-muted">
                    {{ game.status }} · {{ new Date(game.start_time).toLocaleString() }}
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
                <div v-for="challenge in challenges" :key="challenge.id" class="rounded-lg border border-default px-3 py-2">
                  <div class="font-medium">
                    #{{ challenge.id }} {{ challenge.title }}
                  </div>
                  <div class="text-muted">
                    {{ challenge.category }} · {{ challenge.is_visible ? 'visible' : 'hidden' }}
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
</template>
