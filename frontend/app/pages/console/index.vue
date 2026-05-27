<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
})

const { authState, fetchUser } = useAuth()
const router = useRouter()

const stats = computed(() => [
  { label: '我的队伍', value: authState.user ? '已加入' : '未加入', icon: 'i-lucide-users' },
  { label: '参加比赛', value: '0', icon: 'i-lucide-trophy' },
  { label: '解题数量', value: '0', icon: 'i-lucide-flag' },
  { label: '总得分', value: '0', icon: 'i-lucide-star' },
])
</script>

<template>
  <div class="py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-bold">
        控制台
      </h1>
      <p class="text-muted mt-1">
        欢迎回来，{{ authState.user?.username || '选手' }}
      </p>
    </div>

    <UPageGrid :cols="{ default: 1, sm: 2, lg: 4 }">
      <UPageCard
        v-for="stat in stats"
        :key="stat.label"
        :title="stat.value"
        :description="stat.label"
        :icon="stat.icon"
      />
    </UPageGrid>

    <div class="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
      <UPageCard title="快捷操作">
        <div class="flex flex-col gap-3">
          <UButton label="我的队伍" icon="i-lucide-users" to="/console/team" variant="outline" block />
          <UButton label="浏览比赛" icon="i-lucide-trophy" to="/games" variant="outline" block />
        </div>
      </UPageCard>

      <UPageCard title="最新公告">
        <p class="text-muted text-sm">
          暂无公告
        </p>
      </UPageCard>
    </div>
  </div>
</template>
