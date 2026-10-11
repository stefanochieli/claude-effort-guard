import { atom, read, update } from 'claude-code'
import { looksLikeTestFailure } from './detect.mjs'

const DEFAULT_THRESHOLD = 3
const DEFAULT_CONTEXT_THRESHOLD = 80
const LOG_LIMIT = 500
const LOG_KEY = 'log'

const metrics = atom(
  { plugin: 'effort-guard', key: 'metrics' },
  { contextPercent: null, lastTurnTokens: null, consecutiveStruggles: 0, lastStruggleCommand: null },
)
const turn = atom({ plugin: 'effort-guard', key: 'turn' }, { struggled: false, reason: null, command: null })

// Marks the current turn as struggling. The same command failing twice in a
// turn is a loop, which is worth telling apart from two different failures.
async function markStruggle($, reason, command) {
  const current = await read($, turn)
  const repeated = current.struggled && !!command && current.command === command

  await update($, turn, () => ({ struggled: true, reason: repeated ? 'repeated_error' : reason, command: command ?? current.command }))
}

export function register(on, options) {
  const threshold = Math.max(1, Math.floor(Number(options?.threshold)) || DEFAULT_THRESHOLD)
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

    if (ran.isError) {
      await markStruggle($, 'bash_error', e.command)
    } else if (looksLikeTestFailure(e.command, ran.text)) {
      await markStruggle($, 'test_failure_pattern', e.command)
    }

    return ran
  })

  // A failed edit (e.g. old_string not found) means the model is working from
  // a stale picture of the file.
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)

    if (!e.agentId && ran.isError) {
      await markStruggle($, 'edit_error', null)
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      // Subagent turn: don't count it toward the user-visible streak.
      return next(e)
    }

    const usage = e.usage
    const lastTurnTokens = usage
      ? usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
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
      lastTurnTokens,
      consecutiveStruggles,
      lastStruggleCommand: struggled ? (command ?? prev.lastStruggleCommand) : null,
    }))
    await update($, turn, () => ({ struggled: false, reason: null, command: null }))

    const entry = {
      ts: new Date().toISOString(),
      contextPercent,
      lastTurnTokens,
      struggled,
      reason,
      consecutiveStruggles,
    }

    // The log outlives the session. A store failure must not cost the toast.
    try {
      const stored = await $.store.get(LOG_KEY)
      const list = Array.isArray(stored) ? stored : []
      await $.store.set(LOG_KEY, [...list, entry].slice(-LOG_LIMIT))
    } catch {}

    // Once per streak: fires when the streak reaches the threshold, and again
    // only after a clean turn has reset it. Derived from $.state, so a hot
    // reload cannot make it fire twice.
    if (consecutiveStruggles === threshold) {
      $.ui.toast(
        `effort-guard: ${consecutiveStruggles} struggling turns in a row (failed commands/tests)` +
          `${command ? `, last: ${command.slice(0, 60)}` : ''}. ` +
          `Consider switching to a stronger model or raising effort one level.`,
      )
    }

    // Fires once, when the context first crosses the limit.
    if (
      contextThreshold > 0 &&
      contextPercent !== null &&
      contextPercent >= contextThreshold &&
      (prev.contextPercent ?? 0) < contextThreshold
    ) {
      $.ui.toast(`effort-guard: context at ${contextPercent}%. Consider /compact or starting a fresh session.`)
    }

    return next(e)
  })

  on('command.run', { command: 'effort-log' }, async $ => {
    let list = []
    try {
      const stored = await $.store.get(LOG_KEY)
      list = Array.isArray(stored) ? stored : []
    } catch {}

    if (list.length === 0) {
      return { text: 'effort-guard: no turns logged yet.' }
    }

    const lines = list.slice(-50).map(e => {
      const flag = e.struggled ? `STRUGGLE(${e.reason})` : 'ok'

      return `${e.ts}  ctx=${e.contextPercent ?? '?'}%  tok=${e.lastTurnTokens ?? '?'}  streak=${e.consecutiveStruggles}  ${flag}`
    })

    return { text: lines.join('\n') }
  })

  on('command.run', { command: 'effort-summary' }, async $ => {
    let list = []
    try {
      const stored = await $.store.get(LOG_KEY)
      list = Array.isArray(stored) ? stored : []
    } catch {}

    if (list.length === 0) {
      return { text: 'effort-guard: no turns logged yet.' }
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const m = await read($, metrics)

    if (m.contextPercent === null && m.lastTurnTokens === null && m.consecutiveStruggles === 0) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const struggleText = m.consecutiveStruggles > 0 ? ` | struggling x${m.consecutiveStruggles}/${threshold}` : ''

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
