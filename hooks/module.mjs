import { atom, read, update } from 'claude-code'
import { looksLikeTestFailure } from './detect.mjs'

const DEFAULT_THRESHOLD = 3
const LOG_LIMIT = 500
const LOG_KEY = 'log'

const metrics = atom(
  { plugin: 'effort-guard', key: 'metrics' },
  { contextPercent: null, lastTurnTokens: null, consecutiveStruggles: 0 },
)
const turn = atom({ plugin: 'effort-guard', key: 'turn' }, { struggled: false, reason: null })

export function register(on, options) {
  const threshold = Math.max(1, Math.floor(Number(options?.threshold)) || DEFAULT_THRESHOLD)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'effort-log',
      description: 'Print the effort-guard per-turn context/struggle log',
    })

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, turn, () => ({ struggled: false, reason: null }))

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)

    // A subagent's commands are not the user-visible turn's struggle.
    if (e.agentId) {
      return ran
    }

    if (ran.isError) {
      await update($, turn, () => ({ struggled: true, reason: 'bash_error' }))
    } else if (looksLikeTestFailure(e.command, ran.text)) {
      await update($, turn, () => ({ struggled: true, reason: 'test_failure_pattern' }))
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

    const { struggled, reason } = await read($, turn)
    const prev = await read($, metrics)
    const consecutiveStruggles = struggled ? prev.consecutiveStruggles + 1 : 0

    await update($, metrics, () => ({ contextPercent, lastTurnTokens, consecutiveStruggles }))
    await update($, turn, () => ({ struggled: false, reason: null }))

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
        `effort-guard: ${consecutiveStruggles} struggling turns in a row (failed commands/tests). ` +
          `Consider switching to a stronger model or raising effort one level.`,
      )
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
