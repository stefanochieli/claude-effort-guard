import { test, expect } from 'claude-code/testing'
import { isTestCommand, looksLikeTestFailure } from '../hooks/detect.mjs'

test('recognises the test and build runners of the usual stacks', () => {
  for (const cmd of [
    'npm test',
    'npm run test -- --watch=false',
    'pnpm run build',
    'yarn lint',
    'ng test --watch=false',
    'ng build',
    './mvnw -q verify',
    'mvn clean install',
    'cd api && ./gradlew test',
    'pytest -x',
    'go test ./...',
    'cargo build',
    'claude plugin test .',
  ]) {
    expect(isTestCommand(cmd)).toBe(true)
  }
})

test('ignores commands that only print text', () => {
  for (const cmd of ['cat build.log', 'grep FAIL build.log', 'git log --oneline', 'echo FAILED', 'ls', undefined]) {
    expect(isTestCommand(cmd)).toBe(false)
  }
})

test('failure text only counts for a test command', () => {
  expect(looksLikeTestFailure('npm test || true', 'Tests: 2 failed, 5 passed')).toBe(true)
  expect(looksLikeTestFailure('mvn test', '[ERROR] BUILD FAILURE')).toBe(true)
  expect(looksLikeTestFailure('npm test', '12 passing')).toBe(false)
  expect(looksLikeTestFailure('cat build.log', 'FAILED')).toBe(false)
})

test('zero-failure summaries are not failures', () => {
  expect(looksLikeTestFailure('npm test', 'Tests: 0 failed, 12 passed')).toBe(false)
  expect(looksLikeTestFailure('mvn test', 'Tests run: 8, Failures: 0, Errors: 0, Skipped: 0')).toBe(false)
  expect(looksLikeTestFailure('ng test', 'Executed 5 of 5 SUCCESS')).toBe(false)
})

test('recognises Surefire and Karma failures', () => {
  expect(looksLikeTestFailure('mvn test', 'Tests run: 8, Failures: 2, Errors: 0, Skipped: 0')).toBe(true)
  expect(looksLikeTestFailure('mvn verify', '[ERROR] Tests run: 3, Failures: 1')).toBe(true)
  expect(looksLikeTestFailure('ng test', 'Executed 4 of 5 (1 FAILED)')).toBe(true)
})

test('only the tail of the output counts', () => {
  const noisy = 'FAIL in a log line\n' + 'x'.repeat(5000) + '\n12 passing'
  expect(looksLikeTestFailure('npm test', noisy)).toBe(false)
})

test('recognises more runners', () => {
  for (const cmd of ['npx playwright test', 'npx cypress run', 'nx test api']) {
    expect(isTestCommand(cmd)).toBe(true)
  }
})
