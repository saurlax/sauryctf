<script setup lang="ts">
const route = useRoute()
const toast = useToast()
const { authState, ensureInitialized } = useAuth()

type ChallengeInstanceState = {
  game_id: number
  challenge_id: number
  team_id: number
  status: 'idle' | 'running'
  policy: {
    lease_duration_minutes: number
    extension_duration_minutes: number
    renewal_window_minutes: number
    team_active_limit: number
  }
  provider?: string
  image?: string
  launch_url?: string
  host?: string
  port?: string
  command?: string
  note?: string
  started_at?: string | null
  last_renewed_at?: string | null
  expires_at?: string | null
  seconds_left: number
  can_start: boolean
  can_renew: boolean
  message: string
}

const gameId = computed(() => Number(route.params.gameId || 0))
const challengeId = computed(() => Number(route.params.challengeId || 0))
const teamHash = computed(() => String(route.params.teamHash || ''))
const hintedTeamId = computed(() => typeof route.query.team === 'string' ? route.query.team : '')

const instanceState = ref<ChallengeInstanceState | null>(null)
const stateLoading = ref(false)
const stateRefreshing = ref(false)
const stateDestroying = ref(false)
const stateEnsuring = ref(false)
const stateLoadError = ref('')
const now = ref(Date.now())
const destroyConfirmModalOpen = ref(false)

const currentEntry = computed(() => instanceState.value?.launch_url || route.fullPath)
const hasRunningInstance = computed(() => instanceState.value?.status === 'running' && getSecondsLeft() > 0)
const loginLink = computed(() => `/login?redirect=${encodeURIComponent(route.fullPath)}`)

const pageLinks = computed(() => [
  {
    label: '返回比赛页',
    to: `/games/${gameId.value}`,
    icon: 'i-lucide-arrow-left',
    variant: 'outline' as const,
  },
  {
    label: '打开控制台',
    to: '/console',
    icon: 'i-lucide-layout-dashboard',
    variant: 'soft' as const,
  },
])

const summaryCards = computed(() => [
  {
    title: '比赛',
    value: gameId.value > 0 ? `#${gameId.value}` : '-',
    icon: 'i-lucide-trophy',
  },
  {
    title: '题目',
    value: challengeId.value > 0 ? `#${challengeId.value}` : '-',
    icon: 'i-lucide-flag',
  },
  {
    title: 'Team Hash',
    value: teamHash.value || '-',
    icon: 'i-lucide-fingerprint',
  },
  {
    title: 'Team ID',
    value: instanceState.value?.team_id ? String(instanceState.value.team_id) : (hintedTeamId.value || '-'),
    icon: 'i-lucide-users',
  },
])

const statusBadge = computed(() => {
  if (!instanceState.value) {
    return {
      label: stateLoadError.value ? '不可用' : '未获取',
      color: stateLoadError.value ? 'error' as const : 'neutral' as const,
    }
  }

  if (hasRunningInstance.value) {
    return {
      label: '运行中',
      color: 'success' as const,
    }
  }

  return {
    label: instanceState.value.status === 'idle' ? '待启动' : '不可用',
    color: instanceState.value.status === 'idle' ? 'neutral' as const : 'warning' as const,
  }
})

function formatDateTime(value?: string | null) {
  if (!value) {
    return '-'
  }

  return new Date(value).toLocaleString()
}

function getSecondsLeft() {
  if (!instanceState.value?.expires_at) {
    return Math.max(0, instanceState.value?.seconds_left || 0)
  }

  return Math.max(0, Math.floor((new Date(instanceState.value.expires_at).getTime() - now.value) / 1000))
}

function formatSecondsLeft(seconds: number) {
  if (seconds <= 0) {
    return '0 秒'
  }

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  const parts = []

  if (hours > 0) {
    parts.push(`${hours} 小时`)
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes} 分`)
  }
  parts.push(`${remainingSeconds} 秒`)

  return parts.join(' ')
}

function getLeasePercent() {
  if (!instanceState.value?.started_at || !instanceState.value?.expires_at) {
    return hasRunningInstance.value ? 100 : 0
  }

  const startedAt = new Date(instanceState.value.started_at).getTime()
  const expiresAt = new Date(instanceState.value.expires_at).getTime()
  const total = expiresAt - startedAt
  if (total <= 0) {
    return getSecondsLeft() > 0 ? 100 : 0
  }

  const remaining = Math.max(0, expiresAt - now.value)
  return Math.max(0, Math.min(100, Math.round((remaining / total) * 100)))
}

function getPolicyHint() {
  const policy = instanceState.value?.policy
  if (!policy) {
    return '当前还没有读取到实例租约策略。'
  }

  if (hasRunningInstance.value) {
    if (instanceState.value?.can_renew) {
      return `当前已经进入续期窗口；成功续期后会额外追加 ${policy.extension_duration_minutes} 分钟。每支队伍最多同时保留 ${policy.team_active_limit} 个运行中实例。`
    }

    return `当前实例采用 ${policy.lease_duration_minutes} 分钟初始租约；只有在到期前 ${policy.renewal_window_minutes} 分钟内才开放续期。每支队伍最多同时保留 ${policy.team_active_limit} 个运行中实例。`
  }

  return `首次申请会创建 ${policy.lease_duration_minutes} 分钟初始租约；后续每次成功续期会额外追加 ${policy.extension_duration_minutes} 分钟。`
}

function getPrimaryActionLabel() {
  if (hasRunningInstance.value) {
    return instanceState.value?.can_renew ? '续期实例' : '等待续期窗口'
  }

  return '启动实例'
}

async function copyValue(value?: string, successTitle = '内容已复制') {
  if (!value) {
    toast.add({
      title: '没有可复制的内容',
      color: 'warning',
    })
    return
  }

  try {
    await navigator.clipboard.writeText(value)
    toast.add({
      title: successTitle,
      description: value,
      color: 'success',
    })
  }
  catch (e: any) {
    toast.add({
      title: '复制失败',
      description: e.data?.message || e.message,
      color: 'error',
    })
  }
}

const destroyConfirmRows = computed(() => [
  {
    label: '当前状态',
    value: statusBadge.value.label,
  },
  {
    label: '实例入口',
    value: instanceState.value?.launch_url || currentEntry.value,
  },
  {
    label: '剩余时间',
    value: formatSecondsLeft(getSecondsLeft()),
  },
])

async function loadInstanceState(options?: { silent?: boolean }) {
  if (gameId.value <= 0 || challengeId.value <= 0) {
    stateLoadError.value = '当前实例地址缺少有效的比赛或题目编号。'
    instanceState.value = null
    return
  }

  if (!authState.user) {
    stateLoadError.value = '登录后才能查看当前队伍的实例详情。'
    instanceState.value = null
    return
  }

  if (options?.silent) {
    stateRefreshing.value = true
  } else {
    stateLoading.value = true
  }

  try {
    stateLoadError.value = ''
    instanceState.value = await $api('get', '/api/games/{id}/challenges/{challengeId}/instance', {
      params: {
        id: gameId.value,
        challengeId: challengeId.value,
      },
    })
  }
  catch (e: any) {
    instanceState.value = null
    stateLoadError.value = e.data?.message || e.message
  }
  finally {
    stateLoading.value = false
    stateRefreshing.value = false
  }
}

async function ensureInstance() {
  if (!authState.user) {
    await navigateTo(loginLink.value)
    return
  }

  stateEnsuring.value = true
  try {
    instanceState.value = await $api('post', '/api/games/{id}/challenges/{challengeId}/instance', {
      params: {
        id: gameId.value,
        challengeId: challengeId.value,
      },
    })
    stateLoadError.value = ''
    toast.add({
      title: '实例状态已更新',
      description: instanceState.value?.message || '当前队伍实例已启动或续期。',
      color: 'success',
    })
  }
  catch (e: any) {
    toast.add({
      title: '实例操作失败',
      description: e.data?.message || e.message,
      color: 'error',
    })
  }
  finally {
    stateEnsuring.value = false
  }
}

async function destroyInstance() {
  if (!authState.user) {
    await navigateTo(loginLink.value)
    return
  }

  stateDestroying.value = true
  try {
    instanceState.value = await $api('delete', '/api/games/{id}/challenges/{challengeId}/instance', {
      params: {
        id: gameId.value,
        challengeId: challengeId.value,
      },
    })
    stateLoadError.value = ''
    destroyConfirmModalOpen.value = false
    toast.add({
      title: '实例已销毁',
      description: instanceState.value?.message || '当前队伍实例已销毁。',
      color: 'success',
    })
  }
  catch (e: any) {
    toast.add({
      title: '销毁实例失败',
      description: e.data?.message || e.message,
      color: 'error',
    })
  }
  finally {
    stateDestroying.value = false
  }
}

function openDestroyConfirm() {
  if (!hasRunningInstance.value) {
    return
  }

  destroyConfirmModalOpen.value = true
}

let ticker: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  await ensureInitialized()
  await loadInstanceState()

  ticker = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onBeforeUnmount(() => {
  if (ticker) {
    clearInterval(ticker)
    ticker = null
  }
})
</script>

<template>
  <UContainer class="py-10">
    <div class="mx-auto flex max-w-5xl flex-col gap-6">
      <UPageCard
        title="实例详情"
        description="这里会展示当前账号在这道动态题下的实例租约、访问入口和续期策略，便于继续完成访问、续期和销毁操作。"
        icon="i-lucide-box"
      >
        <template #footer>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="link in pageLinks"
              :key="link.label"
              :to="link.to"
              :icon="link.icon"
              :variant="link.variant"
              size="sm"
            >
              {{ link.label }}
            </UButton>
          </div>
        </template>

        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <UPageCard
            v-for="card in summaryCards"
            :key="card.title"
            :title="card.title"
            :description="card.value"
            :icon="card.icon"
          />
        </div>

        <div class="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <UPageCard
            title="当前租约"
            icon="i-lucide-shield-check"
            :description="instanceState?.message || '当前会优先展示平台已经回填的实例状态。'"
          >
            <div class="space-y-4">
              <div class="rounded-lg border border-default bg-elevated/50 px-4 py-3">
                <div v-if="!authState.user" class="flex items-start justify-between gap-4 flex-wrap">
                  <div class="min-w-0">
                    <div class="font-medium text-highlighted">
                      需要先登录
                    </div>
                    <p class="mt-2 text-sm text-muted leading-6">
                      实例详情依赖当前账号所属队伍和报名状态。登录后才能读取当前队伍的真实实例信息。
                    </p>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <UButton :to="loginLink" size="sm" icon="i-lucide-log-in" variant="outline">
                      前往登录
                    </UButton>
                  </div>
                </div>

                <div v-else-if="stateLoadError" class="flex items-start justify-between gap-4">
                  <div class="min-w-0">
                    <div class="font-medium text-highlighted">
                      实例状态暂时不可用
                    </div>
                    <p class="mt-2 text-sm text-muted leading-6">
                      {{ stateLoadError }}
                    </p>
                  </div>
                  <UBadge color="error" variant="soft">
                    读取失败
                  </UBadge>
                </div>

                <div v-else class="flex items-start justify-between gap-4 flex-wrap">
                  <div class="min-w-0">
                    <div class="font-medium text-highlighted">
                      {{ hasRunningInstance ? '实例正在运行' : statusBadge.label === '待启动' ? '实例尚未启动' : '实例状态暂不可用' }}
                    </div>
                    <p class="mt-2 text-sm text-muted leading-6">
                      {{ instanceState?.message || '当前还没有读取到实例状态。' }}
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <UBadge :color="statusBadge.color" variant="soft" size="sm">
                      {{ statusBadge.label }}
                    </UBadge>
                    <span class="text-xs text-muted">
                      {{ stateLoading ? '正在读取状态...' : `剩余 ${formatSecondsLeft(getSecondsLeft())}` }}
                    </span>
                  </div>
                </div>
              </div>

              <div class="rounded-md border border-default px-3 py-3">
                <div class="mb-2 flex items-center justify-between gap-3 text-xs text-muted">
                  <span>租约剩余时间</span>
                  <span>{{ stateLoading ? '同步中' : formatSecondsLeft(getSecondsLeft()) }}</span>
                </div>
                <UProgress :model-value="getLeasePercent()" status />
              </div>

              <div class="grid gap-3 text-sm md:grid-cols-2">
                <div class="rounded-md border border-default px-3 py-3">
                  <div class="text-xs text-muted">Provider</div>
                  <div class="mt-1 text-highlighted">
                    {{ instanceState?.provider || '-' }}
                  </div>
                </div>
                <div class="rounded-md border border-default px-3 py-3">
                  <div class="text-xs text-muted">Image</div>
                  <div class="mt-1 break-all text-highlighted">
                    {{ instanceState?.image || '-' }}
                  </div>
                </div>
                <div class="rounded-md border border-default px-3 py-3">
                  <div class="text-xs text-muted">到期时间</div>
                  <div class="mt-1 text-highlighted">
                    {{ formatDateTime(instanceState?.expires_at) }}
                  </div>
                </div>
                <div class="rounded-md border border-default px-3 py-3">
                  <div class="text-xs text-muted">最近续期</div>
                  <div class="mt-1 text-highlighted">
                    {{ formatDateTime(instanceState?.last_renewed_at || instanceState?.started_at) }}
                  </div>
                </div>
              </div>

              <div class="flex flex-wrap gap-2">
                <UButton
                  size="sm"
                  icon="i-lucide-play"
                  :loading="stateEnsuring"
                  :disabled="!authState.user || stateLoading || stateRefreshing || stateDestroying || (hasRunningInstance && !instanceState?.can_renew)"
                  @click="ensureInstance"
                >
                  {{ getPrimaryActionLabel() }}
                </UButton>
                <UButton
                  v-if="hasRunningInstance"
                  size="sm"
                  color="error"
                  variant="outline"
                  icon="i-lucide-trash-2"
                  :loading="stateDestroying"
                  :disabled="stateEnsuring || stateLoading || stateRefreshing"
                  @click="openDestroyConfirm"
                >
                  销毁实例
                </UButton>
                <UButton
                  size="sm"
                  variant="ghost"
                  icon="i-lucide-refresh-cw"
                  :loading="stateRefreshing"
                  :disabled="stateEnsuring || stateDestroying"
                  @click="loadInstanceState({ silent: true })"
                >
                  刷新状态
                </UButton>
              </div>
            </div>
          </UPageCard>

          <div class="space-y-4">
            <UPageCard
              title="实例入口"
              icon="i-lucide-external-link"
              description="平台会优先展示当前队伍已经解析完成的真实入口。"
            >
              <div class="space-y-3 text-sm text-muted">
                <div class="rounded-md border border-default bg-default px-3 py-3 break-all">
                  {{ currentEntry }}
                </div>
                <div class="flex flex-wrap gap-2">
                  <UButton
                    size="sm"
                    variant="outline"
                    icon="i-lucide-copy"
                    @click="copyValue(currentEntry, '实例入口已复制')"
                  >
                    复制入口
                  </UButton>
                  <UButton
                    v-if="instanceState?.launch_url"
                    :to="instanceState.launch_url"
                    target="_blank"
                    size="sm"
                    variant="outline"
                    icon="i-lucide-external-link"
                  >
                    打开当前实例
                  </UButton>
                </div>
                <div v-if="instanceState?.host || instanceState?.port">
                  主机：{{ instanceState?.host || 'host' }}<template v-if="instanceState?.port">:{{ instanceState?.port }}</template>
                </div>
                <UButton
                  v-if="instanceState?.host || instanceState?.port"
                  size="sm"
                  variant="ghost"
                  icon="i-lucide-copy"
                  class="w-fit"
                  @click="copyValue(`${instanceState?.host || 'host'}${instanceState?.port ? `:${instanceState.port}` : ''}`, '主机地址已复制')"
                >
                  复制主机地址
                </UButton>
                <div
                  v-if="instanceState?.command"
                  class="rounded-md border border-default bg-default px-3 py-3 font-mono text-xs whitespace-pre-wrap"
                >
                  {{ instanceState?.command }}
                </div>
                <UButton
                  v-if="instanceState?.command"
                  size="sm"
                  variant="ghost"
                  icon="i-lucide-copy"
                  class="w-fit"
                  @click="copyValue(instanceState.command, '连接命令已复制')"
                >
                  复制连接命令
                </UButton>
              </div>
            </UPageCard>

            <UPageCard
              title="租约策略"
              icon="i-lucide-timer-reset"
              description="这里会展示当前实例的初始时长、续期窗口和队伍并发限制。"
            >
              <div class="space-y-3 text-sm text-muted">
                <p class="leading-6">
                  {{ getPolicyHint() }}
                </p>
                <div class="grid gap-3 sm:grid-cols-2">
                  <div class="rounded-md border border-default px-3 py-3">
                    <div class="text-xs">初始租约</div>
                    <div class="mt-1 text-highlighted">
                      {{ instanceState?.policy?.lease_duration_minutes || '-' }} 分钟
                    </div>
                  </div>
                  <div class="rounded-md border border-default px-3 py-3">
                    <div class="text-xs">续期追加</div>
                    <div class="mt-1 text-highlighted">
                      {{ instanceState?.policy?.extension_duration_minutes || '-' }} 分钟
                    </div>
                  </div>
                  <div class="rounded-md border border-default px-3 py-3">
                    <div class="text-xs">续期窗口</div>
                    <div class="mt-1 text-highlighted">
                      {{ instanceState?.policy?.renewal_window_minutes || '-' }} 分钟
                    </div>
                  </div>
                  <div class="rounded-md border border-default px-3 py-3">
                    <div class="text-xs">队伍实例上限</div>
                    <div class="mt-1 text-highlighted">
                      {{ instanceState?.policy?.team_active_limit || '-' }}
                    </div>
                  </div>
                </div>
              </div>
            </UPageCard>

            <UPageCard
              title="操作范围"
              icon="i-lucide-waypoints"
              description="当前页面用于承接实例详情，适合在不离开平台的前提下核对队伍入口与租约状态。"
            >
              <div class="text-sm text-muted leading-6">
                如果这里显示的是平台回填后的真实入口，说明当前账号已经拿到了队伍维度的实例地址；如果实例仍处于待启动状态，可先启动实例，再返回比赛页继续完成访问、续期或提交流程。
              </div>
            </UPageCard>
          </div>
        </div>
      </UPageCard>
    </div>

    <UModal
      v-model:open="destroyConfirmModalOpen"
      title="确认销毁当前实例"
      description="销毁后，当前队伍需要重新启动实例才能继续获得访问入口。"
      :dismissible="!stateDestroying"
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <div class="rounded-lg border border-default px-3 py-3 text-sm">
          <div
            v-for="row in destroyConfirmRows"
            :key="row.label"
            class="flex items-center justify-between gap-3 py-2"
          >
            <span class="text-muted">{{ row.label }}</span>
            <span class="max-w-[70%] break-all text-right">{{ row.value }}</span>
          </div>
        </div>
      </template>

      <template #footer>
        <UButton
          variant="outline"
          color="neutral"
          :disabled="stateDestroying"
          @click="destroyConfirmModalOpen = false"
        >
          取消
        </UButton>
        <UButton
          color="error"
          icon="i-lucide-trash-2"
          :loading="stateDestroying"
          @click="destroyInstance"
        >
          确认销毁
        </UButton>
      </template>
    </UModal>
  </UContainer>
</template>
