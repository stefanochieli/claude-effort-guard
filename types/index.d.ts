export type Metrics = {
  contextPercent: number | null
  lastTurnTokens: number | null
  consecutiveStruggles: number
}

export type Turn = {
  struggled: boolean
  reason: 'bash_error' | 'test_failure_pattern' | null
}

export type LogEntry = {
  ts: string
  contextPercent: number | null
  lastTurnTokens: number | null
  struggled: boolean
  reason: Turn['reason']
  consecutiveStruggles: number
}

declare module 'claude-code' {
  interface PluginState {
    'effort-guard': { metrics: Metrics; turn: Turn }
  }
}
