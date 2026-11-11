# Changelog

## [0.7.0] — 2026-11-11

### Novità

- comando ristretto per rilanciare solo i test falliti (Maven, Gradle, Jest, Vitest, Angular, pytest), con toast e `/effort-rerun`
- suggerimenti per `/compact`: comando fallito, rerun e file toccati (opzione `compactHints`)
- auto-correzione opzionale nel prompt (opzione `selfCorrect`, spenta di default)
- costo di sessione e limite di rate nella banda, con toast oltre la soglia `rateLimitThreshold`
- nuove cause di escalation: `persistent_failure` e `read_loop`
- log per progetto, `/effort-export` (CSV o JSON) e `/effort-pane`

## [0.6.0] — 2026-11-10

### Novità

- more failure signals, ignore app-run goals, accuracy fixtures

### Correzioni

- recognise bash -lc and wrapper value flags, redact quoted secrets and API-key headers

## [0.5.0] — 2026-11-10

### Novita'

- `/effort-reset` cancella il log e azzera la serie
- `Write`, `MultiEdit` e `NotebookEdit` falliti contano come `edit_error`
- il toast di escalation riporta la causa
- segnali Maven/Gradle: `There are test failures`, `COMPILATION ERROR`, `> Task :x FAILED`; niente falso positivo con `Failures: 0, Errors: 0`

### Correzioni

- per-session log, re-arm-safe context toast, redacted commands
- recognise more commands and runner output, fewer false positives

### Altro

- docs: describe what is stored, detection limits and the context toast
- ci: align action versions, add non-blocking macOS and Windows job
- docs: describe global install, VS Code on another PC and cloud sessions
- ci: replace release-please with prepare-release, release and release-guard
- ci: align repo automation with the shared template
- ci: rename the release workflow to Auto release
- ci: auto-merge the release PR when RELEASE_PLEASE_TOKEN is set

## [0.4.0](https://github.com/stefanochieli/claude-effort-guard/compare/v0.3.1...v0.4.0) (2026-10-14)


### Features

* more struggle signals, context warning, fewer false positives and /effort-summary ([65da8a2](https://github.com/stefanochieli/claude-effort-guard/commit/65da8a2b8971838d85c6bcc5d847170242667ab7))
* more struggle signals, context warning, fewer false positives and /effort-summary ([a2507d8](https://github.com/stefanochieli/claude-effort-guard/commit/a2507d8a4b93f5d0ffbd5a9bd158134bfe1e1555))
* more struggle signals, context warning, fewer false positives and /effort-summary ([0c56eb8](https://github.com/stefanochieli/claude-effort-guard/commit/0c56eb868b3b96701ab1a75f0225df5d77abaf1e))

## [0.3.1](https://github.com/stefanochieli/claude-effort-guard/compare/v0.3.0...v0.3.1) (2026-10-06)


### Bug Fixes

* dispatch release-PR CI only when release-please created or updated a PR ([#13](https://github.com/stefanochieli/claude-effort-guard/issues/13)) ([704984c](https://github.com/stefanochieli/claude-effort-guard/commit/704984cfe9183a200989b57a338d1f1d402bee3e))

## [0.3.0](https://github.com/stefanochieli/claude-effort-guard/compare/effort-guard-v0.2.0...effort-guard-v0.3.0) (2026-10-04)


### Features

* configurable threshold, persistent log and fewer false positives ([#10](https://github.com/stefanochieli/claude-effort-guard/issues/10)) ([28b19a6](https://github.com/stefanochieli/claude-effort-guard/commit/28b19a62b57c9f062f36f220bc864e76d15e54f5))

## [0.2.0](https://github.com/stefanochieli/claude-effort-guard/compare/effort-guard-v0.1.1...effort-guard-v0.2.0) (2026-10-02)


### Features

* implement effort-guard mod (context band, struggle toast, /effort-log) ([fcf98fe](https://github.com/stefanochieli/claude-effort-guard/commit/fcf98fea2b24c1d1483cff947b3d40cc031bfa4c))


### Bug Fixes

* toast once per struggling streak and cover it in the smoke test ([e82f628](https://github.com/stefanochieli/claude-effort-guard/commit/e82f628f1c87205e648f0f425003b7d96a401d53))

## [0.1.1](https://github.com/stefanochieli/claude-effort-guard/compare/effort-guard-v0.1.0...effort-guard-v0.1.1) (2026-10-02)


### Bug Fixes

* make plugin validate/test pass and restrict dependabot auto-merge to minor/patch ([efe0bbb](https://github.com/stefanochieli/claude-effort-guard/commit/efe0bbb7fce7680bf76a2c6432553ff82e45db5a))
* make plugin validate/test pass and restrict Dependabot auto-merge to minor/patch ([79ab9cd](https://github.com/stefanochieli/claude-effort-guard/commit/79ab9cd4de43dcf118c7df8765134936cb573d5a))
