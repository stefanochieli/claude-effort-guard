import { test, expect } from 'claude-code/testing'
import { looksLikeTestFailure } from '../hooks/detect.mjs'

// Accuracy fixtures: realistic runner output, as the tail of a command whose
// exit code was swallowed. `fails` is what a person reading it would say.
// Add a case whenever a real output is misjudged.
const fixtures: Array<{ name: string; command: string; fails: boolean; output: string }> = [
  {
    name: 'Maven: green build with a test that logs ERROR lines',
    command: 'mvn -B test',
    fails: false,
    output: [
      '[INFO] Running com.acme.OrderServiceTest',
      '2026-11-10 ERROR [main] c.a.OrderService - payment declined (expected by the test)',
      '[INFO] Tests run: 12, Failures: 0, Errors: 0, Skipped: 1, Time elapsed: 1.2 s',
      '[INFO] Tests run: 12, Failures: 0, Errors: 0, Skipped: 1',
      '[INFO] BUILD SUCCESS',
    ].join('\n'),
  },
  {
    name: 'Maven: assertion failure',
    command: './mvnw verify | tee build.log',
    fails: true,
    output: [
      '[ERROR] Tests run: 12, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 1.2 s <<< FAILURE!',
      '[ERROR]   OrderServiceTest.total:41 expected: <10> but was: <12>',
      '[INFO] BUILD FAILURE',
    ].join('\n'),
  },
  {
    name: 'Maven: compilation error',
    command: 'mvn package',
    fails: true,
    output: [
      '[ERROR] COMPILATION ERROR :',
      '[ERROR] /src/main/java/com/acme/Foo.java:[10,5] cannot find symbol',
      '[ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin:3.13.0:compile',
    ].join('\n'),
  },
  {
    name: 'Gradle: green build',
    command: './gradlew build',
    fails: false,
    output: '> Task :test\n> Task :build\n\nBUILD SUCCESSFUL in 12s\n7 actionable tasks: 7 executed',
  },
  {
    name: 'Gradle: failing test',
    command: './gradlew test || true',
    fails: true,
    output: '> Task :test FAILED\n\nOrderServiceTest > total() FAILED\n\nFAILURE: Build failed with an exception.',
  },
  {
    name: 'Karma: green run',
    command: 'ng test --watch=false',
    fails: false,
    output: 'Chrome Headless 126: Executed 42 of 42 SUCCESS (0.4 secs / 0.3 secs)\nTOTAL: 42 SUCCESS',
  },
  {
    name: 'Karma: failing spec',
    command: 'ng test --watch=false | cat',
    fails: true,
    output: 'Chrome Headless 126: Executed 42 of 42 (1 FAILED) (0.4 secs / 0.3 secs)\nTOTAL: 1 FAILED, 41 SUCCESS',
  },
  {
    name: 'Angular build: type error',
    command: 'ng build',
    fails: true,
    output: 'Error: src/app/app.component.ts:12:5 - error TS2322: Type string is not assignable to type number.',
  },
  {
    name: 'Jest: green run that prints FAIL inside a test name',
    command: 'npx jest',
    fails: false,
    output: ' PASS  src/login.spec.ts\n  ✓ shows FAILED login message (3 ms)\n\nTests:       5 passed, 5 total',
  },
  {
    name: 'Jest: failing suite',
    command: 'npm test',
    fails: true,
    output: ' FAIL  src/login.spec.ts\n  ● login › rejects bad password\n\nTests:       1 failed, 4 passed, 5 total',
  },
  {
    name: 'pytest: green',
    command: 'pytest -q',
    fails: false,
    output: '.....                                                                    [100%]\n5 passed in 0.31s',
  },
  {
    name: 'pytest: failure',
    command: 'pytest',
    fails: true,
    output: 'FAILED tests/test_a.py::test_total - assert 12 == 10\n=== 1 failed, 4 passed in 0.31s ===',
  },
  {
    name: 'Application log from spring-boot:run is not a test report',
    command: 'mvn spring-boot:run',
    fails: false,
    output: 'FAILED to load optional config, using defaults\nStarted App in 3.2 seconds',
  },
]

for (const f of fixtures) {
  test(`accuracy: ${f.name}`, () => {
    expect(looksLikeTestFailure(f.command, f.output)).toBe(f.fails)
  })
}
