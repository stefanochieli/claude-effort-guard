# Sicurezza

effort-guard è una mod di sola osservazione: legge l'uso di contesto e token e l'esito dei comandi Bash, e non invia dati all'esterno. Salva in locale, nello store del plugin, un log per turno (data, contesto, token, esito, id breve di sessione; massimo 500 turni per sessione e 20 sessioni) senza comandi né output; i comandi mostrati nei toast sono abbreviati e privati di token e password. Dettagli nel README, sezione «Dati salvati e privacy».

Per segnalare una vulnerabilità usa **Security → Report a vulnerability** su questo repository (advisory privato). Non aprire una issue pubblica con i dettagli.
