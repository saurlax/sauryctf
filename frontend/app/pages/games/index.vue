<script setup lang="ts">
const games = ref([])
</script>

<template>
  <div class="py-8">
    <h1 class="text-3xl font-bold mb-2">
      比赛列表
    </h1>
    <p class="text-muted mb-8">
      浏览所有进行中和即将开始的比赛
    </p>

    <div v-if="games.length === 0" class="text-center py-16">
      <UIcon name="i-lucide-trophy" class="size-12 text-muted mx-auto mb-4" />
      <p class="text-muted">
        暂无比赛
      </p>
    </div>
  </div>
</template>
