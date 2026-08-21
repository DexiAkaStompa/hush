# Musica condivisa client-only

Hush riproduce la musica senza un bridge e senza self-hosting. Supabase Realtime sincronizza soltanto i comandi; l'audio viene scaricato e riprodotto separatamente da ogni client.

```text
client A ── play / pausa / seek ── Supabase ── stato con orario server
   │                                      │
   └──── sorgente audio HTTPS             └──── client B
                                                    │
                                             sorgente audio HTTPS
```

## Funzioni implementate

- qualsiasi membro della conversazione può scegliere la sorgente, avviare, mettere in pausa, cambiare posizione o rimuovere la traccia;
- ogni modifica viene autorizzata con RLS e trasmessa sul topic privato `music:<conversation-id>`;
- la posizione deriva da un timestamp del database, così i client si riallineano senza inviare aggiornamenti ogni secondo;
- volume e mute sono locali e non modificano l'ascolto degli altri;
- il player continua a funzionare quando la chiamata viene ridotta nel dock laterale.

Per abilitarlo applica `supabase/migrations/20260821222000_client_music_sync.sql` dal SQL Editor. Non servono nuove variabili `.env`.

## Sorgenti supportate

Il campo accetta URL HTTPS diretti a contenuti riproducibili da Chromium, ad esempio MP3, AAC/M4A, Ogg/Opus, WAV oppure uno stream radio compatibile. Il server remoto deve consentire la riproduzione e, per usare il seek, supportare le richieste HTTP Range.

Una pagina web non è un flusso audio. Link a pagine YouTube, Spotify, SoundCloud e servizi con DRM non sono quindi riproducibili dal tag audio del client. In questi casi serve un'integrazione ufficiale del provider oppure un servizio che produca legalmente un flusso audio diretto.

## Perché Lavalink non viene usato

Lavalink può risolvere ricerche e restituire una traccia codificata, ma il suo player richiede lo stato vocale Discord (`token`, `endpoint`, `sessionId`, `channelId`) e invia l'audio ai server vocali Discord. Non espone il flusso decodificato ai browser Hush. Usare un nodo pubblico dal client rivelerebbe inoltre la password del nodo nel bundle senza rendere l'audio riproducibile.

Riferimento: [Lavalink REST API](https://lavalink.dev/api/rest).

## Resolver Lavalink pubblico

Hush usa il nodo SSL pubblico `lavalink.jirayu.net:443` dalla lista indicata, tramite `GET /v4/loadtracks`. La chiamata viene eseguita dal processo principale Electron (non dal renderer) e serve per cercare brani con `ytsearch:` o `spsearch:`. I risultati vengono poi riprodotti con gli embed ufficiali YouTube/Spotify; Lavalink non invia direttamente audio al browser.

Il nodo e la password sono pubblici e possono cambiare, avere limiti o essere disattivati. Puoi sostituirli impostando `HUSH_LAVALINK_HOST` e `HUSH_LAVALINK_PASSWORD` nell'ambiente di avvio Electron. Non è un canale E2EE e non va usato per aggirare DRM.

Riferimenti: [lista Lavalink SSL](https://lavalink.darrennathanael.com/SSL/Lavalink-SSL/), [API REST Lavalink](https://lavalink.dev/api/rest), [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference), [Spotify Embed API](https://developer.spotify.com/documentation/embeds/references/iframe-api).

## Bridge separato

La base del servizio è in [`services/music-bridge`](../services/music-bridge/). È un processo indipendente con autenticazione, ricerca/risoluzione Lavalink e WebSocket per i comandi della stanza. Il modulo che decodifica l’audio e pubblica un `MediaStreamTrack` WebRTC è volutamente separato: Lavalink REST non consegna direttamente audio al browser e va aggiunto come piano media del bridge.

## Privacy

Lo stato salvato contiene titolo, URL, posizione e autore dell'ultimo comando. È protetto dalle policy di accesso, ma non è cifrato end-to-end rispetto a Supabase. La sorgente audio vede l'indirizzo IP di ciascun client che la riproduce. Messaggi e flussi WebRTC conservano il loro modello di cifratura; questa funzione musicale ha un confine di privacy distinto e dichiarato nell'interfaccia.
