# effort-guard

Mod per Claude Code (>= 2.1.287): banda sopra il prompt con contesto e token, segnale di escalation dopo turni "faticosi" consecutivi, registro per turno con `/effort-log`. Solo osservazione, non blocca nulla.

## Come funziona

- **Turno faticoso**: un comando Bash in errore, oppure l'output di un comando di test/build (`npm test`, `ng test`, `mvn`, `gradle`, `pytest`, `go test`, `cargo`, `dotnet`, `make`, `tsc`…) che contiene un fallimento (`FAIL`, `N failing`, `BUILD FAILURE`…) anche se l'exit code è 0. I comandi dei sub-agent non contano.
- **Escalation**: al raggiungimento della soglia di turni faticosi consecutivi compare un toast (una sola volta per serie; un turno pulito azzera la serie e lo riarma).
- **Banda**: `ctx N% | last turn N tok | struggling xN/soglia` sopra il prompt.
- **`/effort-log`**: ultimi 50 turni; il registro è salvato nello store del plugin e resta tra una sessione e l'altra.

### Impostazioni

| Opzione | Default | Descrizione |
|---|---|---|
| `threshold` | `3` | Turni faticosi consecutivi prima del toast (1–20). Si cambia dal menu `/config` del plugin. |

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

- Settings → General → Pull Requests: **Allow auto-merge** e **Automatically delete head branches**
- Settings → Actions → General → Workflow permissions: **Read and write** + **Allow GitHub Actions to create and approve pull requests** (serve a release-please)
- Settings → Rules → Rulesets: importa `protect-main.json` (richiede il check `checks`, prodotto da `ci.yml`)
- Opzionale: secret `RELEASE_PLEASE_TOKEN` (PAT o GitHub App); senza, la CI sulla PR di release viene lanciata da `release-please.yml` con `workflow_dispatch`

## Automazioni

- **CI**: validate + test su ogni PR e push su `main`, con la versione minima di Claude Code (`checks`, richiesto dal ruleset); il job `compat-latest` prova anche l'ultima versione senza bloccare.
- **Release**: [release-please](https://github.com/googleapis/release-please) legge i Conventional Commits (`feat:`, `fix:`), apre la release PR, aggiorna versione in `plugin.json` e `marketplace.json`, CHANGELOG, tag e GitHub Release al merge.
- **PR title lint**: i titoli PR devono essere Conventional Commits (squash merge → commit corretti).
- **Dependabot**: aggiorna le GitHub Actions, auto-merge solo di minor/patch se la CI passa; i major restano aperti per la revisione manuale.
