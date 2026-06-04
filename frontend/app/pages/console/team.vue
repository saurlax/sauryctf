<script setup lang="ts">
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

const createForm = reactive({ name: '' })
const joinForm = reactive({ invite_code: '' })
const createLoading = ref(false)
const joinLoading = ref(false)
const removingMemberId = ref<number | null>(null)

const currentUserId = computed(() => authState.user?.id)
const isCaptain = computed(() => team.value?.members?.some(member => member.user_id === currentUserId.value && member.role === 'captain') || false)
const teamMembers = computed(() => team.value?.members || [])
const removableMembers = computed(() => teamMembers.value.filter(member => member.user_id !== currentUserId.value))
const lockedGames = computed(() => team.value?.lock?.games || [])
const teamLocked = computed(() => !!team.value?.lock?.locked)
const memberCount = computed(() => teamMembers.value.length)
const joinInviteFromRoute = computed(() => {
  const invite = route.query.invite
  return typeof invite === 'string' ? invite.trim() : ''
})
const contestRedirect = computed(() => resolveRedirect())
const summaryCards = computed(() => [
  {
    label: '当前成员',
    value: memberCount.value ? `${memberCount.value} 人` : '0 人',
    hint: '创建者会自动成为队长，其他成员通过邀请码加入',
    icon: 'i-lucide-users',
    color: 'info' as const,
  },
  {
    label: '队伍状态',
    value: teamLocked.value ? '已锁定' : '可调整',
    hint: teamLocked.value ? '至少有一场未结束且已通过报名的比赛' : '当前可以继续邀请、退队或调整成员',
    icon: teamLocked.value ? 'i-lucide-lock' : 'i-lucide-unlock',
    color: teamLocked.value ? 'warning' as const : 'success' as const,
  },
  {
    label: '锁定比赛',
    value: String(lockedGames.value.length),
    hint: lockedGames.value.length ? '点下面的比赛卡片可以直接回到比赛详情页' : '当前没有比赛在锁定这支队伍',
    icon: 'i-lucide-trophy',
    color: lockedGames.value.length ? 'warning' as const : 'neutral' as const,
  },
])

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
    await navigateBackToContestIfNeeded()
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
      title: '邀请链接已复制',
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

onMounted(async () => {
  await ensureInitialized()
  if (joinInviteFromRoute.value) {
    joinForm.invite_code = joinInviteFromRoute.value
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
      <div class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div v-if="contestRedirect" class="xl:col-span-2">
          <UAlert
            color="info"
            variant="soft"
            icon="i-lucide-undo-2"
            title="当前来自比赛报名流程"
            description="你现在可以先维护队伍；完成后可直接返回原比赛继续报名或查看题目。"
          >
            <template #actions>
              <UButton
                label="返回原比赛"
                color="info"
                variant="outline"
                size="sm"
                :to="contestRedirect"
              />
            </template>
          </UAlert>
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
          <UAlert
            v-if="teamLocked"
            color="warning"
            variant="soft"
            icon="i-lucide-lock"
            title="当前队伍已被比赛锁定"
            :description="isCaptain ? '你们已经通过至少一场仍未结束的比赛报名，当前不能加人、退队或移除成员。' : '你的队伍已经通过至少一场仍未结束的比赛报名，当前不能更改队伍成员。'"
          />

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
                label="复制邀请链接"
                icon="i-lucide-link"
                variant="ghost"
                size="xs"
                :disabled="teamLocked"
                @click="copyInviteLink()"
              />
            </div>
            <p v-if="teamLocked" class="mt-2 text-xs text-muted">
              当前比赛锁定期间，不建议继续分发邀请码；待所有锁定中的比赛结束后，队伍会自动恢复可调整状态。
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
                    color="error"
                    variant="ghost"
                    size="xs"
                    :disabled="teamLocked"
                    icon="i-lucide-user-round-minus"
                    :loading="removingMemberId === member.user_id"
                    @click="removeMember(member.user_id, member.username || member.user?.username)"
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
              @click="leaveTeam"
            />
          </div>
        </template>
        </UPageCard>

        <div class="space-y-6">
          <UPageCard title="队伍提示" icon="i-lucide-info">
            <div class="space-y-3 text-sm text-muted">
              <p>
                当前邀请码可直接分享给队友，复制邀请链接后，队友打开页面会自动填入邀请码。
              </p>
              <p v-if="teamLocked">
                当前队伍已经通过一场仍未结束的比赛报名，队伍结构会被临时锁定，直到这些比赛结束。
              </p>
              <p v-if="isCaptain">
                你当前是队长，可以移除其他成员。当前版本下，队长不能直接退出队伍。
              </p>
              <p v-else>
                如果你需要离队，可以直接使用下方退出按钮，之后可重新加入其他队伍。
              </p>
            </div>
          </UPageCard>

          <UPageCard v-if="isCaptain" title="队长操作" icon="i-lucide-shield-check">
            <div class="space-y-3 text-sm">
              <div class="flex items-center justify-between gap-3">
                <span class="text-muted">可移除成员</span>
                <span>{{ removableMembers.length }}</span>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-muted">是否可直接退队</span>
                <span>{{ teamLocked ? '否，比赛锁定中' : '否' }}</span>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-muted">当前锁定比赛</span>
                <span>{{ lockedGames.length }}</span>
              </div>
              <p class="text-muted">
                {{ teamLocked ? '锁定期间请保持当前队伍结构，待相关比赛结束后再继续调整。' : '如果需要调整队伍，请先移除成员或保留当前队伍结构，再继续报名比赛。' }}
              </p>
            </div>
          </UPageCard>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1.25fr)_320px]">
        <div v-if="contestRedirect" class="xl:col-span-3">
          <UAlert
            color="info"
            variant="soft"
            icon="i-lucide-route"
            title="完成队伍准备后会自动回到原比赛"
            description="当前页面是从比赛详情跳转过来的。创建或加入队伍成功后，系统会直接带你返回刚才的比赛。"
          >
            <template #actions>
              <UButton
                label="先看原比赛"
                color="info"
                variant="outline"
                size="sm"
                :to="contestRedirect"
              />
            </template>
          </UAlert>
        </div>
        <UPageCard title="创建队伍">
          <UForm :state="createForm" class="space-y-4" @submit="createTeam">
            <UFormField label="队伍名称" name="name">
              <UInput v-model="createForm.name" placeholder="输入队伍名称" size="lg" class="w-full" />
            </UFormField>
            <UButton type="submit" label="创建" :loading="createLoading" block />
          </UForm>
          <template #footer>
            <p class="text-sm text-muted">
              创建者会自动成为队长，并获得邀请其他队员的权限。
            </p>
          </template>
        </UPageCard>

        <UPageCard title="加入队伍">
          <UAlert
            v-if="joinInviteFromRoute"
            class="mb-4"
            color="info"
            variant="soft"
            title="已识别邀请链接"
            description="页面已经自动填入邀请码，确认后即可直接加入队伍。"
          />
          <UForm :state="joinForm" class="space-y-4" @submit="joinTeam">
            <UFormField label="邀请码" name="invite_code">
              <UInput v-model="joinForm.invite_code" placeholder="输入队伍邀请码" size="lg" class="w-full" />
            </UFormField>
            <UButton type="submit" label="加入" :loading="joinLoading" block />
          </UForm>
          <template #footer>
            <p class="text-sm text-muted">
              通过队长分享的邀请码即可快速加入，加入后就能前往比赛页面完成报名。
            </p>
          </template>
        </UPageCard>

        <UPageCard title="下一步" icon="i-lucide-list-check">
          <div class="space-y-3 text-sm text-muted">
            <p>
              还没有固定队伍时，最稳妥的流程是先组队，再去比赛页完成报名和提交。
            </p>
            <p>
              如果你是队长，创建成功后会立刻拿到邀请码和邀请链接；如果你是队员，直接粘贴邀请码即可加入。
            </p>
            <p v-if="contestRedirect">
              当前来自某个比赛详情页，创建或加入成功后会自动回到原比赛继续操作。
            </p>
          </div>

          <template #footer>
            <div class="flex flex-wrap items-center gap-2">
              <UButton label="浏览比赛" variant="ghost" icon="i-lucide-trophy" to="/games" />
              <UButton label="回到控制台" variant="outline" icon="i-lucide-layout-dashboard" to="/console" />
            </div>
          </template>
        </UPageCard>
      </div>
    </template>
  </div>
</template>
