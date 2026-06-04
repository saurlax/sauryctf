import type { components } from '~/types/api'

type GameParticipation = components['schemas']['GameParticipation']

const emptyParticipationState: GameParticipation = {
  has_team: false,
  participated: false,
}

export function useGameParticipationMap() {
  const { authState } = useAuth()

  async function fetchParticipationMap(gameIds: number[]) {
    if (!authState.user || gameIds.length === 0) {
      return {}
    }

    const entries = await Promise.all(
      gameIds.map(async (gameId) => {
        try {
          const participation = await $api('get', '/api/games/{id}/participation', {
            params: { id: gameId },
          })
          return [gameId, participation] as const
        }
        catch {
          return [gameId, emptyParticipationState] as const
        }
      }),
    )

    return Object.fromEntries(entries)
  }

  return {
    emptyParticipationState,
    fetchParticipationMap,
  }
}
