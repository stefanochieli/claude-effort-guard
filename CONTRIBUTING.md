# Contribuire

## Flusso di lavoro

1. Crea un branch dedicato da `main` (uno per modifica, vita breve): `fix/…`, `feat/…`, `chore/…`.
2. Verifica in locale:
   ```
   claude plugin validate .
   claude plugin test .
   ```
3. Apri una PR verso `main`. Il **titolo** deve essere un [Conventional Commit](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`…): la CI lo controlla.
4. Usa il **merge squash**: il titolo della PR diventa il commit su `main` e da lì release-please ricava versione e CHANGELOG. Non modificare a mano `version` nei manifest né `CHANGELOG.md`.

La CI richiede il check `checks` (validate + test con la versione minima di Claude Code supportata). Il job `compat-latest` prova anche l'ultima versione ma non blocca il merge.

## Release

release-please apre da solo la PR di release dopo ogni merge su `main`. Le versioni sono semver classiche `MAJOR.MINOR.PATCH` (`fix:` → patch, `feat:` → minor, `feat!:` o `BREAKING CHANGE` → major) e i tag/release si chiamano `vX.Y.Z`. Poiché la PR è aperta con `GITHUB_TOKEN`, GitHub non fa partire i workflow `pull_request` (restano `action_required`): per questo `release-please.yml` lancia la CI sul branch di release con `workflow_dispatch`, così il check richiesto `checks` compare sulla PR e la si può unire (squash) appena è verde.

In alternativa, con il secret `RELEASE_PLEASE_TOKEN` (PAT o token di GitHub App con permessi `contents` e `pull-requests` in scrittura) i workflow della PR partono da soli come per ogni altra PR.

## Struttura

- `hooks/module.mjs`: la mod (hook, comando `/effort-log`, banda sopra il prompt).
- `hooks/detect.mjs`: riconoscimento dei comandi di test e dei pattern di fallimento.
- `types/index.d.ts`: contratto dello stato (`$.state`).
- `tests/`: test eseguiti da `claude plugin test .`.
