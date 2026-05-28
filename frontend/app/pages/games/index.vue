<script setup lang="ts">
import type { components } from '~/types/api'

type Game = components['schemas']['Game']

const toast = useToast()
const games = ref<Game[]>([])
const loading = ref(true)

async function fetchGames() {
  loading.value = true
  try {
    const res = await $api('get', '/api/games')
    games.value = res || []
  }
  catch (e: any) {
    toast.add({ title: '获取比赛列表失败', description: e.data?.message || e.message, color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case 'active': return 'success'
    case 'draft': return 'neutral'
    case 'ended': return 'error'
    default: return 'neutral'
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'active': return '进行中'
    case 'draft': return '未开始'
    case 'ended': return '已结束'
    default: return status
  }
}

onMounted(fetchGames)
</script>

<template>
  <UContainer class="py-8">
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-3xl font-bold mb-2">
          比赛列表
        </h1>
        <p class="text-muted">
          浏览所有进行中和即将开始的比赛
        </p>
      </div>
    </div>

    <div v-if="loading" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader" class="size-8 animate-spin text-muted" />
    </div>

    <div v-else-if="games.length === 0" class="text-center py-16">
      <UIcon name="i-lucide-trophy" class="size-12 text-muted mx-auto mb-4" />
      <p class="text-muted">
        暂无比赛
      </p>
    </div>

    <div v-else class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <UPageCard
        v-for="game in games"
        :key="game.id"
        :to="`/games/${game.id}`"
      >
        <template #header>
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold">
              {{ game.name }}
            </h3>
            <UBadge :color="getStatusColor(game.status)" size="sm">
              {{ getStatusLabel(game.status) }}
            </UBadge>
          </div>
        </template>
        <p class="text-sm text-muted line-clamp-2">
          {{ game.description || '暂无描述' }}
        </p>
        <template #footer>
          <div class="text-xs text-muted space-y-1">
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-clock" class="size-3" />
              <span>{{ new Date(game.start_time).toLocaleString() }}</span>
            </div>
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-flag" class="size-3" />
              <span>{{ new Date(game.end_time).toLocaleString() }}</span>
            </div>
          </div>
        </template>
      </UPageCard>
    </div>
  </UContainer>
</template>
