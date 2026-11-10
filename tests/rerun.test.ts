import { test, expect } from 'claude-code/testing'
import { suggestRerun } from '../hooks/rerun.mjs'

test('Maven: reruns only the failing methods, keeping -pl and quiet flags', () => {
  const out = [
    '[ERROR] Tests run: 3, Failures: 1 <<< FAILURE! -- in com.acme.FooTest',
    '[ERROR] com.acme.FooTest.bar -- Time elapsed: 0.01 s <<< FAILURE!',
    '[ERROR] Failures: ',
    '[ERROR]   FooTest.bar:42 expected: <1> but was: <2>',
    '[INFO] BUILD FAILURE',
  ].join('\n')

  expect(suggestRerun('./mvnw -q -pl api verify | tee b.log', out)).toBe(
    './mvnw -q -pl api test -Dtest=FooTest#bar -Dsurefire.failIfNoSpecifiedTests=false',
  )
})

test('Maven: JUnit 4 wording and Failsafe ITs', () => {
  expect(suggestRerun('mvn verify', '[ERROR] bar(com.acme.OrderIT)  Time elapsed: 0.2 s  <<< ERROR!')).toBe(
    'mvn verify -Dit.test=OrderIT#bar -Dfailsafe.failIfNoSpecifiedTests=false',
  )
})

test('Gradle: --tests per failing method, on the task that ran', () => {
  const out = 'com.acme.FooTest > bar() FAILED\n    org.opentest4j.AssertionFailedError\nFooTest > baz FAILED'
  expect(suggestRerun('./gradlew :api:test', out)).toBe('./gradlew :api:test --tests com.acme.FooTest.bar --tests FooTest.baz')
})

test('Jest, Vitest, Angular and npm scripts: the failing spec files', () => {
  expect(suggestRerun('npx jest --ci', 'FAIL src/app/foo.spec.ts\n  ● foo › works')).toBe('npx jest src/app/foo.spec.ts')
  expect(suggestRerun('npx vitest run', ' FAIL  src/a.test.ts > suite > case')).toBe('npx vitest run src/a.test.ts')
  expect(suggestRerun('ng test --watch=false', 'FAIL src/app/x.component.spec.ts')).toBe(
    'npx ng test --watch=false --include=src/app/x.component.spec.ts',
  )
  expect(suggestRerun('npm run test -- --watch=false', 'FAIL  src/a.test.tsx')).toBe('npm test -- src/a.test.tsx')
})

test('pytest: the failing node ids, with the same launcher', () => {
  const out = 'FAILED tests/test_a.py::test_x - AssertionError\nFAILED tests/test_b.py::T::test_y[1-2]'
  expect(suggestRerun('python -m pytest -x', out)).toBe("python -m pytest tests/test_a.py::test_x 'tests/test_b.py::T::test_y[1-2]'")
})

test('nothing to target: no suggestion', () => {
  expect(suggestRerun('mvn test', '[INFO] BUILD FAILURE')).toBe(null)
  expect(suggestRerun('cat log', 'FAIL src/a.spec.ts')).toBe(null)
  expect(suggestRerun(undefined as any, 'x')).toBe(null)
})
