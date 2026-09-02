<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'
import type {
  CreateTeamRequest,
  InviteRotatedResponse,
  JoinTeamRequest,
  Team,
  TeamMember,
  TeamMutationResponse,
  TeamResponse,
  TransferCaptainRequest,
} from '~~/shared/contracts/teams'

definePageMeta({ middleware: 'auth' })

const { authState, ensureInitialized } = useAuth()
const route = useRoute()
const toast = useToast()

const createTeamSchema = z.object({
  name: z.string().trim().min(2, '队伍名称至少 2 个字符').max(80, '队伍名称最多 80 个字符'),
})
const joinTeamSchema = z.object({
  invite_code: z.string().trim().min(32, '邀请码格式无效').max(512, '邀请码格式无效'),
})
type CreateTeamForm = z.output<typeof createTeamSchema>
type JoinTeamForm = z.output<typeof joinTeamSchema>

const team = ref<Team | null>(null)
const oneTimeInviteCode = ref<string | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)
const createModalOpen = ref(false)
const joinModalOpen = ref(false)
const confirmModalOpen = ref(false)
const inviteBusy = ref(false)
const createBusy = ref(false)
const joinBusy = ref(false)
const confirmBusy = ref(false)
const memberBusyId = ref<string | null>(null)
const createForm = reactive<Partial<CreateTeamForm>>({ name: '' })
const joinForm = reactive<Partial<JoinTeamForm>>({ invite_code: '' })

type ConfirmAction =
  | { type: 'leave' }
  | { type: 'remove', member: TeamMember }
  | { type: 'transfer', member: TeamMember }
  | { type: 'rotate-invite' }

const confirmAction = ref<ConfirmAction | null>(null)

const currentUserId = computed(() => authState.user?.id)
const emailVerified = computed(() => authState.user?.email_verified === true)
const currentMember = computed(() => team.value?.members.find(member => member.user_id === currentUserId.value))
const isCaptain = computed(() => currentMember.value?.role === 'captain')
const teamLocked = computed(() => team.value?.lock.locked === true)
const contestRedirect = computed(() => resolveOptionalAuthRedirect(route.query.redirect))
const routeInvite = computed(() => typeof route.query.invite === 'string' ? route.query.invite.trim() : '')

const confirmContent = computed(() => {
  const action = confirmAction.value
  if (!action) return { title: '', description: '', label: '确认', color: 'primary' as const }
  if (action.type === 'leave') {
    return {
      title: '确认退出队伍',
      description: '退出后需要重新创建或加入队伍，才能继续参加团队比赛。',
      label: '确认退出',
      color: 'error' as const,
    }
  }
  if (action.type === 'remove') {
    return {
      title: '确认移除成员',
      description: `移除后，${action.member.username} 将立即离开当前队伍。`,
      label: '确认移除',
      color: 'error' as const,
    }
  }
  if (action.type === 'transfer') {
    return {
      title: '确认移交队长',
      description: `移交后，${action.member.username} 将成为队长，你将转为普通成员。`,
      label: '确认移交',
      color: 'warning' as const,
    }
  }
  return {
    title: '确认轮换邀请码',
    description: '旧邀请码会立即失效。新邀请码只展示在本次响应中，请及时复制保存。',
    label: '确认轮换',
    color: 'warning' as const,
  }
})

function withoutInvite(result: Team): Team {
  return { ...result, invite_code: null }
}

async function fetchTeam() {
  loading.value = true
  loadError.value = null
  try {
    const response = await $controlApi<TeamResponse>('get', '/api/teams')
    team.value = response.team
  }
  catch (error) {
    team.value = null
    loadError.value = controlPlaneErrorMessage(error)
  }
  finally {
    loading.value = false
  }
}

async function createTeam(event: FormSubmitEvent<CreateTeamForm>) {
  createBusy.value = true
  try {
    const response = await $controlApi<TeamMutationResponse, CreateTeamRequest>('post', '/api/teams', {
      body: { name: event.data.name },
    })
    oneTimeInviteCode.value = response.team.invite_code
    team.value = withoutInvite(response.team)
    createForm.name = ''
    createModalOpen.value = false
    toast.add({ title: '队伍创建成功', description: '请保存本次展示的邀请码。', color: 'success' })
  }
  catch (error) {
    toast.add({ title: '创建失败', description: controlPlaneErrorMessage(error), color: 'error' })
  }
  finally {
    createBusy.value = false
  }
}

async function joinTeam(event: FormSubmitEvent<JoinTeamForm>) {
  joinBusy.value = true
  try {
    const response = await $controlApi<TeamMutationResponse, JoinTeamRequest>('post', '/api/teams/join', {
      body: { invite_code: event.data.invite_code.trim() },
    })
    team.value = withoutInvite(response.team)
    joinForm.invite_code = ''
    joinModalOpen.value = false
    toast.add({ title: '已加入队伍', color: 'success' })
    if (contestRedirect.value) await navigateTo(contestRedirect.value)
  }
  catch (error) {
    toast.add({ title: '加入失败', description: controlPlaneErrorMessage(error), color: 'error' })
  }
  finally {
    joinBusy.value = false
  }
}

async function rotateInvite() {
  inviteBusy.value = true
  try {
    const response = await $controlApi<InviteRotatedResponse>('post', '/api/teams/invite/rotate')
    oneTimeInviteCode.value = response.invite_code
    toast.add({ title: '邀请码已轮换', description: '旧邀请码已失效。', color: 'success' })
  }
  finally {
    inviteBusy.value = false
  }
}

async function leaveTeam() {
  await $controlApi('post', '/api/teams/leave')
  team.value = null
  oneTimeInviteCode.value = null
  toast.add({ title: '已退出队伍', color: 'success' })
}

async function removeMember(member: TeamMember) {
  memberBusyId.value = member.user_id
  try {
    await $controlApi('delete', '/api/teams/members/{userId}', {
      params: { userId: member.user_id },
    })
    await fetchTeam()
    toast.add({ title: '成员已移除', description: `${member.username} 已离开队伍。`, color: 'success' })
  }
  finally {
    memberBusyId.value = null
  }
}

async function transferCaptain(member: TeamMember) {
  memberBusyId.value = member.user_id
  try {
    const response = await $controlApi<TeamMutationResponse, TransferCaptainRequest>('post', '/api/teams/captain/transfer', {
      body: { user_id: member.user_id },
    })
    team.value = withoutInvite(response.team)
    oneTimeInviteCode.value = null
    toast.add({ title: '队长已移交', description: `${member.username} 现在是队长。`, color: 'success' })
  }
  finally {
    memberBusyId.value = null
  }
}

function openConfirmation(action: ConfirmAction) {
  confirmAction.value = action
  confirmModalOpen.value = true
}

function openCreateModal() {
  createModalOpen.value = true
}

function openJoinModal() {
  joinModalOpen.value = true
}

function dismissInvite() {
  oneTimeInviteCode.value = null
}

function closeConfirmation() {
  confirmModalOpen.value = false
}

function clearConfirmation() {
  confirmAction.value = null
}

watch(confirmModalOpen, (open) => {
  if (!open && !confirmBusy.value) clearConfirmation()
})

async function submitConfirmation() {
  const action = confirmAction.value
  if (!action) return
  confirmBusy.value = true
  try {
    if (action.type === 'leave') await leaveTeam()
    if (action.type === 'remove') await removeMember(action.member)
    if (action.type === 'transfer') await transferCaptain(action.member)
    if (action.type === 'rotate-invite') await rotateInvite()
    confirmModalOpen.value = false
    clearConfirmation()
  }
  catch (error) {
    toast.add({ title: '操作失败', description: controlPlaneErrorMessage(error), color: 'error' })
  }
  finally {
    confirmBusy.value = false
  }
}

async function copyText(value: string, successTitle: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.add({ title: successTitle, color: 'success' })
  }
  catch (error) {
    toast.add({ title: '复制失败', description: controlPlaneErrorMessage(error), color: 'error' })
  }
}

async function copyInviteLink() {
  if (!oneTimeInviteCode.value) return
  const url = new URL('/console/team', window.location.origin)
  url.searchParams.set('invite', oneTimeInviteCode.value)
  if (contestRedirect.value) url.searchParams.set('redirect', contestRedirect.value)
  await copyText(url.toString(), '邀请入口已复制')
}

onMounted(async () => {
  await ensureInitialized()
  if (routeInvite.value) joinForm.invite_code = routeInvite.value
  if (emailVerified.value) await fetchTeam()
  else loading.value = false
  if (!team.value && routeInvite.value && emailVerified.value) joinModalOpen.value = true
})
</script>

<template>
  <div class="py-8">
    <div class="mb-8 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-3xl font-bold">
          我的队伍
        </h1>
        <p class="mt-2 text-sm text-muted">
          队伍成员关系由平台统一维护，创建者自动成为队长。
        </p>
      </div>
      <UButton v-if="contestRedirect" :to="contestRedirect" variant="ghost" icon="i-lucide-arrow-left">
        返回原页面
      </UButton>
    </div>

    <div v-if="loading" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-2" class="size-8 animate-spin" />
    </div>

    <UPageCard
      v-else-if="!emailVerified"
      title="验证邮箱后使用队伍功能"
      description="队伍创建、加入和成员变更需要已验证邮箱。"
      icon="i-lucide-mail-check"
    >
      <template #footer>
        <UButton to="/console/account" icon="i-lucide-shield-check">
          前往账号安全
        </UButton>
      </template>
    </UPageCard>

    <UPageCard
      v-else-if="loadError"
      title="队伍信息暂时不可用"
      :description="loadError"
      icon="i-lucide-circle-alert"
    >
      <template #footer>
        <UButton icon="i-lucide-refresh-cw" @click="fetchTeam()">
          重新加载
        </UButton>
      </template>
    </UPageCard>

    <template v-else-if="team">
      <div class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.6fr)]">
        <UPageCard :title="team.name" icon="i-lucide-users">
          <template #description>
            当前共 {{ team.members.length }} 名成员，你的身份是{{ isCaptain ? '队长' : '队员' }}。
          </template>

          <div class="space-y-3">
            <div
              v-if="teamLocked"
              class="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3"
            >
              <div class="flex items-center gap-2 font-medium text-highlighted">
                <UIcon name="i-lucide-lock" class="size-4" />
                <span>队伍成员已锁定</span>
              </div>
              <p class="mt-2 text-sm leading-6 text-muted">
                队伍已通过下列未结束比赛的报名。比赛结束前，普通成员操作不能改变队伍结构。
              </p>
              <div class="mt-3 space-y-2">
                <div
                  v-for="contest in team.lock.contests"
                  :key="contest.id"
                  class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-default px-3 py-2 text-sm"
                >
                  <span class="font-medium text-highlighted">{{ contest.title }}</span>
                  <span class="text-muted">结束于 {{ new Date(contest.end_at).toLocaleString() }}</span>
                </div>
              </div>
            </div>

            <div
              v-for="member in team.members"
              :key="member.user_id"
              class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default px-4 py-3"
            >
              <div class="min-w-0">
                <div class="font-medium text-highlighted">
                  {{ member.username }}
                </div>
                <div class="mt-1 text-xs text-muted">
                  加入于 {{ new Date(member.joined_at).toLocaleString() }}
                </div>
              </div>
              <div class="flex items-center gap-2">
                <UBadge :color="member.role === 'captain' ? 'primary' : 'neutral'" variant="subtle">
                  {{ member.role === 'captain' ? '队长' : '队员' }}
                </UBadge>
                <template v-if="isCaptain && member.user_id !== currentUserId">
                  <UButton
                    size="xs"
                    variant="ghost"
                    icon="i-lucide-crown"
                    :disabled="teamLocked"
                    :loading="memberBusyId === member.user_id"
                    @click="openConfirmation({ type: 'transfer', member })"
                  >
                    移交队长
                  </UButton>
                  <UButton
                    size="xs"
                    color="error"
                    variant="ghost"
                    icon="i-lucide-user-round-minus"
                    :disabled="teamLocked"
                    :loading="memberBusyId === member.user_id"
                    @click="openConfirmation({ type: 'remove', member })"
                  >
                    移除
                  </UButton>
                </template>
              </div>
            </div>
          </div>
        </UPageCard>

        <div class="space-y-6">
          <UPageCard title="队伍操作" icon="i-lucide-settings-2">
            <div class="space-y-3 text-sm text-muted">
              <p v-if="isCaptain">
                {{ teamLocked
                  ? '锁定期间不能移除成员或移交队长；邀请码仍可轮换，但新成员需等待相关比赛结束后加入。'
                  : '队长可以移除成员、轮换邀请码并将队长身份移交给其他成员。' }}
              </p>
              <p v-else>
                普通队员可以退出队伍；成员管理和邀请码轮换由队长负责。
              </p>
            </div>
            <template #footer>
              <div class="flex flex-wrap gap-2">
                <UButton
                  v-if="isCaptain"
                  icon="i-lucide-refresh-cw"
                  variant="outline"
                  :loading="inviteBusy"
                  @click="openConfirmation({ type: 'rotate-invite' })"
                >
                  生成新邀请码
                </UButton>
                <UButton
                  v-else
                  color="error"
                  variant="outline"
                  icon="i-lucide-log-out"
                  :disabled="teamLocked"
                  @click="openConfirmation({ type: 'leave' })"
                >
                  退出队伍
                </UButton>
              </div>
            </template>
          </UPageCard>

          <UPageCard title="成员约束" icon="i-lucide-shield-check">
            <div class="space-y-3 text-sm text-muted">
              <div class="flex justify-between gap-3">
                <span>单用户队伍数</span><span>最多 1 支</span>
              </div>
              <div class="flex justify-between gap-3">
                <span>每队队长数</span><span>恰好 1 名</span>
              </div>
              <div class="flex justify-between gap-3">
                <span>邀请码保存</span><span>仅保存摘要</span>
              </div>
            </div>
          </UPageCard>
        </div>

        <UPageCard
          v-if="oneTimeInviteCode"
          class="xl:col-span-2"
          title="新邀请码仅展示一次"
          description="平台不会保存邀请码明文。关闭本提示后，如需再次邀请队员，请由队长轮换邀请码。"
          icon="i-lucide-key-round"
        >
          <div class="rounded-lg border border-default bg-elevated/50 px-4 py-3 font-mono text-sm break-all">
            {{ oneTimeInviteCode }}
          </div>
          <template #footer>
            <div class="flex flex-wrap gap-2">
              <UButton icon="i-lucide-copy" @click="copyText(oneTimeInviteCode, '邀请码已复制')">
                复制邀请码
              </UButton>
              <UButton icon="i-lucide-link" variant="outline" @click="copyInviteLink()">
                复制邀请入口
              </UButton>
              <UButton variant="ghost" @click="dismissInvite()">
                我已保存
              </UButton>
            </div>
          </template>
        </UPageCard>
      </div>
    </template>

    <div v-else class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
      <UPageCard title="创建或加入队伍" icon="i-lucide-users">
        <p class="text-sm leading-6 text-muted">
          比赛报名、正式提交和成绩归属均以队伍为单位。创建队伍后你将成为队长，也可以使用有效邀请码加入现有队伍。
        </p>
        <template #footer>
          <div class="flex flex-wrap gap-2">
            <UButton icon="i-lucide-plus" @click="openCreateModal()">
              创建队伍
            </UButton>
            <UButton icon="i-lucide-log-in" variant="outline" @click="openJoinModal()">
              加入队伍
            </UButton>
          </div>
        </template>
      </UPageCard>

      <UPageCard title="组队边界" icon="i-lucide-shield-check">
        <div class="space-y-3 text-sm text-muted">
          <p>每个账号同时只能属于一支队伍。</p>
          <p>邀请码不可查询历史明文，队长可以随时轮换并撤销旧邀请码。</p>
          <p>队长退出前需要先将队长身份移交给其他成员。</p>
          <p>队伍通过未结束比赛的报名后，成员结构会自动锁定。</p>
        </div>
      </UPageCard>
    </div>
  </div>

  <UModal
    v-model:open="createModalOpen"
    title="创建队伍"
    description="创建者自动成为队长。"
    :dismissible="!createBusy"
    :ui="{ footer: 'justify-end' }"
  >
    <template #body>
      <UForm id="create-team-form" :schema="createTeamSchema" :state="createForm" @submit="createTeam">
        <UFormField label="队伍名称" name="name" required>
          <UInput v-model="createForm.name" class="w-full" placeholder="输入队伍名称" :disabled="createBusy" />
        </UFormField>
      </UForm>
    </template>
    <template #footer="{ close }">
      <UButton variant="ghost" :disabled="createBusy" @click="close()">
        取消
      </UButton>
      <UButton type="submit" form="create-team-form" :loading="createBusy">
        创建队伍
      </UButton>
    </template>
  </UModal>

  <UModal
    v-model:open="joinModalOpen"
    title="加入队伍"
    description="无效、已撤销和已过期的邀请码返回相同结果。"
    :dismissible="!joinBusy"
    :ui="{ footer: 'justify-end' }"
  >
    <template #body>
      <UForm id="join-team-form" :schema="joinTeamSchema" :state="joinForm" @submit="joinTeam">
        <UFormField label="邀请码" name="invite_code" required>
          <UInput v-model="joinForm.invite_code" class="w-full" placeholder="输入队伍邀请码" :disabled="joinBusy" />
        </UFormField>
      </UForm>
    </template>
    <template #footer="{ close }">
      <UButton variant="ghost" :disabled="joinBusy" @click="close()">
        取消
      </UButton>
      <UButton type="submit" form="join-team-form" :loading="joinBusy">
        加入队伍
      </UButton>
    </template>
  </UModal>

  <UModal
    v-model:open="confirmModalOpen"
    :title="confirmContent.title"
    :description="confirmContent.description"
    :dismissible="!confirmBusy"
    :ui="{ footer: 'justify-end' }"
  >
    <template #footer>
      <UButton variant="ghost" :disabled="confirmBusy" @click="closeConfirmation()">
        取消
      </UButton>
      <UButton
        :color="confirmContent.color"
        :loading="confirmBusy"
        @click="submitConfirmation()"
      >
        {{ confirmContent.label }}
      </UButton>
    </template>
  </UModal>
</template>
