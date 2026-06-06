<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({
  middleware: 'auth',
})

const { authState, ensureInitialized } = useAuth()
const toast = useToast()
const route = useRoute()

interface TeamInfo {
  id: number
  name: string
  invite_code: string
  status?: string
  lock?: {
    locked: boolean
    reason?: string
    games: Array<{
      game_id: number
      name: string
      start_time: string
      end_time: string
    }>
  }
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

const createTeamSchema = z.object({
  name: z.string().trim().min(2, '队伍名称至少 2 个字符').max(128, '队伍名称最多 128 个字符'),
})

const joinTeamSchema = z.object({
  invite_code: z.string().trim().min(1, '请输入邀请码'),
})

type CreateTeamSchema = z.output<typeof createTeamSchema>
type JoinTeamSchema = z.output<typeof joinTeamSchema>

const createForm = reactive<Partial<CreateTeamSchema>>({ name: '' })
const joinForm = reactive<Partial<JoinTeamSchema>>({ invite_code: '' })
const createLoading = ref(false)
const joinLoading = ref(false)
const removingMemberId = ref<number | null>(null)
const transferringCaptainId = ref<number | null>(null)
const resettingInviteCode = ref(false)
const createTeamModalOpen = ref(false)
const joinTeamModalOpen = ref(false)
const confirmModalOpen = ref(false)
const confirmSubmitting = ref(false)

type ConfirmAction =
  | { type: 'leave' }
  | { type: 'remove-member', memberUserId: number, username?: string }
  | { type: 'transfer-captain', memberUserId: number, username?: string }
  | { type: 'reset-invite-code' }

const confirmAction = ref<{
  title: string
  description: string
  actionLabel: string
  color: 'error' | 'warning' | 'primary'
  payload: ConfirmAction | null
}>({
  title: '',
  description: '',
  actionLabel: '确认',
  color: 'primary',
  payload: null,
})

const currentUserId = computed(() => authState.user?.id)
const isCaptain = computed(() => team.value?.members?.some(member => member.user_id === currentUserId.value && member.role === 'captain') || false)
const teamMembers = computed(() => team.value?.members || [])
const removableMembers = computed(() => teamMembers.value.filter(member => member.user_id !== currentUserId.value))
const transferableMembers = computed(() => teamMembers.value.filter(member => member.user_id !== currentUserId.value))
const lockedGames = computed(() => team.value?.lock?.games || [])
const teamLocked = computed(() => !!team.value?.lock?.locked)
const memberCount = computed(() => teamMembers.value.length)
const joinInviteFromRoute = computed(() => {
  const invite = route.query.invite
  return typeof invite === 'string' ? invite.trim() : ''
})
const contestRedirect = computed(() => resolveRedirect())
const inviteFlowMeta = computed(() => {
  if (!joinInviteFromRoute.value && !contestRedirect.value) {
    return null
  }

  if (joinInviteFromRoute.value && contestRedirect.value) {
    return {
      title: team.value ? '当前队伍可直接返回原比赛' : '已识别邀请入口与比赛返回地址',
      description: team.value
        ? '当前链接同时包含邀请码与比赛返回地址。你现在可以继续维护队伍，或直接回到原比赛查看报名与题目状态。'
        : '页面已自动填入邀请码。加入队伍成功后，系统会自动回到原比赛页继续处理报名或查看题目。',
      color: 'info' as const,
      icon: 'i-lucide-route',
      actionLabel: team.value ? '返回原比赛' : '先看原比赛',
      actionTo: contestRedirect.value,
      secondaryLabel: team.value ? '浏览全部比赛' : undefined,
      secondaryTo: team.value ? '/games' : undefined,
    }
  }

  if (contestRedirect.value) {
    return {
      title: team.value ? '当前来自比赛参赛流程' : '当前来自比赛详情',
      description: team.value
        ? '你当前可以继续维护队伍，或直接返回原比赛页继续处理报名与参赛操作。'
        : '当前页面由比赛详情跳转而来。创建或加入队伍成功后，系统会返回原比赛页。',
      color: 'info' as const,
      icon: 'i-lucide-route',
      actionLabel: team.value ? '返回原比赛' : '先看原比赛',
      actionTo: contestRedirect.value,
      secondaryLabel: team.value ? '浏览全部比赛' : undefined,
      secondaryTo: team.value ? '/games' : undefined,
    }
  }

  return {
    title: team.value ? '当前已通过邀请入口加入队伍流程' : '已识别邀请入口',
    description: team.value
      ? '当前链接包含邀请码信息。若需要继续邀请其他队友，可直接复制下方邀请码或邀请入口。'
      : '页面已经自动填入邀请码，确认后即可直接加入队伍。',
    color: 'info' as const,
    icon: 'i-lucide-link',
    actionLabel: '浏览比赛',
    actionTo: '/games',
    secondaryLabel: '回控制台',
    secondaryTo: '/console',
  }
})
const teamEntryGuideMeta = computed(() => {
  if (joinInviteFromRoute.value && contestRedirect.value) {
    return {
      title: '先加入队伍，再回到原比赛继续处理',
      description: '当前链接同时包含邀请码和比赛返回地址。创建或加入成功后，系统会自动带你回到原比赛页。',
      color: 'info' as const,
      icon: 'i-lucide-route',
      actionLabel: '先看原比赛',
      actionTo: contestRedirect.value,
      secondaryLabel: '浏览全部比赛',
      secondaryTo: '/games',
    }
  }

  if (contestRedirect.value) {
    return {
      title: '当前尚未加入队伍',
      description: '你当前还没有队伍。可先创建队伍或使用邀请码加入，完成后会返回原比赛页继续后续操作。',
      color: 'info' as const,
      icon: 'i-lucide-route',
      actionLabel: '先看原比赛',
      actionTo: contestRedirect.value,
      secondaryLabel: '浏览全部比赛',
      secondaryTo: '/games',
    }
  }

  return {
    title: joinInviteFromRoute.value ? '当前尚未加入队伍' : '参赛前请先完成组队',
    description: joinInviteFromRoute.value
      ? '当前链接已经带入邀请码。加入成功后即可继续浏览比赛或参与报名流程。'
      : '比赛报名、提交 Flag 和排行榜都按队伍进行。请先创建或加入队伍，再前往比赛页继续后续操作。',
    color: joinInviteFromRoute.value ? 'info' as const : 'neutral' as const,
    icon: joinInviteFromRoute.value ? 'i-lucide-link' : 'i-lucide-flag',
    actionLabel: '浏览比赛',
    actionTo: '/games',
    secondaryLabel: '回控制台',
    secondaryTo: '/console',
  }
})
const teamEntryNoticeMeta = computed(() => inviteFlowMeta.value || teamEntryGuideMeta.value)

const teamNextStepMeta = computed(() => {
  if (!team.value) {
    return null
  }

  if (teamLocked.value) {
    return {
      title: '当前先保持队伍结构稳定',
      description: lockedGames.value.length
        ? `你们已经通过 ${lockedGames.value[0]?.name || '当前比赛'} 的报名，队伍结构会暂时锁定。现在更适合直接回比赛页继续解题、补 Writeup 或查看当前状态。`
        : '当前队伍已经进入锁定状态。现在更适合直接回比赛页继续处理参赛事项，而不是再调整成员。',
      color: 'warning' as const,
      icon: 'i-lucide-lock',
      actionLabel: contestRedirect.value ? '返回原比赛' : '浏览比赛',
      actionTo: contestRedirect.value || '/games',
      secondaryLabel: '查看队伍规则',
      secondaryTo: '/console/team',
    }
  }

  if (contestRedirect.value) {
    return {
      title: '队伍已可用于当前比赛',
      description: isCaptain.value
        ? '你可以直接返回原比赛继续处理报名，也可以先在当前页面补充队员。'
        : '你已加入当前队伍，现在可以返回原比赛继续查看报名状态、题目和排行榜。',
      color: 'info' as const,
      icon: 'i-lucide-route',
      actionLabel: '返回原比赛',
      actionTo: contestRedirect.value,
      secondaryLabel: isCaptain.value ? '查看队伍页' : '浏览更多比赛',
      secondaryTo: isCaptain.value ? '/console/team' : '/games',
    }
  }

  if (isCaptain.value && memberCount.value <= 1) {
    return {
      title: '队伍当前可继续扩充',
      description: '你当前是队长，可以继续邀请队友，也可以直接前往比赛页处理报名。',
      color: 'success' as const,
      icon: 'i-lucide-user-round-plus',
      actionLabel: '浏览比赛',
      actionTo: '/games',
      secondaryLabel: '继续维护队伍',
      secondaryTo: '/console/team',
    }
  }

  return {
    title: '队伍当前可继续参赛',
    description: isCaptain.value
      ? '队伍已具备基本参赛条件，可前往比赛页处理报名，并按比赛状态继续提交 Flag 或补交 Writeup。'
      : '你当前已在队伍中，可直接前往比赛页查看队伍的报名状态和参赛入口。',
    color: 'success' as const,
    icon: 'i-lucide-trophy',
    actionLabel: '浏览比赛',
    actionTo: '/games',
    secondaryLabel: '回控制台',
    secondaryTo: '/console',
  }
})

const summaryCards = computed(() => [
  {
    label: '成员数',
    value: memberCount.value ? `${memberCount.value} 人` : '0 人',
    hint: '创建者自动成为队长',
    icon: 'i-lucide-users',
    color: 'info' as const,
  },
  {
    label: '队伍状态',
    value: teamLocked.value ? '已锁定' : '可调整',
    hint: teamLocked.value ? '存在未结束且已通过报名的比赛' : '当前可邀请或调整成员',
    icon: teamLocked.value ? 'i-lucide-lock' : 'i-lucide-unlock',
    color: teamLocked.value ? 'warning' as const : 'success' as const,
  },
  {
    label: '锁定比赛',
    value: String(lockedGames.value.length),
    hint: lockedGames.value.length ? '下方可直接返回比赛页' : '当前没有比赛锁定队伍',
    icon: 'i-lucide-trophy',
    color: lockedGames.value.length ? 'warning' as const : 'neutral' as const,
  },
])

const managementSummaryRows = computed(() => {
  if (!team.value) {
    return []
  }

  return [
    {
      label: '当前角色',
      value: isCaptain.value ? '队长' : '队员',
    },
    {
      label: '邀请码状态',
      value: teamLocked.value ? '可轮换，不可扩员' : '可继续邀请',
    },
    {
      label: '可移除成员',
      value: isCaptain.value ? `${removableMembers.value.length} 人` : '仅队长可操作',
    },
    {
      label: '可移交队长',
      value: isCaptain.value ? `${transferableMembers.value.length} 人` : '仅队长可操作',
    },
    {
      label: '当前锁定比赛',
      value: `${lockedGames.value.length} 场`,
    },
    {
      label: '是否可直接退队',
      value: isCaptain.value ? '需先移交队长' : teamLocked.value ? '否，比赛锁定中' : '是',
    },
  ]
})

const teamManagementHint = computed(() => {
  if (!team.value) {
    return ''
  }

  if (teamLocked.value) {
    return isCaptain.value
      ? '当前队伍已进入比赛锁定期。你仍可轮换邀请码，但应保持现有成员结构，待相关比赛结束后再继续调整。'
      : '当前队伍已进入比赛锁定期。现在更适合直接返回比赛页继续参赛，而不是调整队伍结构。'
  }

  if (isCaptain.value) {
    return '你当前负责邀请码、成员调整和队长移交。若需要退出队伍，请先把队长身份移交给其他成员。'
  }

  return '你当前可继续参赛；如需离开队伍，可直接使用下方退出按钮，之后再加入其他队伍。'
})

function resolveRedirect() {
  const redirect = route.query.redirect
  if (typeof redirect === 'string' && redirect.startsWith('/')) {
    return redirect
  }
  return ''
}

async function navigateBackToContestIfNeeded() {
  if (!contestRedirect.value) {
    return
  }
  await navigateTo(contestRedirect.value)
}

function openInitialTeamEntryModal() {
  if (team.value) {
    return
  }

  if (joinInviteFromRoute.value) {
    joinTeamModalOpen.value = true
    createTeamModalOpen.value = false
    return
  }

  if (contestRedirect.value) {
    createTeamModalOpen.value = true
    joinTeamModalOpen.value = false
  }
}

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

async function createTeam(payload?: FormSubmitEvent<CreateTeamSchema>) {
  const teamName = payload?.data.name ?? createForm.name ?? ''

  createLoading.value = true
  try {
    const res = await $api('post', '/api/teams', {
      body: { name: teamName },
    })
    team.value = res.team
    createTeamModalOpen.value = false
    toast.add({ title: '队伍创建成功', color: 'success' })
    createForm.name = ''
    await navigateBackToContestIfNeeded()
  }
  catch (e: any) {
    toast.add({ title: '创建失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    createLoading.value = false
  }
}

async function joinTeam(payload?: FormSubmitEvent<JoinTeamSchema>) {
  const inviteCode = payload?.data.invite_code ?? joinForm.invite_code ?? ''

  joinLoading.value = true
  try {
    await $api('post', '/api/teams/join', {
      body: { invite_code: inviteCode },
    })
    await fetchTeam()
    joinTeamModalOpen.value = false
    toast.add({ title: '加入成功', color: 'success' })
    joinForm.invite_code = ''
    await navigateBackToContestIfNeeded()
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

function openLeaveTeamConfirm() {
  confirmAction.value = {
    title: '确认退出队伍',
    description: '退出后，你将离开当前队伍，需要重新加入或创建队伍后才能继续以团队身份参赛。',
    actionLabel: '确认退出',
    color: 'error',
    payload: { type: 'leave' },
  }
  confirmModalOpen.value = true
}

async function removeMember(memberUserId: number, username?: string) {
  if (!team.value) {
    return
  }

  removingMemberId.value = memberUserId
  try {
    await $api('delete', '/api/teams/{teamId}/members/{memberId}', {
      params: {
        teamId: team.value.id,
        memberId: memberUserId,
      },
    })
    await fetchTeam()
    toast.add({
      title: '成员已移除',
      description: username ? `${username} 已被移出队伍` : undefined,
      color: 'success',
    })
  }
  catch (e: any) {
    toast.add({ title: '移除失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    removingMemberId.value = null
  }
}

function openRemoveMemberConfirm(memberUserId: number, username?: string) {
  confirmAction.value = {
    title: '确认移除成员',
    description: username
      ? `移除 ${username} 后，对方将立即离开当前队伍。`
      : '移除后，该成员将立即离开当前队伍。',
    actionLabel: '确认移除',
    color: 'error',
    payload: { type: 'remove-member', memberUserId, username },
  }
  confirmModalOpen.value = true
}

async function transferCaptain(memberUserId: number, username?: string) {
  if (!team.value) {
    return
  }

  transferringCaptainId.value = memberUserId
  try {
    await $api('post', '/api/teams/{teamId}/transfer', {
      params: {
        teamId: team.value.id,
      },
      body: {
        target_user_id: memberUserId,
      },
    })
    await fetchTeam()
    toast.add({
      title: '队长已移交',
      description: username ? `当前队长已移交给 ${username}` : '当前队长已移交给指定成员',
      color: 'success',
    })
  }
  catch (e: any) {
    toast.add({ title: '移交失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    transferringCaptainId.value = null
  }
}

function openTransferCaptainConfirm(memberUserId: number, username?: string) {
  confirmAction.value = {
    title: '确认移交队长',
    description: username
      ? `移交后，${username} 将成为新队长，你将转为普通成员。`
      : '移交后，对方将成为新队长，你将转为普通成员。',
    actionLabel: '确认移交',
    color: 'warning',
    payload: { type: 'transfer-captain', memberUserId, username },
  }
  confirmModalOpen.value = true
}

async function copyInviteCode() {
  if (!team.value) return
  try {
    await navigator.clipboard.writeText(team.value.invite_code)
    toast.add({ title: '邀请码已复制', color: 'success' })
  }
  catch (e: any) {
    toast.add({ title: '复制失败', description: e.data?.message || e.message, color: 'error' })
  }
}

async function copyInviteLink() {
  if (!team.value) return
  try {
    const inviteUrl = new URL('/console/team', window.location.origin)
    inviteUrl.searchParams.set('invite', team.value.invite_code)
    if (contestRedirect.value) {
      inviteUrl.searchParams.set('redirect', contestRedirect.value)
    }
    const inviteLink = inviteUrl.toString()
    await navigator.clipboard.writeText(inviteLink)
    toast.add({
      title: '邀请入口已复制',
      description: contestRedirect.value
        ? '队友打开后会自动填入邀请码，加入后也会回到原比赛。'
        : '队友打开后会自动填入邀请码。',
      color: 'success',
    })
  }
  catch (e: any) {
    toast.add({ title: '复制失败', description: e.data?.message || e.message, color: 'error' })
  }
}

async function resetInviteCode() {
  if (!team.value) {
    return
  }

  resettingInviteCode.value = true
  try {
    const res = await $api('post', '/api/teams/{teamId}/invite-code/reset', {
      params: {
        teamId: team.value.id,
      },
    })
    await fetchTeam()
    toast.add({
      title: '邀请码已重置',
      description: res.invite_code ? `新的邀请码为 ${res.invite_code}` : '旧邀请码已失效，请使用新邀请码邀请队友。',
      color: 'success',
    })
  }
  catch (e: any) {
    toast.add({ title: '重置失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    resettingInviteCode.value = false
  }
}

function openResetInviteCodeConfirm() {
  confirmAction.value = {
    title: '确认重置邀请码',
    description: '重置后，旧邀请码会立即失效，后续需使用新的邀请码或新的邀请入口邀请队友。',
    actionLabel: '确认重置',
    color: 'warning',
    payload: { type: 'reset-invite-code' },
  }
  confirmModalOpen.value = true
}

async function submitConfirmAction() {
  if (!confirmAction.value.payload) {
    confirmModalOpen.value = false
    return
  }

  confirmSubmitting.value = true
  try {
    switch (confirmAction.value.payload.type) {
      case 'leave':
        await leaveTeam()
        break
      case 'remove-member':
        await removeMember(confirmAction.value.payload.memberUserId, confirmAction.value.payload.username)
        break
      case 'transfer-captain':
        await transferCaptain(confirmAction.value.payload.memberUserId, confirmAction.value.payload.username)
        break
      case 'reset-invite-code':
        await resetInviteCode()
        break
    }

    confirmModalOpen.value = false
    confirmAction.value.payload = null
  }
  finally {
    confirmSubmitting.value = false
  }
}

onMounted(async () => {
  await ensureInitialized()
  if (joinInviteFromRoute.value) {
    joinForm.invite_code = joinInviteFromRoute.value
  }
  await fetchTeam()
  openInitialTeamEntryModal()
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
      <div class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div v-if="inviteFlowMeta" class="xl:col-span-2">
          <div class="rounded-lg border border-default bg-elevated/50 px-4 py-3">
            <div class="flex items-start justify-between gap-4 flex-wrap">
              <div class="min-w-0">
                <div class="flex items-center gap-2 font-medium text-highlighted">
                  <UIcon :name="inviteFlowMeta.icon" class="size-4" />
                  <span>{{ inviteFlowMeta.title }}</span>
                </div>
                <p class="mt-2 text-sm text-muted leading-6">
                  {{ inviteFlowMeta.description }}
                </p>
              </div>
              <div class="flex flex-wrap gap-2">
                <UButton
                  :label="inviteFlowMeta.actionLabel"
                  :color="inviteFlowMeta.color"
                  variant="outline"
                  size="sm"
                  :to="inviteFlowMeta.actionTo"
                />
                <UButton
                  v-if="inviteFlowMeta.secondaryLabel && inviteFlowMeta.secondaryTo"
                  :label="inviteFlowMeta.secondaryLabel"
                  variant="ghost"
                  size="sm"
                  :to="inviteFlowMeta.secondaryTo"
                />
              </div>
            </div>
          </div>
        </div>
        <div v-if="teamNextStepMeta" class="xl:col-span-2">
          <div class="rounded-lg border border-default bg-elevated/50 px-4 py-3">
            <div class="flex items-start justify-between gap-4 flex-wrap">
              <div class="min-w-0">
                <div class="flex items-center gap-2 font-medium text-highlighted">
                  <UIcon :name="teamNextStepMeta.icon" class="size-4" />
                  <span>{{ teamNextStepMeta.title }}</span>
                </div>
                <p class="mt-2 text-sm text-muted leading-6">
                  {{ teamNextStepMeta.description }}
                </p>
              </div>
              <div class="flex flex-wrap gap-2">
                <UButton
                  size="sm"
                  :to="teamNextStepMeta.actionTo"
                  :label="teamNextStepMeta.actionLabel"
                  :color="teamNextStepMeta.color === 'warning' ? 'warning' : 'primary'"
                  variant="outline"
                />
                <UButton
                  v-if="teamNextStepMeta.secondaryLabel && teamNextStepMeta.secondaryTo"
                  size="sm"
                  :to="teamNextStepMeta.secondaryTo"
                  :label="teamNextStepMeta.secondaryLabel"
                  variant="ghost"
                />
              </div>
            </div>
          </div>
        </div>
        <div class="xl:col-span-2">
          <UPageGrid :cols="{ default: 1, sm: 3 }" class="mb-6">
            <UPageCard
              v-for="card in summaryCards"
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
        </div>

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
          <div
            v-if="teamLocked"
            class="rounded-lg border border-default bg-elevated/50 px-3 py-3"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2 font-medium text-highlighted">
                  <UIcon name="i-lucide-lock" class="size-4" />
                  <span>当前队伍已被比赛锁定</span>
                </div>
                <p class="mt-2 text-sm text-muted leading-6">
                  {{ isCaptain ? '你们已经通过至少一场仍未结束的比赛报名，当前不能加人、退队或移除成员。' : '你的队伍已经通过至少一场仍未结束的比赛报名，当前不能更改队伍成员。' }}
                </p>
              </div>
              <UBadge color="warning" variant="soft">
                锁定中
              </UBadge>
            </div>
          </div>

          <div>
            <p class="text-sm text-muted mb-1">
              邀请码
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <code class="bg-elevated px-3 py-1.5 rounded text-sm font-mono">
                {{ team.invite_code }}
              </code>
              <UButton
                icon="i-lucide-copy"
                variant="ghost"
                size="xs"
                :disabled="teamLocked"
                @click="copyInviteCode()"
              />
              <UButton
                label="复制邀请入口"
                icon="i-lucide-link"
                variant="ghost"
                size="xs"
                @click="copyInviteLink()"
              />
              <UButton
                v-if="isCaptain"
                label="重置邀请码"
                icon="i-lucide-refresh-cw"
                variant="ghost"
                size="xs"
                :loading="resettingInviteCode"
                @click="openResetInviteCodeConfirm()"
              />
            </div>
            <p v-if="teamLocked" class="mt-2 text-xs text-muted">
              锁定期间仍可轮换邀请码，但当前不能新增成员；如需继续邀请，请在相关比赛结束后再分发新邀请码。
            </p>
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
                <div class="flex items-center gap-2">
                  <UBadge
                    :label="member.role === 'captain' ? '队长' : '队员'"
                    :color="member.role === 'captain' ? 'primary' : 'neutral'"
                    size="sm"
                  />
                  <UButton
                    v-if="isCaptain && member.user_id !== currentUserId"
                    variant="ghost"
                    size="xs"
                    :disabled="teamLocked"
                    icon="i-lucide-crown"
                    :loading="transferringCaptainId === member.user_id"
                    @click="openTransferCaptainConfirm(member.user_id, member.username || member.user?.username)"
                  />
                  <UButton
                    v-if="isCaptain && member.user_id !== currentUserId"
                    color="error"
                    variant="ghost"
                    size="xs"
                    :disabled="teamLocked"
                    icon="i-lucide-user-round-minus"
                    :loading="removingMemberId === member.user_id"
                    @click="openRemoveMemberConfirm(member.user_id, member.username || member.user?.username)"
                  />
                </div>
              </div>
            </div>
          </div>
          <div v-if="lockedGames.length" class="space-y-2">
            <p class="text-sm text-muted">
              当前锁定中的比赛
            </p>
            <div
              v-for="game in lockedGames"
              :key="game.game_id"
              class="rounded-lg border border-default px-3 py-3"
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="font-medium">
                    {{ game.name }}
                  </div>
                  <div class="mt-1 text-xs text-muted">
                    开始：{{ new Date(game.start_time).toLocaleString() }}
                  </div>
                  <div class="mt-1 text-xs text-muted">
                    结束：{{ new Date(game.end_time).toLocaleString() }}
                  </div>
                </div>
                <UButton
                  label="查看比赛"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-arrow-up-right"
                  :to="`/games/${game.game_id}`"
                />
              </div>
            </div>
          </div>
        </div>

        <template #footer>
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              label="查看公开比赛"
              variant="ghost"
              icon="i-lucide-trophy"
              to="/games"
            />
            <UButton
              label="退出队伍"
              color="error"
              variant="outline"
              icon="i-lucide-log-out"
              :disabled="isCaptain || teamLocked"
              @click="openLeaveTeamConfirm()"
            />
          </div>
        </template>
        </UPageCard>

        <UPageCard :title="isCaptain ? '操作边界' : '当前操作'" :icon="isCaptain ? 'i-lucide-shield-check' : 'i-lucide-info'">
          <div class="space-y-4">
            <div class="space-y-3 text-sm">
              <div
                v-for="row in managementSummaryRows"
                :key="row.label"
                class="flex items-center justify-between gap-3"
              >
                <span class="text-muted">{{ row.label }}</span>
                <span class="text-right">{{ row.value }}</span>
              </div>
            </div>

            <div class="rounded-lg border border-default px-3 py-3 text-sm text-muted leading-6">
              {{ teamManagementHint }}
            </div>
          </div>
        </UPageCard>
      </div>
    </template>

    <template v-else>
      <div class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <UPageCard title="队伍入口" icon="i-lucide-users">
          <div class="space-y-4">
            <div class="rounded-lg border border-default bg-elevated/50 px-4 py-3">
              <div class="flex items-start justify-between gap-4 flex-wrap">
                <div class="min-w-0">
                  <div class="flex items-center gap-2 font-medium text-highlighted">
                    <UIcon :name="teamEntryNoticeMeta.icon" class="size-4" />
                    <span>{{ teamEntryNoticeMeta.title }}</span>
                  </div>
                  <p class="mt-2 text-sm text-muted leading-6">
                    {{ teamEntryNoticeMeta.description }}
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <UButton
                    size="sm"
                    :to="teamEntryNoticeMeta.actionTo"
                    :label="teamEntryNoticeMeta.actionLabel"
                    variant="outline"
                  />
                  <UButton
                    v-if="teamEntryNoticeMeta.secondaryLabel && teamEntryNoticeMeta.secondaryTo"
                    size="sm"
                    :to="teamEntryNoticeMeta.secondaryTo"
                    :label="teamEntryNoticeMeta.secondaryLabel"
                    variant="ghost"
                  />
                </div>
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <UButton icon="i-lucide-plus" @click="createTeamModalOpen = true">
                创建队伍
              </UButton>
              <UButton icon="i-lucide-log-in" variant="outline" @click="joinTeamModalOpen = true">
                加入队伍
              </UButton>
            </div>
          </div>
          <template #footer>
            <div class="flex flex-wrap items-center gap-2">
              <UButton label="浏览比赛" variant="ghost" icon="i-lucide-trophy" to="/games" />
              <UButton label="回到控制台" variant="outline" icon="i-lucide-layout-dashboard" to="/console" />
            </div>
          </template>
        </UPageCard>

        <UPageCard title="队伍规则" icon="i-lucide-shield-check">
          <div class="rounded-lg border border-default px-3 py-3 text-sm text-muted leading-6">
            比赛报名、Flag 提交和排行榜都按队伍进行。创建者自动成为队长；完成创建或加入后，可直接返回比赛页继续后续操作。
          </div>
        </UPageCard>
      </div>
    </template>
  </div>

  <UModal
    v-model:open="createTeamModalOpen"
    title="创建队伍"
    description="录入队伍名称后立即创建，创建者会自动成为队长。"
    :dismissible="!createLoading"
    :ui="{ body: 'space-y-4', footer: 'justify-end' }"
  >
    <template #body>
      <UForm
        id="create-team-form"
        :schema="createTeamSchema"
        :state="createForm"
        class="space-y-4"
        @submit="createTeam"
      >
        <UFormField label="队伍名称" name="name" required>
          <UInput
            v-model="createForm.name"
            placeholder="输入队伍名称"
            size="lg"
            class="w-full"
            :disabled="createLoading"
          />
        </UFormField>
      </UForm>
    </template>

    <template #footer="{ close }">
      <UButton variant="ghost" :disabled="createLoading" @click="close()">
        取消
      </UButton>
      <UButton type="submit" form="create-team-form" :loading="createLoading">
        创建队伍
      </UButton>
    </template>
  </UModal>

  <UModal
    v-model:open="joinTeamModalOpen"
    title="加入队伍"
    :description="joinInviteFromRoute
      ? '当前已自动带入邀请码，确认后即可加入队伍。'
      : '输入邀请码后即可加入现有队伍。'"
    :dismissible="!joinLoading"
    :ui="{ body: 'space-y-4', footer: 'justify-end' }"
  >
    <template #body>
      <UForm
        id="join-team-form"
        :schema="joinTeamSchema"
        :state="joinForm"
        class="space-y-4"
        @submit="joinTeam"
      >
        <UFormField label="邀请码" name="invite_code" required>
          <UInput
            v-model="joinForm.invite_code"
            placeholder="输入队伍邀请码"
            size="lg"
            class="w-full"
            :disabled="joinLoading"
          />
        </UFormField>
      </UForm>
    </template>

    <template #footer="{ close }">
      <UButton variant="ghost" :disabled="joinLoading" @click="close()">
        取消
      </UButton>
      <UButton type="submit" form="join-team-form" :loading="joinLoading">
        加入队伍
      </UButton>
    </template>
  </UModal>

  <UModal
    v-model:open="confirmModalOpen"
    :title="confirmAction.title"
    :description="confirmAction.description"
    :dismissible="!confirmSubmitting"
    :ui="{ footer: 'justify-end' }"
  >
    <template #footer>
      <UButton
        label="取消"
        color="neutral"
        variant="ghost"
        :disabled="confirmSubmitting"
        @click="confirmModalOpen = false"
      />
      <UButton
        :label="confirmAction.actionLabel"
        :color="confirmAction.color"
        :loading="confirmSubmitting"
        @click="submitConfirmAction()"
      />
    </template>
  </UModal>
</template>
