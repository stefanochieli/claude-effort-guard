export type Metrics = {
  contextPercent: number | null
  /** Last context percentage that could be read; keeps the context toast armed state across a failed reading. */
  lastKnownContextPercent: number | null
  /** input + output + cache read + cache creation tokens of the last turn: dominated by the context re-read from cache. */
  lastTurnTokens: number | null
  consecutiveStruggles: number
  /** Redacted (no tokens, passwords or URL credentials) and shortened copy of the command. */
  lastStruggleCommand: string | null
}

export type Turn = {
  struggled: boolean
  reason: 'bash_error' | 'test_failure_pattern' | 'repeated_error' | 'edit_error' | null
  command: string | null
}

export type LogEntry = {
  ts: string
  /** First 8 characters of the id the plugin generated for the session that wrote the entry. */
  session?: string
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
