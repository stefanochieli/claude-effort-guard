# effort-guard

Mod per Claude Code (>= 2.1.287): banda sopra il prompt con contesto e token, segnale di escalation dopo turni "faticosi" consecutivi, registro per turno con `/effort-log`. Solo osservazione, non blocca nulla.

## Come funziona

- **Turno faticoso**: un comando Bash in errore, oppure l'output di un comando di test/build (`npm test`, `ng test`, `mvn`, `gradle`, `pytest`, `go test`, `cargo`, `dotnet`, `make`, `tsc`…) che contiene un fallimento (`FAIL`, `N failing`, `BUILD FAILURE`…) anche se l'exit code è 0. I comandi dei sub-agent non contano.
- **Escalation**: al raggiungimento della soglia di turni faticosi consecutivi compare un toast (una sola volta per serie; un turno pulito azzera la serie e lo riarma).
- **Banda**: `ctx N% | last turn N tok | struggling xN/soglia` sopra il prompt.
- **`/effort-log`**: ultimi 50 turni; il registro è salvato nello store del plugin e resta tra una sessione e l'altra. **`/effort-summary`**: riepilogo in una riga (turni, turni faticosi, motivo più frequente, picco di contesto).
- **Altri segnali**: un `Edit` fallito e lo stesso comando che fallisce due volte nello stesso turno (`repeated_error`) contano come fatica; il toast riporta l'ultimo comando fallito.
- **Falsi positivi ridotti**: `0 failed` / `Failures: 0` non contano e si guarda solo la coda dell'output. Riconosciuti anche Surefire, Karma, Playwright, Cypress e nx.

### Impostazioni

| Opzione | Default | Descrizione |
|---|---|---|
| `threshold` | `3` | Turni faticosi consecutivi prima del toast (1–20). Si cambia dal menu `/config` del plugin. |
| `contextThreshold` | `80` | Toast una tantum quando il contesto raggiunge questa percentuale; `0` lo disattiva. |

## Installazione

```
/plugin marketplace add stefanochieli/claude-effort-guard
/plugin install effort-guard@effort-guard
/reload-plugins
```

## Sviluppo

```
claude --plugin-dir .
claude plugin validate .
claude plugin test .
```

Struttura: `.claude-plugin/` (manifest + marketplace), `hooks/` (modulo), `types/` (stato), `tests/`. Flusso di lavoro e release: vedi [CONTRIBUTING.md](CONTRIBUTING.md).

## Impostazioni repo da attivare una volta

- Settings → General → Pull Requests: solo **merge commit** (disattiva squash e rebase); non attivare "Automatically delete head branches" (`develop` non va eliminato)
- Settings → Actions → General → Workflow permissions: **Read and write** + **Allow GitHub Actions to create and approve pull requests** (serve a prepare-release)
- Settings → Rules → Rulesets: importa `protect-main.json` (richiede i check `checks`, da `ci.yml`, e `release-version`, da `release-guard.yml`; solo merge commit)
- Secret `RELEASE_PAT` (PAT con `contents` e `pull-requests` in scrittura): fa partire i check sulla PR di release; senza, serve il bypass della ruleset

## Automazioni

- **CI**: validate + test su ogni PR e push su `main`, con la versione minima di Claude Code (`checks`, richiesto dal ruleset); il job `compat-latest` prova anche l'ultima versione senza bloccare.
- **Release**: `prepare-release` (manuale) aggiorna CHANGELOG, `plugin.json` e `marketplace.json` su `develop` e apre la PR verso `main`; `release-guard` ne controlla la versione; `release` crea tag e GitHub Release al merge; `sync-develop` riporta `main` in `develop`.
- **PR title lint**: i titoli PR devono essere Conventional Commits (le note di release partono dai commit `feat:`/`fix:`).
- **Dependabot**: aggiorna le GitHub Actions, auto-merge solo di minor/patch se la CI passa; i major restano aperti per la revisione manuale.
