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
