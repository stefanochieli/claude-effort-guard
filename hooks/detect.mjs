// ---------------------------------------------------------------------------
// Which commands are worth scanning for swallowed test/build failures.
// Anything else (cat, grep, git log, echo...) can print "FAIL" without meaning it.
// ---------------------------------------------------------------------------

// Executables that are a test/build runner on their own.
const RUNNERS = new Set([
  'mvn', 'mvnw', 'mvnd', 'gradle', 'gradlew', 'jest', 'vitest', 'karma', 'playwright', 'cypress',
  'nx', 'pytest', 'py.test', 'tox', 'tsc', 'make', 'sbt', 'phpunit', 'rspec',
])

// Prefixes that run the next command (`time mvn test`, `sudo npm test`).
const WRAPPERS = new Set(['sudo', 'time', 'nice', 'nohup', 'env', 'exec', 'command', 'xvfb-run', 'timeout', 'npx', 'pnpx', 'bunx'])
const CONTAINER_WRAPPERS = new Set(['docker', 'docker-compose', 'podman', 'kubectl', 'ssh'])
const PY_RUNNERS = new Set(['uv', 'poetry', 'pipenv', 'pdm', 'hatch'])
const PKG_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
// Flags of the package managers that take a separate value (`npm --prefix web test`).
const VALUE_FLAGS = new Set(['--prefix', '--cwd', '--filter', '-F', '-C', '--dir', '-w', '--workspace', '--workspaces-root'])
const SCRIPT_WORDS = /^(?:test|t|check|build|lint|e2e)(?::|$)|^(?:verify|ci)(?::|$)/

const ENV_ASSIGNMENT = /^[A-Za-z_][\w.]*=\S*$/

function baseName(token) {
  return token
    .split(/[\\/]/)
    .pop()
    .replace(/\.(?:cmd|bat|exe|ps1)$/i, '')
}

// Splits a command line into simple commands. Quoted text is blanked so that
// `git commit -m "make tsc happy"` is not a build; `sh -c "npm test"` payloads
// are kept as commands of their own.
function simpleCommands(command) {
  const payloads = []
  const withoutPayloads = command.replace(
    /\b(?:ba|z|da)?sh\s+(?:-\w+\s+)*-c\s+(["'])(.*?)\1|\b(?:pwsh|powershell)(?:\.exe)?\s+(?:-\w+\s+)*-c(?:ommand)?\s+(["'])(.*?)\3/gi,
    (_, _q1, a, _q2, b) => {
      payloads.push(a ?? b)

      return ' '
    },
  )

  return [withoutPayloads, ...payloads].flatMap(text =>
    text
      .replace(/"[^"]*"|'[^']*'/g, '""')
      .split(/&&|\|\||[;|&()\n]/)
      .map(part => part.trim().split(/\s+/).filter(Boolean))
      .filter(tokens => tokens.length > 0),
  )
}

function isRunnerInvocation(tokens, depth = 0) {
  if (depth > 4) {
    return false
  }

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]
    const name = baseName(token)

    if (ENV_ASSIGNMENT.test(token)) {
      i += 1
    } else if (WRAPPERS.has(name)) {
      i += 1
      while (i < tokens.length && (tokens[i].startsWith('-') || (name === 'timeout' && /^\d+[smhd]?$/.test(tokens[i])))) {
        i += 1
      }
    } else {
      break
    }
  }

  if (i >= tokens.length) {
    return false
  }

  const name = baseName(tokens[i])
  const rest = tokens.slice(i + 1)

  if (RUNNERS.has(name)) {
    return true
  }

  if (CONTAINER_WRAPPERS.has(name)) {
    return rest.some((_, k) => isRunnerInvocation(rest.slice(k), depth + 1))
  }

  if (PKG_MANAGERS.has(name)) {
    let sawRun = false
    for (let k = 0; k < rest.length; k += 1) {
      const arg = rest[k]

      if (arg.startsWith('-')) {
        if (VALUE_FLAGS.has(arg) && !arg.includes('=')) {
          k += 1
        }
      } else if (arg === 'run' || arg === 'run-script' || arg === 'workspaces' || arg === 'workspace') {
        sawRun = sawRun || arg.startsWith('run')
      } else if (arg === 'exec' || arg === 'dlx') {
        return isRunnerInvocation(rest.slice(k + 1), depth + 1)
      } else {
        const script = SCRIPT_WORDS.test(arg) && (sawRun || !/^(?:verify|ci)/.test(arg))

        return script || RUNNERS.has(baseName(arg))
      }
    }

    return false
  }

  if (name === 'ng') {
    return /^(?:test|build|lint|e2e)$/.test(rest[0] ?? '')
  }

  if (name === 'go' || name === 'cargo' || name === 'dotnet') {
    return /^(?:test|build)$/.test(rest[0] ?? '')
  }

  if (name === 'deno') {
    return rest[0] === 'test'
  }

  if (name === 'claude') {
    return rest[0] === 'plugin' && rest[1] === 'test'
  }

  if (/^(?:python|python3|py)(?:[\d.]+)?$/.test(name)) {
    return (rest[0] === '-m' && /^(?:pytest|unittest)$/.test(rest[1] ?? '')) || (/manage\.py$/.test(rest[0] ?? '') && rest[1] === 'test')
  }

  if (PY_RUNNERS.has(name)) {
    return rest[0] === 'run' && isRunnerInvocation(rest.slice(1), depth + 1)
  }

  return false
}

// ---------------------------------------------------------------------------
// What a runner prints when it failed but the exit code was swallowed
// (`npm test || true`, `mvn test | tee out.txt`) or never non-zero.
// ---------------------------------------------------------------------------

// Counters and summaries: reliable wherever they appear in the tail.
const SUMMARY_PATTERNS = [
  /\d+\s+failing/i,
  /tests?:\s*\d+\s*failed/i,
  // jest, vitest, playwright, pytest summaries: "Tests: 1 failed", "  1 failed", "=== 2 failed, 3 passed"
  /^[\s=\-│|]*(?:(?:Test Suites?|Test Files|Tests?|Specs?)\s*:?\s+)?[1-9]\d*\s+failed\b/im,
  /\b[1-9]\d*\s+of\s+\d+\s+failed\b/i,
  /^=+.*\b[1-9]\d*\s+errors?\b/im,
  /BUILD FAILURE/i,
  /^BUILD FAILED\b|^FAILURE: Build failed/m,
  /\[ERROR\]\s+Failed to execute goal/,
  /There are test failures/,
  /\[ERROR\]\s+COMPILATION ERROR/,
  /^>\s*Task\s+\S+\s+FAILED\b/m,
  /\d+\s+tests? completed,\s+[1-9]\d*\s+failed/,
  /Tests run:.*(?:Failures|Errors):\s*[1-9]/,
  /<<<\s*(?:FAILURE|ERROR)!/,
  /Executed \d+ of \d+.*\bFAILED\b/,
  /TOTAL: [1-9]\d* FAILED/,
  /^Failed!/m,
  /^\s*Failed tasks:/im,
  /test result: FAILED/,
  /\berror TS\d+:/,
]

// Bare words and symbols: only at the start of a line (jest "FAIL src/a.test.ts",
// pytest "FAILED tests/a.py::t", go "--- FAIL:"), so that a passing test named
// "handles FAILED login" or a log line containing "FAILED to load" does not count.
const LINE_START_PATTERNS = [
  /^\s*(?:--- )?(?:FAIL|FAILED|FAILURE)\b/m,
  /^[\s│|]*[✗✖✘]/m,
  /^\s*(?:E\s+)?(?:\w+\.)*AssertionError\b/m,
]

// Summary lines that name a failure counter but report none: "0 failed",
// "Failures: 0". "BUILD FAILURE" is not among them.
const ZERO_COUNT = /\b0\s+(?:failed|failing|failures?)\b|\b(?:failed|failures?):\s*0\b|\bno failures\b/gi

// Terminal colour codes get between "Tests:" and "1 failed".
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

// Only the tail of the output holds the runner's summary; scanning all of it
// would flag a test that merely prints "FAIL" in its own log lines.
const TAIL_CHARS = 4000

export function isTestCommand(command) {
  return typeof command === 'string' && simpleCommands(command).some(tokens => isRunnerInvocation(tokens))
}

export function looksLikeTestFailure(command, text) {
  if (!isTestCommand(command) || typeof text !== 'string' || !text) {
    return false
  }

  const tail = text.slice(-TAIL_CHARS).replace(ANSI, '').replace(ZERO_COUNT, '')

  return SUMMARY_PATTERNS.some(re => re.test(tail)) || LINE_START_PATTERNS.some(re => re.test(tail))
}

// A command line is not a secret store, but it often holds one: tokens in
// `KEY=value`, `Authorization: Bearer ...`, `https://user:pass@host`.
// Used before a command is shown in a toast or kept in the plugin state.
export function redactCommand(command, max = 60) {
  if (typeof command !== 'string') {
    return null
  }

  const clean = command
    .replace(/\b([\w.-]*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|PWD|AUTH|CREDENTIAL)[\w.-]*)=\S+/gi, '$1=***')
    .replace(/\b(Bearer|Basic|Token)\s+[\w.~+/=-]+/gi, '$1 ***')
    .replace(/:\/\/[^/\s:@]+:[^@\s]+@/g, '://***@')
    .replace(/(--?(?:password|passwd|token|secret|api-?key|auth|pwd)(?:=|\s+))\S+/gi, '$1***')

  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}
