import { test, expect } from 'claude-code/testing'
import { isTestCommand, looksLikeTestFailure, redactCommand } from '../hooks/detect.mjs'

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

test('recognises package-manager and wrapper forms of monorepos and Windows', () => {
  for (const cmd of [
    'pnpm --filter api test',
    'pnpm -F api test',
    'npm --prefix web test',
    'yarn --cwd web test',
    'pnpm -r test',
    'yarn workspaces run test',
    'npm t',
    'npm run verify',
    'npm run ci',
    './node_modules/.bin/jest',
    '../mvnw test',
    '/usr/bin/mvn test',
    'mvnw.cmd test',
    '.\\mvnw test',
    'gradlew.bat build',
    'C:\\tools\\mvn.cmd test',
    'mvnd test',
    'sbt test',
    'python -m unittest',
    'python manage.py test',
    'uv run pytest',
    'xvfb-run npx cypress run',
    'bash -c "npm test"',
    'mvn test | tee out.txt',
  ]) {
    expect(isTestCommand(cmd)).toBe(true)
  }
})

test('words inside quotes or plain installs are not test commands', () => {
  for (const cmd of ['git commit -m "fix: make tsc happy"', 'echo "run mvn test"', 'npm ci', 'npm install', 'dotnet run', 'gh pr create --title "make it work"']) {
    expect(isTestCommand(cmd)).toBe(false)
  }
})

test('failure text of Playwright, nx, dotnet, pytest, vitest, tsc and cargo', () => {
  expect(looksLikeTestFailure('npx playwright test', '  ✘  1 [chromium] › a.spec.ts:3:1 › title (1.2s)\n  1 failed\n  3 passed (4s)')).toBe(true)
  expect(looksLikeTestFailure('nx test api', 'NX   Running target test for project api failed\n\nFailed tasks:\n\n- api:test')).toBe(true)
  expect(looksLikeTestFailure('dotnet test', 'Failed!  - Failed:     1, Passed:     2, Skipped:     0')).toBe(true)
  expect(looksLikeTestFailure('pytest', '=== 2 failed, 3 passed in 1.2s ===')).toBe(true)
  expect(looksLikeTestFailure('pytest', '=== 1 error in 0.3s ===')).toBe(true)
  expect(looksLikeTestFailure('vitest run', ' Tests  1 failed | 2 passed (3)')).toBe(true)
  expect(looksLikeTestFailure('npx tsc --noEmit', "src/a.ts(1,1): error TS2322: Type 'x' is not assignable")).toBe(true)
  expect(looksLikeTestFailure('cargo test', 'test result: FAILED. 0 passed; 1 failed')).toBe(true)
  expect(looksLikeTestFailure('npx cypress run', '✖  1 of 1 failed (100%)  00:01  1  -  1  -  -')).toBe(true)
})

test('green runs that print the words FAILED or FAILURE are not failures', () => {
  expect(looksLikeTestFailure('npm test', '  ✓ handles FAILED login (3ms)\nTests: 3 passed, 3 total')).toBe(false)
  expect(looksLikeTestFailure('ng test', "ERROR: 'FAILED to load a font'\nExecuted 3 of 3 SUCCESS (0.1 secs)")).toBe(false)
  expect(looksLikeTestFailure('mvn test', 'FAILURE_MODE tests\nTests run: 3, Failures: 0, Errors: 0')).toBe(false)
  expect(looksLikeTestFailure('dotnet test', 'Passed!  - Failed:     0, Passed:     2')).toBe(false)
  expect(looksLikeTestFailure('mocha', '  1 passing\n  0 failing')).toBe(false)
})

test('a failure at the start of a line still counts', () => {
  expect(looksLikeTestFailure('npx jest', 'FAIL src/a.test.ts\n  ● a › works')).toBe(true)
  expect(looksLikeTestFailure('pytest', 'FAILED tests/a.py::test_x - assert 1 == 2')).toBe(true)
  expect(looksLikeTestFailure('go test ./...', '--- FAIL: TestX (0.00s)')).toBe(true)
})

test('terminal colour codes do not hide a failure or a zero count', () => {
  expect(looksLikeTestFailure('npm test', '\u001b[31mFAIL\u001b[39m src/a.test.ts')).toBe(true)
  expect(looksLikeTestFailure('npx jest', 'Tests:       \u001b[31m1 failed\u001b[39m, 2 passed')).toBe(true)
  expect(looksLikeTestFailure('npm test', 'Tests: \u001b[32m0 failed\u001b[39m, 3 passed')).toBe(false)
})

test('redactCommand hides secrets and shortens the command', () => {
  const shown = redactCommand('curl -H "Authorization: Bearer abc123" https://user:hunter2@host/x -u a --password s3cret API_TOKEN=xyz789 ./run.sh')

  for (const secret of ['abc123', 'hunter2', 's3cret', 'xyz789']) {
    expect(shown?.includes(secret)).toBe(false)
  }
  expect(redactCommand('x'.repeat(100), 10)?.length).toBe(11)
  expect(redactCommand(undefined)).toBe(null)
})

test('Surefire summaries with zero failures are not failures; real Maven/Gradle failures are', () => {
  expect(looksLikeTestFailure('mvn test', '[ERROR] Tests run: 8, Failures: 0, Errors: 0\n[INFO] BUILD SUCCESS')).toBe(false)
  expect(looksLikeTestFailure('mvn verify', '[ERROR] There are test failures.')).toBe(true)
  expect(looksLikeTestFailure('mvn compile', '[ERROR] COMPILATION ERROR :')).toBe(true)
  expect(looksLikeTestFailure('./gradlew test', '> Task :test FAILED\n12 tests completed, 1 failed')).toBe(true)
})
