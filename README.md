# effort-guard

Mod per Claude Code (>= 2.1.287): banda sopra il prompt con contesto, costo, rate limit e token, segnale di escalation dopo turni "faticosi" consecutivi, comando ristretto per rilanciare solo i test falliti, suggerimenti a `/compact`, registro per turno con `/effort-log` e un pane laterale. Non blocca nulla.

## Come funziona

- **Turno faticoso**: un comando Bash in errore (secondo Claude Code: ad esempio un `grep` senza risultati, exit code 1, non è un errore), oppure l'output di un comando di test/build (`npm test`, `pnpm --filter api test`, `ng test`, `mvn`/`mvnw`/`mvnd`, `gradle`, `pytest`, `go test`, `cargo`, `dotnet`, `make`, `tsc`, anche con percorsi, `.cmd`/`.bat` e dentro `bash -c`) che contiene un fallimento (`FAIL` a inizio riga, `N failing`, `N failed`, `BUILD FAILURE`…) anche se l'exit code è 0, per esempio con `| tee` o `|| true`. I comandi dei sub-agent non contano.
- **Escalation**: al raggiungimento della soglia di turni faticosi consecutivi compare un toast (una sola volta per serie; un turno pulito azzera la serie e lo riarma).
- **Banda**: `ctx N% | $C | limit N% | last turn N tok | struggling xN/soglia` sopra il prompt. `$C` è il costo della sessione come lo calcola `/cost`; `limit` è la finestra di rate limit più piena (5 ore, 7 giorni) dell'ultima risposta; entrambi compaiono solo se Claude Code li fornisce. `tok` è la somma di input, output e token di cache letti e creati dell'ultimo turno: è dominata dal contesto riletto dalla cache, non dal lavoro del solo turno.
- **`/effort-log`**: ultimi 50 turni (`s=` è la sessione che li ha scritti); il registro è nello store del plugin, una chiave per sessione, e resta tra una sessione e l'altra (ultime 20 sessioni, 500 turni ciascuna). Mostra i turni del progetto corrente (nome del repository, o della cartella); `/effort-log all` mostra tutti i progetti. **`/effort-summary`** (anche `all`): riepilogo in una riga (turni, turni faticosi, motivo più frequente, picco di contesto). **`/effort-export`**: copia il registro in CSV (`json` per JSON); con un percorso lo scrive su file, ad esempio `/effort-export effort.csv`. **`/effort-pane`**: pane laterale con gli ultimi 30 turni, barra del contesto, costo, cause più frequenti e comando di rilancio. **`/effort-reset`**: cancella il registro e azzera la serie.
- **Altri segnali**: un `Edit`/`MultiEdit`/`Write` fallito (`edit_error`), lo stesso comando che fallisce due volte nello stesso turno (`repeated_error`), lo stesso comando che fallisce in turni consecutivi (`persistent_failure`) e lo stesso file letto 3 volte in un turno senza modificarlo nel frattempo (`read_loop`) contano come fatica; il toast riporta la causa (`reason`) e l'ultimo comando fallito, abbreviato a 60 caratteri e con token, password e credenziali negli URL oscurati.
- **Falsi positivi ridotti**: `0 failed` / `Failures: 0` non contano; si guardano solo le ultime 4000 battute dell'output, senza codici colore; le parole `FAIL`/`FAILED` e i simboli ✗ ✖ ✘ contano solo a inizio riga (un test verde chiamato "handles FAILED login" non è un fallimento). Il riconoscimento del testo è coperto da test per Surefire, Karma, Playwright, Cypress, nx, dotnet, pytest, vitest, tsc e cargo, ma è euristico: non c'è un benchmark di accuratezza.

- **Rilancio mirato**: quando un test fallisce, effort-guard legge l'output e propone il comando che rilancia solo i test falliti, in un toast (una volta per proposta) e con `/effort-rerun`, che lo copia negli appunti. Maven/Surefire/Failsafe (`./mvnw -pl api test -Dtest=FooTest#bar`, conserva `-pl`, `-q`, `-B`, `-P…`), Gradle (`--tests`), Jest, Vitest, `ng test --include`, script npm/pnpm/yarn, pytest.
- **`/compact` più utile** (`compactHints`, attivo di default): alla compattazione aggiunge alle istruzioni del riassunto il comando che stava fallendo, il rilancio mirato e gli ultimi file modificati, così il riassunto non li perde.
- **Auto-correzione** (`selfCorrect`, spento di default): quando la serie raggiunge la soglia aggiunge al system prompt una breve sezione che chiede al modello di cambiare approccio (rileggere i file, spiegare la causa, rilanciare solo il test fallito). Sparisce al primo turno pulito.

### Impostazioni

| Opzione | Default | Descrizione |
|---|---|---|
| `threshold` | `3` | Turni faticosi consecutivi prima del toast (1–20; Claude Code rifiuta valori fuori intervallo). Si cambia dal menu `/config` del plugin. |
| `contextThreshold` | `80` | Toast quando il contesto raggiunge questa percentuale; ricompare solo dopo un calo sotto soglia (per esempio dopo `/compact`), non dopo una lettura mancata. `0` lo disattiva. |
| `rateLimitThreshold` | `80` | Toast quando una finestra di rate limit raggiunge questa percentuale; stessa logica del contesto. `0` lo disattiva. |
| `compactHints` | `true` | Suggerimenti al riassunto di `/compact` (vedi sopra). |
| `selfCorrect` | `false` | Sezione di auto-correzione nel system prompt durante una serie (vedi sopra). |

### Dati salvati e privacy

- **Log persistente** (store del plugin, gestito da Claude Code): per ogni turno data, percentuale di contesto, token, costo della sessione, se faticoso, motivo, serie, id breve della sessione e nome del progetto. Mai comandi, output, prompt o percorsi.
- **Stato di sessione** (non persistente): l'ultimo comando fallito e il rilancio mirato, oscurati (token, password e credenziali negli URL) e abbreviati; i percorsi degli ultimi 10 file modificati, per `/compact`.
- **Verso il modello**: con `compactHints` il riassunto di `/compact` riceve comando, rilancio e percorsi; con `selfCorrect` il system prompt riceve comando e rilancio. Sono dati che il modello ha già visto nella conversazione.
- **Toast**: lo stesso comando, abbreviato a 60 caratteri, solo a schermo.
- **Rete**: nessuna. `/effort-export` scrive un file solo dove indichi tu. Il log si cancella con `/effort-reset`.

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
