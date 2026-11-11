export type Reason =
  | 'bash_error'
  | 'test_failure_pattern'
  | 'repeated_error'
  | 'persistent_failure'
  | 'read_loop'
  | 'edit_error'

export type Metrics = {
  contextPercent: number | null
  /** Last context percentage that could be read; keeps the context toast armed state across a failed reading. */
  lastKnownContextPercent: number | null
  /** input + output + cache read + cache creation tokens of the last turn: dominated by the context re-read from cache. */
  lastTurnTokens: number | null
  consecutiveStruggles: number
  /** Redacted (no tokens, passwords or URL credentials) and shortened copy of the command. */
  lastStruggleCommand: string | null
  lastStruggleReason?: Reason | null
  /** Session cost so far in USD, as /cost totals it; null where the host keeps no cost ledger. */
  costUsd?: number | null
  /** Highest percentUsed among the rate-limit windows of the last API response. */
  rateLimitPercent?: number | null
  lastKnownRateLimitPercent?: number | null
  /** A narrower command that reruns only the failing tests, redacted. */
  rerunHint?: string | null
  /** Paths of the last files edited successfully, newest first. */
  touchedFiles?: string[]
}

export type Turn = {
  struggled: boolean
  reason: Reason | null
  command: string | null
  /** Reads per file path in this turn, reset by a successful edit of the file. */
  reads?: Record<string, number>
  rerun?: string | null
}

export type LogEntry = {
  ts: string
  /** First 8 characters of the id the plugin generated for the session that wrote the entry. */
  session?: string
  /** Repository name, or the working directory's name; absent in entries of older versions. */
  project?: string | null
  contextPercent: number | null
  lastTurnTokens: number | null
  costUsd?: number | null
  struggled: boolean
  reason: Reason | null
  consecutiveStruggles: number
}

declare module 'claude-code' {
  interface PluginState {
    'effort-guard': { metrics: Metrics; turn: Turn; recent: LogEntry[] }
  }
}
