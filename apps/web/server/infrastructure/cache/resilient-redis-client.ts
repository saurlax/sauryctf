import { createClient } from 'redis'

const redisConnectTimeoutMs = 250

export function createResilientRedisClient(redisUrl?: string) {
  if (!redisUrl) return null
  return createClient({
    url: redisUrl,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: redisConnectTimeoutMs,
      reconnectStrategy: false,
    },
  })
}
