# Hush Rust per Windows

La versione Windows usa un motore desktop in Rust e mantiene l'interfaccia,
i temi e le funzioni condivise di Hush. Android, macOS e Linux continuano a
ricevere i loro pacchetti esistenti.

Rust è il download principale di [hush.contact](https://hush.contact/) su
Windows x64. Per una nuova installazione puoi scaricare direttamente Hush Rust.

## Novità della 0.5.70

**Linea** è disponibile in **Impostazioni → Aspetto**. Su desktop include una
colonna canali ridimensionabile, comandi di navigazione nella barra superiore,
ricerca nella testata e un pannello membri richiudibile. Nelle chat in chiamata,
la voce e il video restano sopra la cronologia. La pagina Ruoli a schermo intero
include ricerca, conteggio dei membri e accesso ai permessi predefiniti.

## Passaggio dal client attuale

1. Lascia che il client precedente si aggiorni alla **0.5.69 o successiva** e apri Hush con il tuo account.
2. Il client scarica e verifica Hush Rust automaticamente in background.
3. Premi **Installa e apri Hush Rust** quando compare l’avviso. Puoi anche aprire **Impostazioni → Aggiornamenti**.

Il trasferimento recupera automaticamente accesso, preferenze, suoni
personalizzati e accesso alla cronologia cifrata. Il profilo originale resta
conservato. Se il trasferimento si interrompe, Hush propone di riprovarlo
prima di aprire le chat. Non serve copiare cartelle o esportare chiavi private.

## Cosa cambia

- Meno codice da caricare prima dell'accesso; le parti delle chat vengono
  caricate quando servono e alcune operazioni iniziali procedono in parallelo.
- Budget della memoria ridotto quando la finestra è inattiva, senza
  sospendere messaggi e connessioni. Le chiamate mantengono il budget normale.
- Download degli allegati a blocchi, senza accumulare tutto il file in RAM.
- Aggiornamenti Rust automatici con verifica della firma e della versione.
- Accesso ai vecchi allegati Drive tramite il servizio condiviso autenticato.

Nella prova controllata con finestra minimizzata, la memoria privata residente
è passata da circa **153 a 35 MiB**. È una misura della gestione della memoria
in background con una build di prova, non una promessa sui consumi di tutte
le schermate. Il primo confronto in primo piano non ha mostrato un vantaggio
significativo di RAM; nemmeno il tempo totale di avvio ha ancora un miglioramento
misurato con sufficiente affidabilità.

Chiamate, video, condivisione schermo con audio di sistema, riconnessione tramite
TURN, cronologia cifrata e trasferimento dei dati sono stati provati tra il
client Rust e quello esistente. Per condividere lo schermo viene usato il
selettore di Windows; abilita l'audio di sistema nel selettore quando serve.

Questa distribuzione è separata dal client precedente per conservare il
profilo originale durante il passaggio. Non è una build Rust per macOS o Linux.
