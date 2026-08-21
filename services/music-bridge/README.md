# Hush Music Bridge

Servizio separato per la musica condivisa di Hush. Il bridge non contiene credenziali Supabase e non tocca i messaggi E2EE.

## Stato attuale

- API autenticata per health, ricerca e risoluzione tramite Lavalink v4;
- WebSocket autenticato per stato di stanza e comandi `load`, `play`, `pause`, `seek`, `stop`;
- stato in memoria, pensato per essere sostituito con Supabase Realtime o Redis in produzione;
- il piano audio WebRTC non è ancora attivo: Lavalink REST restituisce una traccia codificata, ma non un flusso browser. Il prossimo modulo dovrà decodificare la traccia e pubblicare un `MediaStreamTrack` verso i client Hush.

## Avvio locale

```powershell
cd services/music-bridge
Copy-Item .env.example .env
npm install
# genera un secret lungo e inseriscilo in .env
npm run dev
```

Health: `http://127.0.0.1:8787/health`

Ricerca:

```powershell
curl.exe -H "Authorization: Bearer <secret>" "http://127.0.0.1:8787/v1/search?q=daft%20punk&source=youtube"
```

WebSocket: `ws://127.0.0.1:8787/v1/rooms/<conversation-id>?token=<secret>`.

## Docker

```powershell
docker build -t hush-music-bridge .
docker run --env-file .env -p 8787:8787 hush-music-bridge
```

Non esporre la porta pubblicamente senza HTTPS/WSS e un secret robusto. Il nodo Lavalink pubblico indicato è configurabile in `.env`; per produzione è preferibile un nodo sotto il proprio controllo.
