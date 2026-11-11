import { atom, read, update } from 'claude-code'
import { looksLikeTestFailure, redactCommand } from './detect.mjs'
import { suggestRerun } from './rerun.mjs'
import { buildCompactHint, buildSelfCorrect, withCompactHint } from './hints.mjs'

const DEFAULT_THRESHOLD = 3
const MAX_THRESHOLD = 20
const DEFAULT_CONTEXT_THRESHOLD = 80
const DEFAULT_RATE_LIMIT_THRESHOLD = 80
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
const RERUN_CHARS = 300
// Reading the same file this many times in one turn, with no successful edit
// of it in between, is the model looking for something it does not find.
const READ_LOOP = 3
const RECENT_TURNS = 30
const TOUCHED_FILES = 10
const PANE = 'effort-guard'
const SELF_CORRECT_SECTION = 'effort-guard:self-correct'
const EDIT_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']

let sessionCounter = 0

const metrics = atom(
  { plugin: 'effort-guard', key: 'metrics' },
  {
    contextPercent: null,
    lastKnownContextPercent: null,
    lastTurnTokens: null,
    consecutiveStruggles: 0,
    lastStruggleCommand: null,
    lastStruggleReason: null,
    costUsd: null,
    rateLimitPercent: null,
    lastKnownRateLimitPercent: null,
    rerunHint: null,
    touchedFiles: [],
  },
)
const turn = atom(
  { plugin: 'effort-guard', key: 'turn' },
  { struggled: false, reason: null, command: null, reads: {}, rerun: null },
)
// The last turns, for the pane: kept in state so the pane redraws on a write.
const recent = atom({ plugin: 'effort-guard', key: 'recent' }, [])

const CLEAN_TURN = { struggled: false, reason: null, command: null, reads: {}, rerun: null }

// Reasons that say more than a plain failure, strongest first: a weaker one
// never replaces a stronger one within a turn.
const RANK = { repeated_error: 4, persistent_failure: 3, read_loop: 2 }

// Marks the current turn as struggling. The same command failing twice in a
// turn is a loop, which is worth telling apart from two different failures.
// The decision is made inside the update callback, on the value it is given, so
// two failures reported at the same time cannot overwrite each other. Once a
// turn is a loop it stays one: a later, different failure does not downgrade it.
async function markStruggle($, reason, command, extra = {}) {
  await update($, turn, current => {
    const repeated = current.struggled && !!command && current.command === command
    const candidate = repeated ? 'repeated_error' : reason
    const kept = current.struggled && (RANK[current.reason] ?? 0) > (RANK[candidate] ?? 0) ? current.reason : candidate

    return {
      ...CLEAN_TURN,
      ...current,
      ...extra,
      struggled: true,
      reason: kept,
      command: command ?? current.command,
    }
  })
}

function basename(path) {
  return typeof path === 'string' ? path.split(/[\\/]/).filter(Boolean).pop() ?? path : null
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

// `/effort-log all`, `/effort-summary all`: every project; otherwise the
// current one. Entries written before projects were logged count everywhere.
function forProject(list, args, project) {
  if (/\ball\b/i.test(args ?? '') || !project) {
    return list
  }

  return list.filter(e => !e.project || e.project === project)
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value)

  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const EXPORT_FIELDS = ['ts', 'session', 'project', 'contextPercent', 'lastTurnTokens', 'costUsd', 'struggled', 'reason', 'consecutiveStruggles']

function toCsv(list) {
  return [EXPORT_FIELDS.join(','), ...list.map(e => EXPORT_FIELDS.map(f => csvCell(e[f])).join(','))].join('\n')
}

function bar(percent, width = 10) {
  if (typeof percent !== 'number') {
    return '·'.repeat(width)
  }
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))

  return '█'.repeat(filled) + '·'.repeat(width - filled)
}

function money(usd) {
  return typeof usd === 'number' ? `$${usd.toFixed(2)}` : null
}

function readOption(options, key, fallback, min, max) {
  const raw = Number(options?.[key])

  return Number.isFinite(raw) && options?.[key] !== undefined ? Math.min(max, Math.max(min, Math.floor(raw))) : fallback
}

function readFlag(options, key, fallback) {
  const raw = options?.[key]

  return typeof raw === 'boolean' ? raw : raw === 'true' ? true : raw === 'false' ? false : fallback
}

export function register(on, options) {
  // Only a label that keeps session logs apart, not a secret: when crypto is
  // missing, a time-and-counter id is enough (and keeps Math.random out).
  const sessionId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36).slice(-6)}${(sessionCounter += 1).toString(36)}`).slice(0, 8)
  const ownKey = `${LOG_PREFIX}${sessionId}`
  // Same range as the manifest (1-20); anything that is not a number is the default.
  const rawThreshold = Math.floor(Number(options?.threshold))
  const threshold = Number.isFinite(rawThreshold) ? Math.min(MAX_THRESHOLD, Math.max(1, rawThreshold)) : DEFAULT_THRESHOLD
  // 0 switches the context and rate-limit warnings off.
  const contextThreshold = readOption(options, 'contextThreshold', DEFAULT_CONTEXT_THRESHOLD, 0, 100)
  const rateLimitThreshold = readOption(options, 'rateLimitThreshold', DEFAULT_RATE_LIMIT_THRESHOLD, 0, 100)
  const compactHints = readFlag(options, 'compactHints', true)
  const selfCorrect = readFlag(options, 'selfCorrect', false)
  // The project this session works in, for the log; set at session.start.
  let project = null

  on('session.start', async ($, e, next) => {
    const commands = [
      ['effort-log', 'Print the effort-guard per-turn log of this project (`all` for every project)'],
      ['effort-summary', 'Print a one-line effort-guard summary of this project (`all` for every project)'],
      ['effort-reset', 'Delete the effort-guard turn log and reset the struggle streak'],
      ['effort-rerun', 'Copy the command that reruns only the last failed tests'],
      ['effort-export', 'Copy the log as CSV (`json` for JSON; a path writes a file instead)'],
      ['effort-pane', 'Open the effort-guard pane: context, cost and struggles per turn'],
    ]
    for (const [name, description] of commands) {
      await $.command.register({ name, description })
    }

    try {
      const repo = await $.session.repo()
      project = repo?.name ?? basename(repo?.root) ?? null
    } catch {}
    if (!project) {
      try {
        project = basename(await $.session.cwd())
      } catch {}
    }

    try {
      await pruneLogs($)
    } catch {}

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, turn, () => ({ ...CLEAN_TURN }))

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
    const failed = ran.isError || looksLikeTestFailure(e.command, ran.text)

    if (failed) {
      // A narrower command for the failing tests, redacted like the command.
      let rerun = null
      try {
        rerun = redactCommand(suggestRerun(e.command, ran.text), RERUN_CHARS)
      } catch {}
      await markStruggle($, ran.isError ? 'bash_error' : 'test_failure_pattern', safeCommand, rerun ? { rerun } : {})
    }

    return ran
  })

  // A failed edit (e.g. old_string not found) means the model is working from
  // a stale picture of the file. A successful one is remembered for /compact
  // and clears the file's read count.
  for (const tool of EDIT_TOOLS) {
    on('tool.call', { tool }, async ($, e, next) => {
      const ran = await next(e)

      if (e.agentId) {
        return ran
      }

      const path = e.file_path ?? e.notebook_path ?? null
      if (ran.isError) {
        await markStruggle($, 'edit_error', null)
      } else if (typeof path === 'string') {
        await update($, turn, current => {
          const reads = { ...(current.reads ?? {}) }
          delete reads[path]

          return { ...CLEAN_TURN, ...current, reads }
        })
        await update($, metrics, m => ({
          ...m,
          touchedFiles: [path, ...(m.touchedFiles ?? []).filter(p => p !== path)].slice(0, TOUCHED_FILES),
        }))
      }

      return ran
    })
  }

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const ran = await next(e)
    const path = e.file_path

    if (e.agentId || ran.isError || typeof path !== 'string') {
      return ran
    }

    let count = 0
    await update($, turn, current => {
      count = ((current.reads ?? {})[path] ?? 0) + 1

      return { ...CLEAN_TURN, ...current, reads: { ...(current.reads ?? {}), [path]: count } }
    })
    if (count === READ_LOOP) {
      await markStruggle($, 'read_loop', null)
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
      ? (usage.input_tokens ?? 0) +
        (usage.output_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0)
      : null

    // Struggle tracking and the toast must not depend on usage reporting
    // succeeding, so a failure here degrades to unknown figures instead of
    // skipping the rest of the hook.
    let contextPercent = null
    let costUsd = null
    let rateLimitPercent = null
    try {
      const sessionUsage = await $.session.usage()
      contextPercent = sessionUsage.context?.percent ?? null
      costUsd = typeof sessionUsage.cost?.usd === 'number' ? sessionUsage.cost.usd : null
      // The tightest window that has a reading (five-hour, seven-day, spend limit).
      const limits = (sessionUsage.rateLimits ?? []).map(r => r.percentUsed).filter(p => typeof p === 'number')
      rateLimitPercent = limits.length > 0 ? Math.max(...limits) : null
    } catch {}

    const current = await read($, turn)
    const prev = await read($, metrics)
    const { struggled, command } = current
    // The same command failing again, turn after turn, is not a one-off.
    const persistent =
      struggled && !!command && prev.consecutiveStruggles > 0 && prev.lastStruggleCommand === command && current.reason !== 'repeated_error'
    const reason = persistent ? 'persistent_failure' : current.reason
    const consecutiveStruggles = struggled ? prev.consecutiveStruggles + 1 : 0
    const rerunHint = struggled ? (current.rerun ?? prev.rerunHint ?? null) : null

    await update($, metrics, m => ({
      ...m,
      contextPercent,
      // A failed reading must not re-arm the context or rate-limit toast.
      lastKnownContextPercent: contextPercent ?? prev.lastKnownContextPercent ?? null,
      lastTurnTokens,
      consecutiveStruggles,
      lastStruggleCommand: struggled ? (command ?? prev.lastStruggleCommand) : null,
      lastStruggleReason: struggled ? reason : null,
      costUsd: costUsd ?? prev.costUsd ?? null,
      rateLimitPercent,
      lastKnownRateLimitPercent: rateLimitPercent ?? prev.lastKnownRateLimitPercent ?? null,
      rerunHint,
      touchedFiles: m.touchedFiles ?? [],
    }))
    await update($, turn, () => ({ ...CLEAN_TURN }))

    const entry = {
      ts: new Date().toISOString(),
      session: sessionId,
      project,
      contextPercent,
      lastTurnTokens,
      costUsd,
      struggled,
      reason,
      consecutiveStruggles,
    }

    await update($, recent, list => [...(Array.isArray(list) ? list : []), entry].slice(-RECENT_TURNS))

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

    // A narrower rerun, offered once per distinct suggestion.
    if (current.rerun && current.rerun !== prev.rerunHint) {
      $.ui.toast(`effort-guard: rerun only the failing tests: ${current.rerun.slice(0, 120)} (/effort-rerun copies it)`)
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

    // Fires once, when a rate-limit window first crosses the limit.
    if (
      rateLimitThreshold > 0 &&
      rateLimitPercent !== null &&
      rateLimitPercent >= rateLimitThreshold &&
      (prev.lastKnownRateLimitPercent ?? 0) < rateLimitThreshold
    ) {
      $.ui.toast(
        `effort-guard: rate limit at ${rateLimitPercent}%. Prefer a lighter model or lower effort for routine work.`,
      )
    }

    return next(e)
  })

  // Tells the summarizer what this session was fighting with, so a compaction
  // does not drop the very thing the model kept getting wrong.
  if (compactHints) on('session.compact', async ($, e, next) => {
    if (e.agentId) {
      return next(e)
    }

    let hint = null
    try {
      hint = buildCompactHint(await read($, metrics))
    } catch {}

    if (!hint) {
      return next(e)
    }

    return next({ ...e, instructions: withCompactHint(e.instructions, hint) })
  })

  // Opt-in: while a streak is at or past the threshold, a short section asks
  // the model to change approach instead of retrying the same thing.
  if (selfCorrect) on('prompt.compose', async ($, e, next) => {
    const result = await next(e)

    let m = null
    try {
      m = await read($, metrics)
    } catch {}
    if (!m || m.consecutiveStruggles < threshold || !Array.isArray(result?.sections)) {
      return result
    }

    return {
      ...result,
      sections: [
        ...result.sections.filter(s => s.id !== SELF_CORRECT_SECTION),
        { id: SELF_CORRECT_SECTION, text: buildSelfCorrect(m), scope: 'session' },
      ],
    }
  })

  on('command.run', { command: 'effort-log' }, async ($, e) => {
    const { list: all, failed } = await readLogs($, ownKey)
    const list = forProject(all, e?.args, project)

    if (list.length === 0) {
      return { text: logUnavailable(failed) }
    }

    const lines = list.slice(-SHOWN_TURNS).map(e => {
      const flag = e.struggled ? `STRUGGLE(${e.reason})` : 'ok'
      const cost = money(e.costUsd)

      return `${e.ts}  s=${e.session ?? '-'}${e.project ? `  p=${e.project}` : ''}  ctx=${e.contextPercent ?? '?'}%  tok=${e.lastTurnTokens ?? '?'}${cost ? `  ${cost}` : ''}  streak=${e.consecutiveStruggles}  ${flag}`
    })

    if (failed) {
      lines.push('(part of the log could not be read)')
    }

    return { text: lines.join('\n') }
  })

  on('command.run', { command: 'effort-summary' }, async ($, e) => {
    const { list: all, failed } = await readLogs($, ownKey)
    const list = forProject(all, e?.args, project)

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
    const scope = /\ball\b/i.test(e?.args ?? '') || !project ? '' : ` in ${project}`

    return {
      text:
        `effort-guard: ${list.length} turns${scope}, ${struggled.length} struggling` +
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
      lastStruggleReason: null,
      costUsd: null,
      rateLimitPercent: null,
      lastKnownRateLimitPercent: null,
      rerunHint: null,
      touchedFiles: [],
    }))
    await update($, turn, () => ({ ...CLEAN_TURN }))
    await update($, recent, () => [])

    return { text: `effort-guard: log cleared (${removed} stored log${removed === 1 ? '' : 's'}), streak reset.` }
  })

  on('command.run', { command: 'effort-rerun' }, async $ => {
    const m = await read($, metrics)

    if (!m.rerunHint) {
      return { text: 'effort-guard: no failing tests to rerun.' }
    }

    let copied = false
    try {
      copied = (await $.ui.copy({ text: m.rerunHint }))?.isCopied === true
    } catch {}

    return { text: `${m.rerunHint}${copied ? '\n(copied)' : ''}` }
  })

  on('command.run', { command: 'effort-export' }, async ($, e) => {
    const args = (e?.args ?? '').trim()
    const isJson = /^json\b/i.test(args)
    const path = args.replace(/^(?:json|csv)\b\s*/i, '').trim()
    const { list, failed } = await readLogs($, ownKey)

    if (list.length === 0) {
      return { text: logUnavailable(failed) }
    }

    const body = isJson ? JSON.stringify(list, null, 2) : toCsv(list)

    if (path) {
      try {
        await $.fs.write(path, body)

        return { text: `effort-guard: ${list.length} turns written to ${path}.` }
      } catch (err) {
        return { text: `effort-guard: could not write ${path} (${err?.message ?? 'error'}).` }
      }
    }

    let copied = false
    try {
      copied = (await $.ui.copy({ text: body }))?.isCopied === true
    } catch {}

    return {
      text: copied
        ? `effort-guard: ${list.length} turns copied as ${isJson ? 'JSON' : 'CSV'}.`
        : `effort-guard: nothing could be copied here; pass a path, e.g. /effort-export ${isJson ? 'json ' : ''}effort-log.${isJson ? 'json' : 'csv'}`,
    }
  })

  on('command.run', { command: 'effort-pane' }, async $ => {
    try {
      const { isPlaced } = await $.ui.open({ id: PANE, title: 'Effort guard' })

      return { text: isPlaced ? 'effort-guard: pane opened.' : 'effort-guard: this surface cannot show the pane; use /effort-log.' }
    } catch {
      return { text: 'effort-guard: the pane could not be opened here; use /effort-log.' }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const m = await read($, metrics)
    const list = await read($, recent)
    const rows = Math.max(1, (e.viewport?.rows ?? 24) - 8)
    const cost = money(m.costUsd)
    const reasons = {}
    for (const t of list) {
      if (t.struggled) {
        reasons[t.reason] = (reasons[t.reason] ?? 0) + 1
      }
    }
    const top = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 3)

    const header = [
      `ctx ${m.contextPercent ?? '?'}%`,
      cost,
      m.rateLimitPercent !== null && m.rateLimitPercent !== undefined ? `limit ${m.rateLimitPercent}%` : null,
      `streak ${m.consecutiveStruggles}/${threshold}`,
    ].filter(Boolean)

    return h(
      Box,
      { flexDirection: 'column' },
      h(Text, { bold: true }, header.join(' | ')),
      h(Text, { dimColor: true }, project ? `project ${project}` : 'project ?'),
      top.length > 0 ? h(Text, null, `causes: ${top.map(([r, n]) => `${r} x${n}`).join(', ')}`) : null,
      m.rerunHint ? h(Text, null, `rerun: ${m.rerunHint}`) : null,
      list.length === 0
        ? h(Text, { dimColor: true }, 'No turns yet.')
        : list.slice(-rows).map(t =>
            h(
              Text,
              { dimColor: !t.struggled },
              `${String(t.ts).slice(11, 19)} ${bar(t.contextPercent)} ${String(t.contextPercent ?? '?').padStart(3)}%  ${t.struggled ? t.reason : 'ok'}`,
            ),
          ),
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const m = await read($, metrics)

    if (m.contextPercent === null && m.lastTurnTokens === null && m.consecutiveStruggles === 0) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const parts = [`ctx ${m.contextPercent ?? '?'}%`]
    const cost = money(m.costUsd)
    if (cost) {
      parts.push(cost)
    }
    if (typeof m.rateLimitPercent === 'number') {
      parts.push(`limit ${m.rateLimitPercent}%`)
    }
    parts.push(`last turn ${m.lastTurnTokens ?? '?'} tok`)
    if (m.consecutiveStruggles > 0) {
      parts.push(`struggling x${m.consecutiveStruggles}/${threshold}`)
    }

    // `h` is provided by the mod runtime (the types contract may not declare globals).
    return h(Box, null, h(Text, { dimColor: true }, parts.join(' | ')))
  })
}
