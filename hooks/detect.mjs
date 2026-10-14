// Commands whose output is worth scanning for swallowed test/build failures.
// Anything else (cat, grep, git log...) can print "FAIL" without meaning it.
const TEST_COMMAND = new RegExp(
  [
    String.raw`(?:^|[\s;&|(])(?:\./)?(?:mvnw?|gradlew?|jest|vitest|karma|playwright|cypress|nx|pytest|tox|tsc|make)(?=\s|$)`,
    String.raw`\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|check|build|lint|e2e)\b`,
    String.raw`\bng\s+(?:test|build|lint|e2e)\b`,
    String.raw`\b(?:go|cargo|dotnet)\s+(?:test|build)\b`,
    String.raw`\bclaude\s+plugin\s+test\b`,
  ].join('|'),
)

// Text a runner prints when it failed but the exit code was swallowed
// (`npm test || true`) or the failure is reported without a non-zero exit.
const FAILURE_PATTERNS = [
  /\bFAIL(ED|URE)?\b/,
  /\d+\s+failing/i,
  /tests?:\s*\d+\s*failed/i,
  /assertionerror/i,
  /BUILD FAILURE/i,
  /\[ERROR\]\s+(?:Tests run:|Failed to execute goal)/,
  /Tests run:.*(?:Failures|Errors):\s*[1-9]/,
  /Executed \d+ of \d+.*\bFAILED\b/,
  /[✗✖]/,
]

// Summary lines that name a failure counter but report none: "0 failed",
// "Failures: 0", "BUILD FAILURE" is not among them.
const ZERO_COUNT = /\b0\s+(?:failed|failing|failures?)\b|\b(?:failed|failures?):\s*0\b/gi

// Only the tail of the output holds the runner's summary; scanning all of it
// would flag a test that merely prints "FAIL" in its own log lines.
const TAIL_CHARS = 4000

export function isTestCommand(command) {
  return typeof command === 'string' && TEST_COMMAND.test(command)
}

export function looksLikeTestFailure(command, text) {
  if (!isTestCommand(command) || !text) {
    return false
  }

  const tail = text.slice(-TAIL_CHARS).replace(ZERO_COUNT, '')

  return FAILURE_PATTERNS.some(re => re.test(tail))
}
