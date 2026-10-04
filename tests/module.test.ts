import { test, expect, mock } from 'claude-code/testing'

const turnDone = (id: string) => ({ reason: 'answer' as const, answer: '', durationMs: 100, isAborted: false, turnId: id })

// The engine stands beneath the plugin: these floor hooks answer for it.
// No floor for session.usage: effort-guard must tolerate it being unavailable.
function engine(on: any, state: { text: string }, toasts: string[]) {
  mock.store(on)
  on('ui.toast', ($: any, e: any) => {
    toasts.push(e.text)
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
