# Contribuire

## Flusso di lavoro

1. Crea un branch dedicato da `develop` (uno per modifica, vita breve): `fix/…`, `feat/…`, `chore/…`.
2. Verifica in locale:
   ```
   claude plugin validate .
   claude plugin test .
   ```
3. Apri una PR verso `develop`. Il **titolo** deve essere un [Conventional Commit](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`…): la CI lo controlla.
4. Non modificare a mano `version` nei manifest né `CHANGELOG.md`: lo fa `prepare-release`.

La CI richiede il check `checks` (validate + test con la versione minima di Claude Code supportata). Il job `compat-latest` prova anche l'ultima versione ma non blocca il merge.

## Release

Si lavora su `develop`; si rilascia con una PR `develop` → `main` (merge commit, senza eliminare `develop`).

1. Actions → **prepare-release** → scegli patch/minor/major (o scrivi le note). Aggiorna `CHANGELOG.md`, `plugin.json` e `marketplace.json`, fa il commit su `develop` e apre la PR "Release vX.Y.Z" verso `main`. Senza note, queste vengono dai commit `feat:`/`fix:` dall'ultimo tag.
2. CI verde (`checks` e `release-version`), merge con **merge commit**.
3. **release** crea il tag `vX.Y.Z` e la GitHub Release (note dal CHANGELOG); **sync-develop** riporta `main` in `develop`.

`release-version` (workflow `release-guard`) blocca le PR verso `main` la cui versione non è nuova e maggiore dell'ultimo tag. Le versioni sono semver `MAJOR.MINOR.PATCH`.

Con il secret `RELEASE_PAT` (PAT con `contents` e `pull-requests` in scrittura) i check partono da soli sulla PR creata da `prepare-release`; senza, le PR aperte con `GITHUB_TOKEN` non fanno partire i workflow e serve il bypass della ruleset da parte di un admin.

## Struttura

- `hooks/module.mjs`: la mod (hook, comando `/effort-log`, banda sopra il prompt).
- `hooks/detect.mjs`: riconoscimento dei comandi di test e dei pattern di fallimento.
- `types/index.d.ts`: contratto dello stato (`$.state`).
- `tests/`: test eseguiti da `claude plugin test .`.
