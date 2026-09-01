<script setup lang="ts">
const route = useRoute()
const redirectedTo = computed(() => ({
  path: `/local-instance/${route.params.gameId}/${route.params.challengeId}/${route.params.teamHash}`,
  query: route.query,
}))

await navigateTo(redirectedTo.value, { replace: true })
</script>

<template>
  <div />
</template>
