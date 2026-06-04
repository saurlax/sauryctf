<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
})

const { authState, fetchUser } = useAuth()
const toast = useToast()

interface TeamInfo {
  id: number
  name: string
  invite_code: string
  status?: string
  members?: Array<{
    id: number
    user_id: number
    role: string
    username?: string
    user?: {
      username?: string
    }
  }>
}

const team = ref<TeamInfo | null>(null)
const loading = ref(true)

const createForm = reactive({ name: '' })
const joinForm = reactive({ invite_code: '' })
const createLoading = ref(false)
const joinLoading = ref(false)

async function fetchTeam() {
  loading.value = true
  try {
    const res = await $api('get', '/api/teams/my')
    team.value = res.team
  }
  catch {
    team.value = null
  }
  finally {
    loading.value = false
  }
}

async function createTeam() {
  if (!createForm.name.trim()) {
    toast.add({ title: '请输入队伍名称', color: 'error' })
    return
  }
  createLoading.value = true
  try {
    const res = await $api('post', '/api/teams', {
      body: { name: createForm.name },
    })
    team.value = res.team
    toast.add({ title: '队伍创建成功', color: 'success' })
    createForm.name = ''
  }
  catch (e: any) {
    toast.add({ title: '创建失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    createLoading.value = false
  }
}

async function joinTeam() {
  if (!joinForm.invite_code.trim()) {
    toast.add({ title: '请输入邀请码', color: 'error' })
    return
  }
  joinLoading.value = true
  try {
    await $api('post', '/api/teams/join', {
      body: { invite_code: joinForm.invite_code },
    })
    await fetchTeam()
    toast.add({ title: '加入成功', color: 'success' })
    joinForm.invite_code = ''
  }
  catch (e: any) {
    toast.add({ title: '加入失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    joinLoading.value = false
  }
}

async function leaveTeam() {
  try {
    await $api('post', '/api/teams/leave')
    team.value = null
    toast.add({ title: '已退出队伍', color: 'success' })
  }
  catch (e: any) {
    toast.add({ title: '退出失败', description: e.data?.message || e.message, color: 'error' })
  }
}

async function copyInviteCode() {
  if (!team.value) return
  await navigator.clipboard.writeText(team.value.invite_code)
  toast.add({ title: '已复制', color: 'success' })
}

onMounted(async () => {
  if (!authState.user) {
    await fetchUser()
  }
  await fetchTeam()
})
</script>

<template>
  <div class="py-8">
    <h1 class="text-3xl font-bold mb-8">
      我的队伍
    </h1>

    <template v-if="loading">
      <div class="flex justify-center py-16">
        <UIcon name="i-lucide-loader-2" class="animate-spin size-8" />
      </div>
    </template>

    <template v-else-if="team">
      <UPageCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-semibold">
              {{ team.name }}
            </h2>
            <UBadge :label="team.status" variant="subtle" />
          </div>
        </template>

        <div class="space-y-4">
          <div>
            <p class="text-sm text-muted mb-1">
              邀请码
            </p>
            <div class="flex items-center gap-2">
              <code class="bg-elevated px-3 py-1.5 rounded text-sm font-mono">
                {{ team.invite_code }}
              </code>
              <UButton
                icon="i-lucide-copy"
                variant="ghost"
                size="xs"
                @click="copyInviteCode()"
              />
            </div>
          </div>

          <div>
            <p class="text-sm text-muted mb-2">
              成员 ({{ team.members?.length || 0 }})
            </p>
            <div class="space-y-2">
              <div
                v-for="member in team.members"
                :key="member.id"
                class="flex items-center justify-between bg-elevated px-3 py-2 rounded"
              >
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-user" class="size-4" />
                  <span>{{ member.username || member.user?.username || `用户 #${member.user_id}` }}</span>
                </div>
                <UBadge
                  :label="member.role === 'captain' ? '队长' : '队员'"
                  :color="member.role === 'captain' ? 'primary' : 'neutral'"
                  size="sm"
                />
              </div>
            </div>
          </div>
        </div>

        <template #footer>
          <UButton
            label="退出队伍"
            color="error"
            variant="outline"
            icon="i-lucide-log-out"
            @click="leaveTeam"
          />
        </template>
      </UPageCard>
    </template>

    <template v-else>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <UPageCard title="创建队伍">
          <UForm :state="createForm" class="space-y-4" @submit="createTeam">
            <UFormField label="队伍名称" name="name">
              <UInput v-model="createForm.name" placeholder="输入队伍名称" size="lg" class="w-full" />
            </UFormField>
            <UButton type="submit" label="创建" :loading="createLoading" block />
          </UForm>
        </UPageCard>

        <UPageCard title="加入队伍">
          <UForm :state="joinForm" class="space-y-4" @submit="joinTeam">
            <UFormField label="邀请码" name="invite_code">
              <UInput v-model="joinForm.invite_code" placeholder="输入队伍邀请码" size="lg" class="w-full" />
            </UFormField>
            <UButton type="submit" label="加入" :loading="joinLoading" block />
          </UForm>
        </UPageCard>
      </div>
    </template>
  </div>
</template>
