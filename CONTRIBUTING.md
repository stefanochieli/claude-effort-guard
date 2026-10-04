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

release-please apre da solo la PR di release dopo ogni merge su `main`. Se i workflow di quella PR risultano `action_required`, approvali dalla PR, oppure imposta il secret `RELEASE_PLEASE_TOKEN` (PAT o token di GitHub App con permessi `contents` e `pull-requests` in scrittura) così la CI parte da sola.

## Struttura

- `hooks/module.mjs`: la mod (hook, comando `/effort-log`, banda sopra il prompt).
- `hooks/detect.mjs`: riconoscimento dei comandi di test e dei pattern di fallimento.
- `types/index.d.ts`: contratto dello stato (`$.state`).
- `tests/`: test eseguiti da `claude plugin test .`.
