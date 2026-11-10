# effort-guard: istruzioni per Claude

Mod per Claude Code in JavaScript puro: nessuna dipendenza npm, nessun build. Gira nell'engine dei mod, non in Node.

## Comandi

```
claude plugin validate .        # manifest, hook registrati, contratto di $.state
claude plugin test .            # tutti i tests/*.test.ts contro l'engine
node --check hooks/<file>.mjs   # sintassi, senza engine
```

Esegui `validate` e `test` prima di ogni commit. La CI li ripete con la versione minima supportata (`MIN_CLAUDE_CODE` in `.github/workflows/ci.yml`) e con l'ultima.

## Struttura

- `hooks/module.mjs`: registra gli hook (`register(on, options)`), lo stato, i comandi, la banda e il pane.
- `hooks/detect.mjs`: quali comandi sono test/build e quale output è un fallimento. Funzioni pure.
- `hooks/rerun.mjs`: il comando ristretto che rilancia solo i test falliti (Maven, Gradle, Jest, Vitest, Angular, pytest). Funzioni pure.
- `hooks/hints.mjs`: i testi passati al modello (`/compact`, auto-correzione). Funzioni pure.
- `types/index.d.ts`: contratto di `$.state`. Ogni chiave nuova di un atom va dichiarata qui, o `validate` la rifiuta.
- `tests/`: `detect`, `rerun`, `accuracy` (fixture di output reali) e `module` (hook end-to-end con l'engine finto).

## Regole del codice

- Ogni chiamata a `$` che può mancare o fallire (`$.session.usage`, `$.session.repo`, `$.store`, `$.ui.copy`, `$.fs.write`) sta in `try/catch` e degrada a "sconosciuto": un hook che lancia viene saltato e perde il resto del lavoro.
- I comandi possono contenere segreti: salva o mostra solo l'output di `redactCommand`.
- Gli hook ignorano i sub-agent (`e.agentId`): contano solo i turni visibili all'utente.
- Gli avvisi (toast) scattano una volta per soglia superata: deriva il "già avvisato" da `$.state`, non da variabili del modulo, che un reload azzera.
- `next(e)` di `session.compact` vuole `messages` come lista non vuota: nei test passala sempre, altrimenti l'hook viene saltato in silenzio.
- Un nuovo riconoscimento di output va con un caso in `tests/accuracy.test.ts`.

## Flusso Git

- Branch da `develop` (`feat/…`, `fix/…`, `chore/…`), PR verso `develop` con titolo Conventional Commit, merge commit.
- Release: workflow `prepare-release` (o `node .github/scripts/bump-version.mjs minor`), poi PR `develop` → `main` con merge commit. Il workflow `release` crea tag e GitHub Release.
- Non modificare a mano `version` nei manifest né `CHANGELOG.md` fuori dal bump.
- CodeQL blocca gli alert high: niente `Math.random` per id, niente regex con backtracking esponenziale.
