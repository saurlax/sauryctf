<script setup lang="ts">
interface TurnstileApi {
  render(element: HTMLElement, options: Record<string, unknown>): string
  remove(widgetId: string): void
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

const props = defineProps<{ siteKey: string, action: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const target = ref<HTMLElement | null>(null)
let widgetId: string | null = null

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-sauryctf-turnstile]')
    const script = existing ?? document.createElement('script')
    const finish = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile unavailable'))
    script.addEventListener('load', finish, { once: true })
    script.addEventListener('error', () => reject(new Error('Turnstile failed to load')), { once: true })
    if (!existing) {
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      script.dataset.sauryctfTurnstile = 'true'
      document.head.append(script)
    }
  })
}

onMounted(async () => {
  if (!target.value) return
  const turnstile = await loadTurnstile()
  widgetId = turnstile.render(target.value, {
    sitekey: props.siteKey,
    action: props.action,
    callback: (token: string) => emit('update:modelValue', token),
    'expired-callback': () => emit('update:modelValue', ''),
    'error-callback': () => emit('update:modelValue', ''),
  })
})

onBeforeUnmount(() => {
  if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
})
</script>

<template><div ref="target" /></template>
