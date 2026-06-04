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

const gameSubmitting = ref(false)
const challengeSubmitting = ref(false)

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
  }
  catch (e: any) {
    toast.add({ title: '题目创建失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    challengeSubmitting.value = false
  }
}

onMounted(async () => {
  if (!authState.user) {
    await fetchUser()
  }

  if (!isAdmin.value) {
    await router.push('/console')
    toast.add({ title: '无权限访问管理页', color: 'warning' })
  }
})
</script>

<template>
  <div class="py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-bold">
        赛事管理
      </h1>
      <p class="text-muted mt-1">
        使用现有管理 API 创建比赛和题目
      </p>
    </div>

    <div v-if="!isAdmin" class="text-sm text-muted">
      正在校验权限...
    </div>

    <div v-else class="grid gap-6 xl:grid-cols-2">
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
  </div>
</template>
