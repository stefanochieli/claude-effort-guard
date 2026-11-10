import { test, expect, mock } from 'claude-code/testing'

const turnDone = (id: string) => ({ reason: 'answer' as const, answer: '', durationMs: 100, isAborted: false, turnId: id })

// The engine stands beneath the plugin: these floor hooks answer for it.
// No floor for session.usage: effort-guard must tolerate it being unavailable.
function engine(on: any, state: { text: string }, toasts: string[]) {
  mock.store(on)
  on('ui.toast', ($: any, e: any) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('prompt.submit', ($: any, e: any) => ({ text: e.text }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  // A floor tool.call can only answer { result } or { deny }: a swallowed-exit-code
  // failure (text pattern, exit 0) is what it simulates directly.
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: state.text, stderr: '' }, text: state.text }))
}

async function runTurn($: any, id: string, command = 'npm test') {
  await $.prompt.submit({ text: 'go' })
  await $.tool.call({ tool: 'Bash', command })
  await $.turn.complete(turnDone(id))
}

test('toasts once per streak at 3 struggling turns; a clean turn resets and re-arms it', async ($, on) => {
  const toasts: string[] = []
  const state = { text: '2 tests, 1 failing' }
  engine(on, state, toasts)

  for (let i = 0; i < 4; i++) await runTurn($, `t${i}`)

  // 4 struggling turns, one toast: the 4th does not toast again.
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('3 struggling turns')

  state.text = 'ok'
  await runTurn($, 'clean')
  expect((await $.command.run({ command: 'effort-log' })).text).toContain('streak=0')

  // A new streak toasts again once it reaches the threshold.
  state.text = '2 tests, 1 failing'
  for (let i = 0; i < 3; i++) await runTurn($, `s${i}`)
  expect(toasts.length).toBe(2)
})

test('the threshold comes from the userConfig option', { options: { threshold: 2 } }, async ($, on) => {
  const toasts: string[] = []
  engine(on, { text: '1 failing' }, toasts)

  await runTurn($, 'a')
  expect(toasts.length).toBe(0)
  await runTurn($, 'b')
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('2 struggling turns')
})

test('failure text from a non-test command is not a struggle', async ($, on) => {
  const toasts: string[] = []
  engine(on, { text: 'FAILED 1 failing' }, toasts)

  for (let i = 0; i < 3; i++) await runTurn($, `c${i}`, 'cat build.log')

  expect(toasts.length).toBe(0)
  expect((await $.command.run({ command: 'effort-log' })).text).toContain('streak=0')
})

test("a subagent's Bash failure does not make the main turn a struggle", async ($, on) => {
  const toasts: string[] = []
  engine(on, { text: '1 failing' }, toasts)

  for (let i = 0; i < 3; i++) {
    await $.prompt.submit({ text: 'go' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'sub1' })
    await $.turn.complete(turnDone(`m${i}`))
  }

  expect(toasts.length).toBe(0)
})

test('a subagent turn is not logged or counted', async ($, on) => {
  const toasts: string[] = []
  engine(on, { text: 'ok' }, toasts)

  await $.turn.complete({ ...turnDone('sub-turn'), agentId: 'sub1' })

  expect((await $.command.run({ command: 'effort-log' })).text).toContain('no turns logged yet')
})

test('the log persists in the store and /effort-log reads it back', async ($, on) => {
  engine(on, { text: 'ok' }, [])

  expect((await $.command.run({ command: 'effort-log' })).text).toContain('no turns logged yet')
  await runTurn($, 'one')
  await runTurn($, 'two')

  const lines = (await $.command.run({ command: 'effort-log' })).text.split('\n')
  expect(lines.length).toBe(2)
  // session.usage has no floor in the test: the percent degrades to unknown.
  expect(lines[0]).toContain('ctx=?%')
  expect(lines[1]).toContain('ok')
})

test('the band above the prompt shows context, tokens and the streak', async ($, on) => {
  engine(on, { text: '1 failing' }, [])
  await runTurn($, 'band')

  const band = await $.ui.mount({
    plugin: 'effort-guard',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, bodyColumns: 80 },
  })
  const texts = (await band.findAll({ type: 'Text' })).map((t: any) => t.text)

  expect(texts.join(' ')).toContain('struggling x1/3')
})

test('/effort-summary reports turns, struggles and the most common reason', async ($, on) => {
  engine(on, { text: '1 failing' }, [])

  await runTurn($, 'a')
  await runTurn($, 'b')

  const out = (await $.command.run({ command: 'effort-summary' })).text
  expect(out).toContain('2 turns, 2 struggling')
  expect(out).toContain('test_failure_pattern')
})

// --- more floors: usage, failing tools, store failures ------------------------

function toolFloors(on: any, toasts: string[], bash: { text: string; isError?: boolean }, edit: { isError?: boolean } = {}) {
  mock.store(on)
  on('ui.toast', ($: any, e: any) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('prompt.submit', ($: any, e: any) => ({ text: e.text }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: bash.text, stderr: '' }, text: bash.text, isError: !!bash.isError }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: { ok: !edit.isError }, text: 'edit', isError: !!edit.isError }))
}

test('the context toast fires once per crossing and a failed reading does not re-arm it', async ($, on) => {
  const toasts: string[] = []
  toolFloors(on, toasts, { text: 'ok' })
  let percent: number | null = 0
  on('session.usage', () => ({ value: { context: { percent } } }) as any)

  // 85 toasts; 90 stays quiet; an unreadable turn and 91 stay quiet; 50 re-arms; 85 toasts again.
  for (const p of [85, 90, null, 91, 50, 85]) {
    percent = p
    await $.prompt.submit({ text: 'go' })
    await $.turn.complete(turnDone(`c${p}`))
  }

  expect(toasts.length).toBe(2)
  expect(toasts[0]).toContain('context at 85%')
})

test('contextThreshold 0 switches the context toast off', { options: { contextThreshold: 0 } }, async ($, on) => {
  const toasts: string[] = []
  toolFloors(on, toasts, { text: 'ok' })
  on('session.usage', () => ({ value: { context: { percent: 99 } } }) as any)

  await runTurn($, 'hot')

  expect(toasts.length).toBe(0)
  expect((await $.command.run({ command: 'effort-log' })).text).toContain('ctx=99%')
})

test('a failed Edit is an edit_error struggle', async ($, on) => {
  toolFloors(on, [], { text: 'ok' }, { isError: true })

  await $.prompt.submit({ text: 'go' })
  await $.tool.call({ tool: 'Edit', file_path: '/a', old_string: 'a', new_string: 'b' })
  await $.turn.complete(turnDone('edit'))

  expect((await $.command.run({ command: 'effort-log' })).text).toContain('STRUGGLE(edit_error)')
})

test('the same command failing twice in a turn is repeated_error, and stays so', async ($, on) => {
  toolFloors(on, [], { text: 'boom', isError: true })

  await $.prompt.submit({ text: 'go' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  // A different failure afterwards must not hide the loop.
  await $.tool.call({ tool: 'Bash', command: 'ls nowhere' })
  await $.turn.complete(turnDone('loop'))

  expect((await $.command.run({ command: 'effort-log' })).text).toContain('STRUGGLE(repeated_error)')
})

test('two different failing commands are a bash_error, not a loop', async ($, on) => {
  toolFloors(on, [], { text: 'boom', isError: true })

  await $.prompt.submit({ text: 'go' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Bash', command: 'ls nowhere' })
  await $.turn.complete(turnDone('two'))

  expect((await $.command.run({ command: 'effort-log' })).text).toContain('STRUGGLE(bash_error)')
})

test('the toast and the log never show a secret from the failing command', async ($, on) => {
  const toasts: string[] = []
  toolFloors(on, toasts, { text: 'denied', isError: true })

  for (let i = 0; i < 3; i++) {
    await $.prompt.submit({ text: 'go' })
    await $.tool.call({ tool: 'Bash', command: 'curl -H "Authorization: Bearer abc123secret" https://api.example.com' })
    await $.turn.complete(turnDone(`s${i}`))
  }

  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('struggling turns')
  expect(toasts[0]).not.toContain('abc123secret')
  expect((await $.command.run({ command: 'effort-log' })).text).not.toContain('abc123secret')
})

test('/effort-log shows at most the last 50 turns, tagged with the session', async ($, on) => {
  toolFloors(on, [], { text: 'ok' })

  for (let i = 0; i < 53; i++) await runTurn($, `n${i}`)

  const lines = (await $.command.run({ command: 'effort-log' })).text.split('\n')
  expect(lines.length).toBe(50)
  expect(lines[0]).toMatch(/ s=[0-9a-f-]{8} /)
  expect((await $.command.run({ command: 'effort-summary' })).text).toContain('53 turns')
})

test('missing usage fields do not turn the token count into NaN', async ($, on) => {
  toolFloors(on, [], { text: 'ok' })

  await $.prompt.submit({ text: 'go' })
  await $.turn.complete({ ...turnDone('u'), usage: { input_tokens: 10, output_tokens: 5 } } as any)

  expect((await $.command.run({ command: 'effort-log' })).text).toContain('tok=15')
})

test('an unreadable store is reported, not shown as an empty log', async ($, on) => {
  on('store.get', () => {
    throw new Error('store file is malformed')
  })
  on('store.keys', () => ({ value: [] }))
  on('store.set', () => ({ value: undefined }))

  const out = (await $.command.run({ command: 'effort-log' })).text

  expect(out).toContain('could not be read')
  expect(out).not.toContain('no turns logged yet')
})

test('a failed Write counts as an edit_error and the toast names the cause', { options: { threshold: 1 } }, async ($, on) => {
  const toasts: string[] = []
  engine(on, { text: 'ok' }, toasts)
  on('tool.call', { tool: 'Write' }, () => ({ result: { stdout: '', stderr: 'boom' }, text: 'boom', isError: true }))

  await $.prompt.submit({ text: 'go' })
  await $.tool.call({ tool: 'Write', path: 'a.txt' })
  await $.turn.complete(turnDone('w'))

  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('last cause: edit_error')
})

test('/effort-reset clears the log and the streak', async ($, on) => {
  engine(on, { text: '1 failing' }, [])
  await runTurn($, 'a')
  await runTurn($, 'b')

  expect((await $.command.run({ command: 'effort-reset' })).text).toContain('log cleared')
  expect((await $.command.run({ command: 'effort-log' })).text).toContain('no turns logged yet')
})
