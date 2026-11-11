// Builds a narrower command that reruns only the tests a runner reported as
// failed, so the next attempt costs seconds instead of a whole build.
// Pure functions: the module decides when to show the result.

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const TAIL_CHARS = 8000
const MAX_TARGETS = 5

function unique(list) {
  return [...new Set(list)].slice(0, MAX_TARGETS)
}

function quote(arg) {
  return /^[\w./:#@,=+-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`
}

// The first simple command of the line that ran the tests, without what
// follows a pipe or `||` (`mvn test | tee log` -> `mvn test`).
function head(command) {
  return command.split(/\|\||&&|[|;]/).map(part => part.trim()).find(Boolean) ?? ''
}

// `com.acme.FooTest` -> `FooTest`; Surefire's -Dtest takes the simple name.
function simpleClass(name) {
  return name.split('.').pop()
}

// Surefire / Failsafe, JUnit 4 and 5, Maven 3 and 4 wording.
function mavenTargets(text) {
  const found = []
  const patterns = [
    // [ERROR] com.acme.FooTest.bar -- Time elapsed: 0.01 s <<< FAILURE!
    /^\[ERROR\]\s+([\w.$]+)\.([\w$]+)(?:\(\))?\s+(?:--\s+)?Time elapsed:.*<<<\s*(?:FAILURE|ERROR)!/gm,
    // [ERROR] bar(com.acme.FooTest)  Time elapsed: 0.01 s  <<< FAILURE!
    /^\[ERROR\]\s+([\w$]+)\(([\w.$]+)\)\s+Time elapsed:.*<<<\s*(?:FAILURE|ERROR)!/gm,
    // [ERROR]   FooTest.bar:42 expected: <1> but was: <2>
    /^\[ERROR\]\s{2,}([\w.$]+)\.([\w$]+):\d+/gm,
  ]

  for (const [i, re] of patterns.entries()) {
    for (const m of text.matchAll(re)) {
      const [cls, method] = i === 1 ? [m[2], m[1]] : [m[1], m[2]]
      found.push(`${simpleClass(cls)}#${method}`)
    }
  }

  return unique(found)
}

function mavenRerun(command, text) {
  const targets = mavenTargets(text)
  if (targets.length === 0) {
    return null
  }

  const tokens = head(command).split(/\s+/)
  const runner = tokens.find(t => /(?:^|[\\/])mvn(?:w|d)?(?:\.cmd)?$/.test(t))
  if (!runner) {
    return null
  }

  // Keep the module selection and quiet/batch flags; drop goals and other flags.
  const keep = []
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]
    if ((t === '-pl' || t === '--projects') && tokens[i + 1]) {
      keep.push(t, tokens[i + 1])
      i += 1
    } else if (/^-(?:q|B|o|am)$|^--(?:quiet|batch-mode|offline|also-make)$|^-P\S+/.test(t)) {
      keep.push(t)
    }
  }
  // Failsafe ITs run under verify with -Dit.test; anything else under test.
  const isIt = targets.every(t => /IT#/.test(t))
  const property = isIt ? 'it.test' : 'test'
  const goal = isIt ? 'verify' : 'test'

  const plugin = isIt ? 'failsafe' : 'surefire'

  return [runner, ...keep, goal, `-D${property}=${quote(targets.join(','))}`, `-D${plugin}.failIfNoSpecifiedTests=false`].join(' ')
}

function gradleRerun(command, text) {
  // FooTest > bar() FAILED   /   com.acme.FooTest > bar FAILED
  const found = [...text.matchAll(/^([\w.$]+) > (.+) FAILED$/gm)].map(m => `${m[1]}.${m[2].trim().replace(/\(\)$/, '')}`)
  // A display name with spaces (@DisplayName) cannot be targeted by --tests.
  const targets = unique(found.filter(t => /^[\w.$]+$/.test(t)))
  if (targets.length === 0) {
    return null
  }

  const tokens = head(command).split(/\s+/)
  const runner = tokens.find(t => /(?:^|[\\/])gradlew?(?:\.bat)?$/.test(t))
  if (!runner) {
    return null
  }
  // The test task the command ran (`:api:test`), else `test`.
  const task = tokens.find(t => /(?:^|:)(?:test|integrationTest)$/.test(t)) ?? 'test'

  return [runner, task, ...targets.flatMap(t => ['--tests', quote(t)])].join(' ')
}

function jsRerun(command, text) {
  // jest / vitest: "FAIL src/app/foo.spec.ts" (vitest may add " > suite > test")
  const files = unique([...text.matchAll(/^\s*FAIL\s+(\S+\.(?:spec|test)\.[cm]?[jt]sx?)\b/gm)].map(m => m[1]))
  if (files.length === 0) {
    return null
  }

  const line = head(command)
  if (/\bvitest\b/.test(line)) {
    return `npx vitest run ${files.map(quote).join(' ')}`
  }
  if (/\bjest\b/.test(line)) {
    return `npx jest ${files.map(quote).join(' ')}`
  }
  if (/\bng\s+test\b/.test(line)) {
    return `npx ng test --watch=false ${files.map(f => `--include=${quote(f)}`).join(' ')}`
  }
  const pm = line.match(/\b(npm|pnpm|yarn|bun)\b/)?.[1]
  if (pm) {
    return `${pm} ${pm === 'npm' ? 'test --' : 'test'} ${files.map(quote).join(' ')}`
  }

  return null
}

function pytestRerun(command, text) {
  // FAILED tests/test_a.py::test_x - AssertionError
  const ids = unique([...text.matchAll(/^FAILED\s+(\S+\.py::\S+)/gm)].map(m => m[1]))
  if (ids.length === 0) {
    return null
  }

  const line = head(command)
  const prefix = line.match(/^(.*?\bpytest\b)/)?.[1] ?? (/-m\s+pytest/.test(line) ? line.match(/^(.*?-m\s+pytest)/)[1] : 'pytest')

  return `${prefix} ${ids.map(quote).join(' ')}`
}

// Returns a narrower command, or null when the output names no failed test
// this knows how to target.
export function suggestRerun(command, text) {
  if (typeof command !== 'string' || typeof text !== 'string' || !text) {
    return null
  }

  const tail = text.slice(-TAIL_CHARS).replace(ANSI, '')
  const line = head(command)

  if (/(?:^|[\s\\/])mvn(?:w|d)?(?:\.cmd)?\b/.test(line)) {
    return mavenRerun(command, tail)
  }
  if (/(?:^|[\s\\/])gradlew?(?:\.bat)?\b/.test(line)) {
    return gradleRerun(command, tail)
  }
  if (/\bpytest\b/.test(line)) {
    return pytestRerun(command, tail)
  }

  return jsRerun(command, tail)
}
