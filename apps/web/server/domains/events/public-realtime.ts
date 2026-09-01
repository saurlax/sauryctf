import type { PublicRealtimeEvent } from '../../../shared/contracts/public-realtime'

export { publicRealtimeEventSchema } from '../../../shared/contracts/public-realtime'
export type { PublicRealtimeEvent } from '../../../shared/contracts/public-realtime'

export type PublicRealtimeRecovery =
  | { status: 'recovered', events: PublicRealtimeEvent[] }
  | { status: 'reset' }

export interface PublicRealtimeLog {
  recover(contestId: string, lastEventId: string | null): Promise<PublicRealtimeRecovery>
  subscribe(
    contestId: string,
    listener: (event: PublicRealtimeEvent) => void | Promise<void>,
  ): Promise<() => Promise<void>>
}
