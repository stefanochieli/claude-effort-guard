# effort-guard

Mod per Claude Code (>= 2.1.287): banda sopra il prompt con contesto e token, segnale di escalation dopo turni "faticosi" consecutivi, registro per turno con `/effort-log`. Solo osservazione, non blocca nulla.

## Come funziona

- **Turno faticoso**: un comando Bash in errore (secondo Claude Code: ad esempio un `grep` senza risultati, exit code 1, non è un errore), oppure l'output di un comando di test/build (`npm test`, `pnpm --filter api test`, `ng test`, `mvn`/`mvnw`/`mvnd`, `gradle`, `pytest`, `go test`, `cargo`, `dotnet`, `make`, `tsc`, anche con percorsi, `.cmd`/`.bat` e dentro `bash -c`) che contiene un fallimento (`FAIL` a inizio riga, `N failing`, `N failed`, `BUILD FAILURE`…) anche se l'exit code è 0, per esempio con `| tee` o `|| true`. I comandi dei sub-agent non contano.
- **Escalation**: al raggiungimento della soglia di turni faticosi consecutivi compare un toast (una sola volta per serie; un turno pulito azzera la serie e lo riarma).
- **Banda**: `ctx N% | last turn N tok | struggling xN/soglia` sopra il prompt. `tok` è la somma di input, output e token di cache letti e creati dell'ultimo turno: è dominata dal contesto riletto dalla cache, non dal lavoro del solo turno.
- **`/effort-log`**: ultimi 50 turni (`s=` è la sessione che li ha scritti); il registro è nello store del plugin, una chiave per sessione, e resta tra una sessione e l'altra (ultime 20 sessioni, 500 turni ciascuna). Mostra i turni di tutte le sessioni e di tutti i progetti. **`/effort-summary`**: riepilogo in una riga (turni, turni faticosi, motivo più frequente, picco di contesto). **`/effort-reset`**: cancella il registro e azzera la serie.
- **Altri segnali**: un `Edit`/`MultiEdit`/`Write` fallito e lo stesso comando che fallisce due volte nello stesso turno (`repeated_error`) contano come fatica; il toast riporta la causa (`reason`) e l'ultimo comando fallito, abbreviato a 60 caratteri e con token, password e credenziali negli URL oscurati.
- **Falsi positivi ridotti**: `0 failed` / `Failures: 0` non contano; si guardano solo le ultime 4000 battute dell'output, senza codici colore; le parole `FAIL`/`FAILED` e i simboli ✗ ✖ ✘ contano solo a inizio riga (un test verde chiamato "handles FAILED login" non è un fallimento). Il riconoscimento del testo è coperto da test per Surefire, Karma, Playwright, Cypress, nx, dotnet, pytest, vitest, tsc e cargo, ma è euristico: non c'è un benchmark di accuratezza.

### Impostazioni

| Opzione | Default | Descrizione |
|---|---|---|
| `threshold` | `3` | Turni faticosi consecutivi prima del toast (1–20; Claude Code rifiuta valori fuori intervallo). Si cambia dal menu `/config` del plugin. |
| `contextThreshold` | `80` | Toast quando il contesto raggiunge questa percentuale; ricompare solo dopo un calo sotto soglia (per esempio dopo `/compact`), non dopo una lettura mancata. `0` lo disattiva. |

### Dati salvati e privacy

- **Log persistente** (store del plugin, gestito da Claude Code): per ogni turno data, percentuale di contesto, token, se faticoso, motivo, serie e id breve della sessione. Mai comandi, output, prompt o percorsi.
- **Stato di sessione**: l'ultimo comando fallito, oscurato (token, password e credenziali negli URL) e abbreviato a 120 caratteri.
- **Toast**: lo stesso comando, abbreviato a 60 caratteri, solo a schermo.
- **Rete**: nessuna. Il log si cancella con `/effort-reset`.

## Installazione

```
/plugin marketplace add stefanochieli/claude-effort-guard
/plugin install effort-guard@effort-guard
/reload-plugins
```

### Installazione globale (tutti i progetti)

Dal terminale, in qualsiasi cartella, scegli lo scope **user** quando richiesto, oppure:

```
claude plugin marketplace add stefanochieli/claude-effort-guard
claude plugin install effort-guard@effort-guard --scope user
```

Equivale a questo in `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "effort-guard": { "source": { "source": "github", "repo": "stefanochieli/claude-effort-guard" } }
  },
  "enabledPlugins": { "effort-guard@effort-guard": true }
}
```

L'installazione è per macchina: su un altro PC va ripetuta.

### Estensione VS Code su un altro PC

L'estensione Claude Code usa lo stesso `~/.claude/settings.json` del CLI. Sul nuovo PC: installa l'estensione (o il CLI), apri il terminale integrato o il prompt dell'estensione ed esegui i comandi sopra (oppure `/plugin`), poi `/reload-plugins`. In alternativa copia le due chiavi del JSON nel `~/.claude/settings.json` di quel PC. Serve Claude Code >= 2.1.287 e lo stesso account.

### Sessioni cloud (Claude Code sul web)

Il container cloud non ha le impostazioni utente del tuo PC. Per attivare il plugin in un repo, aggiungi le stesse due chiavi (`extraKnownMarketplaces`, `enabledPlugins`) al file `.claude/settings.json` **del repo**, committato. Il plugin è pensato per l'interfaccia locale (banda e toast): in cloud potrebbe non mostrare la banda, ma l'hook di registrazione dovrebbe comunque girare.

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
