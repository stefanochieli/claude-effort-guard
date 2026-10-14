export type Metrics = {
  contextPercent: number | null
  lastTurnTokens: number | null
  consecutiveStruggles: number
  lastStruggleCommand: string | null
}

export type Turn = {
  struggled: boolean
  reason: 'bash_error' | 'test_failure_pattern' | 'repeated_error' | 'edit_error' | null
  command: string | null
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
