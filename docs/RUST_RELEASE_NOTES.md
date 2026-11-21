# Hush Rust per Windows

La versione Windows usa un motore desktop in Rust e mantiene l'interfaccia,
i temi e le funzioni condivise di Hush. Android, macOS e Linux continuano a
ricevere i loro pacchetti esistenti.

## Novità della 0.5.67

In **Impostazioni → Aspetto** puoi scegliere fra undici nuovi design con
anteprima, fra cui Marea, Prisma, Quota e Notturno. I design cambiano colori
e disposizione dell’interfaccia. La scelta si applica subito e resta salvata
sul dispositivo.

## Passaggio dal client attuale

1. Aggiorna Hush alla **0.5.66 o successiva** e aprilo almeno una volta.
2. Termina eventuali chiamate e chiudi Hush.
3. Installa e apri **Hush Rust Preview** da questa pagina.

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
