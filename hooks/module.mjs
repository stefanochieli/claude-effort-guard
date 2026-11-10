import { atom, read, update } from 'claude-code'
import { looksLikeTestFailure, redactCommand } from './detect.mjs'

const DEFAULT_THRESHOLD = 3
const MAX_THRESHOLD = 20
const DEFAULT_CONTEXT_THRESHOLD = 80
// Every session writes its own store key (`log:<id>`): two sessions finishing a
// turn at the same time cannot overwrite each other's entries. Old sessions'
// logs are kept (the README promises the log survives sessions), up to
// MAX_SESSION_LOGS of them, 500 entries each.
const LOG_LIMIT = 500
const LOG_PREFIX = 'log:'
const LEGACY_LOG_KEY = 'log'
const MAX_SESSION_LOGS = 20
const SHOWN_TURNS = 50
const STORED_COMMAND_CHARS = 120
const TOAST_COMMAND_CHARS = 60

const metrics = atom(
  { plugin: 'effort-guard', key: 'metrics' },
  { contextPercent: null, lastKnownContextPercent: null, lastTurnTokens: null, consecutiveStruggles: 0, lastStruggleCommand: null },
)
const turn = atom({ plugin: 'effort-guard', key: 'turn' }, { struggled: false, reason: null, command: null })

// Marks the current turn as struggling. The same command failing twice in a
// turn is a loop, which is worth telling apart from two different failures.
// The decision is made inside the update callback, on the value it is given, so
// two failures reported at the same time cannot overwrite each other. Once a
// turn is a loop it stays one: a later, different failure does not downgrade it.
async function markStruggle($, reason, command) {
  await update($, turn, current => {
    const repeated = current.struggled && !!command && current.command === command
    const stays = current.struggled && current.reason === 'repeated_error'

    return {
      struggled: true,
      reason: repeated || stays ? 'repeated_error' : reason,
      command: command ?? current.command,
    }
  })
}

// Reads the log of every session (and the single-key log of older versions).
// `failed` tells "could not read" apart from "empty".
async function readLogs($, ownKey) {
  let keys = [ownKey]
  try {
    const all = await $.store.keys()
    if (Array.isArray(all)) {
      keys = [...new Set([...all.filter(k => k === LEGACY_LOG_KEY || k.startsWith(LOG_PREFIX)), ownKey])]
    }
  } catch {}

  const list = []
  let failed = false
  for (const key of keys) {
    try {
      const stored = await $.store.get(key)
      if (Array.isArray(stored)) {
        list.push(...stored)
      }
    } catch {
      failed = true
    }
  }
  list.sort((a, b) => String(a.ts).localeCompare(String(b.ts)))

  return { list, failed }
}

// Drops the oldest session logs beyond MAX_SESSION_LOGS.
async function pruneLogs($) {
  const keys = (await $.store.keys()).filter(k => k.startsWith(LOG_PREFIX))
  if (keys.length <= MAX_SESSION_LOGS) {
    return
  }

  const dated = []
  for (const key of keys) {
    const stored = await $.store.get(key)
    dated.push({ key, last: Array.isArray(stored) && stored.length > 0 ? String(stored[stored.length - 1].ts) : '' })
  }
  dated.sort((a, b) => a.last.localeCompare(b.last))
  for (const { key } of dated.slice(0, dated.length - MAX_SESSION_LOGS)) {
    await $.store.delete(key)
  }
}

function logUnavailable(failed) {
  return failed ? 'effort-guard: the log could not be read from the plugin store.' : 'effort-guard: no turns logged yet.'
}

export function register(on, options) {
  const sessionId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`).slice(0, 8)
  const ownKey = `${LOG_PREFIX}${sessionId}`
  // Same range as the manifest (1-20); anything that is not a number is the default.
  const rawThreshold = Math.floor(Number(options?.threshold))
  const threshold = Number.isFinite(rawThreshold) ? Math.min(MAX_THRESHOLD, Math.max(1, rawThreshold)) : DEFAULT_THRESHOLD
  // 0 switches the context warning off.
  const rawContext = Number(options?.contextThreshold)
  const contextThreshold = Number.isFinite(rawContext) && options?.contextThreshold !== undefined
    ? Math.min(100, Math.max(0, Math.floor(rawContext)))
    : DEFAULT_CONTEXT_THRESHOLD

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'effort-log',
      description: 'Print the effort-guard per-turn context/struggle log',
    })
    await $.command.register({
      name: 'effort-summary',
      description: 'Print a one-line effort-guard summary of the logged turns',
    })
    await $.command.register({
      name: 'effort-reset',
      description: 'Delete the effort-guard turn log and reset the struggle streak',
    })

    try {
      await pruneLogs($)
    } catch {}

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, turn, () => ({ struggled: false, reason: null, command: null }))

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)

    // A subagent's commands are not the user-visible turn's struggle.
    if (e.agentId) {
      return ran
    }

    // Commands can carry secrets: only a redacted, shortened copy is kept.
    const safeCommand = redactCommand(e.command, STORED_COMMAND_CHARS)

    if (ran.isError) {
      await markStruggle($, 'bash_error', safeCommand)
    } else if (looksLikeTestFailure(e.command, ran.text)) {
      await markStruggle($, 'test_failure_pattern', safeCommand)
    }

    return ran
  })

  // A failed edit (e.g. old_string not found) means the model is working from
  // a stale picture of the file.
  for (const tool of ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']) {
    on('tool.call', { tool }, async ($, e, next) => {
      const ran = await next(e)

      if (!e.agentId && ran.isError) {
        await markStruggle($, 'edit_error', null)
      }

      return ran
    })
  }

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      // Subagent turn: don't count it toward the user-visible streak.
      return next(e)
    }

    const usage = e.usage
    const lastTurnTokens = usage
      ? (usage.input_tokens ?? 0) +
        (usage.output_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0)
      : null

    // Struggle tracking and the toast must not depend on context-usage
    // reporting succeeding, so a failure here degrades to an unknown percent
    // instead of skipping the rest of the hook.
    let contextPercent = null
    try {
      const sessionUsage = await $.session.usage()
      contextPercent = sessionUsage.context.percent ?? null
    } catch {}

    const { struggled, reason, command } = await read($, turn)
    const prev = await read($, metrics)
    const consecutiveStruggles = struggled ? prev.consecutiveStruggles + 1 : 0

    await update($, metrics, () => ({
      contextPercent,
      // A failed reading must not re-arm the context toast.
      lastKnownContextPercent: contextPercent ?? prev.lastKnownContextPercent ?? null,
      lastTurnTokens,
      consecutiveStruggles,
      lastStruggleCommand: struggled ? (command ?? prev.lastStruggleCommand) : null,
    }))
    await update($, turn, () => ({ struggled: false, reason: null, command: null }))

    const entry = {
      ts: new Date().toISOString(),
      session: sessionId,
      contextPercent,
      lastTurnTokens,
      struggled,
      reason,
      consecutiveStruggles,
    }

    // The log outlives the session. A store failure must not cost the toast.
    try {
      const stored = await $.store.get(ownKey)
      const list = Array.isArray(stored) ? stored : []
      await $.store.set(ownKey, [...list, entry].slice(-LOG_LIMIT))
    } catch {}

    // Once per streak: fires when the streak reaches the threshold, and again
    // only after a clean turn has reset it. Derived from $.state, so a hot
    // reload cannot make it fire twice.
    if (consecutiveStruggles === threshold) {
      $.ui.toast(
        `effort-guard: ${consecutiveStruggles} struggling turns in a row (failed commands/tests` +
          `${reason ? `, last cause: ${reason}` : ''})` +
          `${command ? `, last: ${command.slice(0, TOAST_COMMAND_CHARS)}` : ''}. ` +
          `Consider switching to a stronger model or raising effort one level.`,
      )
    }

    // Fires once, when the context first crosses the limit.
    if (
      contextThreshold > 0 &&
      contextPercent !== null &&
      contextPercent >= contextThreshold &&
      (prev.lastKnownContextPercent ?? 0) < contextThreshold
    ) {
      $.ui.toast(`effort-guard: context at ${contextPercent}%. Consider /compact or starting a fresh session.`)
    }

    return next(e)
  })

  on('command.run', { command: 'effort-log' }, async $ => {
    const { list, failed } = await readLogs($, ownKey)

    if (list.length === 0) {
      return { text: logUnavailable(failed) }
    }

    const lines = list.slice(-SHOWN_TURNS).map(e => {
      const flag = e.struggled ? `STRUGGLE(${e.reason})` : 'ok'

      return `${e.ts}  s=${e.session ?? '-'}  ctx=${e.contextPercent ?? '?'}%  tok=${e.lastTurnTokens ?? '?'}  streak=${e.consecutiveStruggles}  ${flag}`
    })

    if (failed) {
      lines.push('(part of the log could not be read)')
    }

    return { text: lines.join('\n') }
  })

  on('command.run', { command: 'effort-summary' }, async $ => {
    const { list, failed } = await readLogs($, ownKey)

    if (list.length === 0) {
      return { text: logUnavailable(failed) }
    }

    const struggled = list.filter(e => e.struggled)
    const reasons = {}
    for (const e of struggled) {
      reasons[e.reason] = (reasons[e.reason] ?? 0) + 1
    }
    const top = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0]
    const peak = Math.max(0, ...list.map(e => e.contextPercent ?? 0))

    return {
      text:
        `effort-guard: ${list.length} turns, ${struggled.length} struggling` +
        `${top ? ` (most common: ${top[0]})` : ''}, peak context ${peak}%.`,
    }
  })

  on('command.run', { command: 'effort-reset' }, async $ => {
    let removed = 0
    try {
      const keys = await $.store.keys()
      for (const key of Array.isArray(keys) ? keys : []) {
        if (key === LEGACY_LOG_KEY || key.startsWith(LOG_PREFIX)) {
          await $.store.delete(key)
          removed += 1
        }
      }
    } catch {
      return { text: 'effort-guard: the log could not be cleared from the plugin store.' }
    }

    await update($, metrics, () => ({
      contextPercent: null,
      lastKnownContextPercent: null,
      lastTurnTokens: null,
      consecutiveStruggles: 0,
      lastStruggleCommand: null,
    }))
    await update($, turn, () => ({ struggled: false, reason: null, command: null }))

    return { text: `effort-guard: log cleared (${removed} stored log${removed === 1 ? '' : 's'}), streak reset.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const m = await read($, metrics)

    if (m.contextPercent === null && m.lastTurnTokens === null && m.consecutiveStruggles === 0) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const struggleText = m.consecutiveStruggles > 0 ? ` | struggling x${m.consecutiveStruggles}/${threshold}` : ''

    // `h` is provided by the mod runtime (the types contract may not declare globals).
    return h(
      Box,
      null,
      h(
        Text,
        { dimColor: true },
        `ctx ${m.contextPercent ?? '?'}% | last turn ${m.lastTurnTokens ?? '?'} tok${struggleText}`,
      ),
    )
  })
}
