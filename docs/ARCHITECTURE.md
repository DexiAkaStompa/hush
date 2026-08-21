# Hush — architettura E2EE proposta

Questo repository contiene oggi un **prototipo client**, non un sistema di messaggistica E2EE pronto per utenti reali. La distinzione è intenzionale: crittografare un testo con AES-GCM è semplice; distribuire, ruotare, verificare e recuperare le chiavi senza introdurre un punto fidato è la parte difficile.

## Modello di minaccia

Hush deve proteggere il contenuto di messaggi, allegati, chiamate e condivisioni schermo anche se API, database, signaling e TURN sono osservati o compromessi. Il server può comunque vedere metadati inevitabili: account, indirizzi IP, orari, dimensioni dei pacchetti, appartenenza ai server e frequenza delle comunicazioni. Non protegge un endpoint compromesso, uno screenshot fatto da un partecipante o una persona invitata nel gruppo per errore.

## Architettura production

```text
Browser / app A ── ciphertext ──┐
                               ├── Supabase Auth + Postgres + Realtime
Browser / app B ── ciphertext ──┘          (mai plaintext)

Browser A ══ DTLS-SRTP ══ Browser B
         ╲               ╱
          ╲══ TURN ═════╱   (relay, non decifra)
```

### Identità e messaggi

- L'utente si registra con username e password. Il client normalizza l'username e lo mappa a un identificatore Auth interno sul dominio riservato `.invalid`; non viene richiesta o inviata un'email reale. Supabase Auth esegue bcrypt lato server e il profilo pubblico conserva soltanto l'username.
- Il recupero è amministrativo: una nuova password viene impostata tramite Supabase Auth Admin da un ambiente fidato. Hush non conserva un secondo hash e non scrive direttamente nello schema `auth` gestito da Supabase.
- Una chiave di identità per dispositivo, protetta dal keystore del sistema quando sarà disponibile una app desktop/mobile.
- Verifica fra amici con QR code o fingerprint, con avviso bloccante quando cambia una chiave.
- **Messaging Layer Security (MLS, RFC 9420)** per server, canali e DM di gruppo: gestisce membership, epoche, forward secrecy e post-compromise security senza inventare un protocollo proprietario.
- Supabase Postgres conserva solo envelope MLS, allegati cifrati e il minimo indispensabile di metadati. Nessuna chiave di stanza lato server.
- Allegati cifrati sul client con chiave casuale per file; upload dell'oggetto cifrato e invio della chiave dentro il messaggio MLS.

### Chiamate e schermo

- Per 2–6 amici: topologia WebRTC mesh. WebRTC usa DTLS-SRTP; un TURN self-hosted inoltra pacchetti cifrati quando il collegamento diretto non è possibile.
- Signaling via Supabase Realtime Broadcast autenticato; SDP e ICE transitano dal servizio ma i media no.
- Oltre questo limite: SFU self-hosted e ulteriore cifratura media SFrame tramite WebRTC Encoded Transform. Un SFU che termina soltanto DTLS-SRTP non offre E2EE rispetto all'SFU.
- `getDisplayMedia()` richiede HTTPS e un gesto esplicito dell'utente; il permesso non può essere conservato fra sessioni.

## Stato del prototipo

| Funzione | Oggi | Per produzione |
| --- | --- | --- |
| UI server/canali/DM | Interattiva con dati locali | Collegamento alle API e permessi completi |
| Messaggi | AES-256-GCM in memoria e ispezione ciphertext; protocollo realtime e storage ciphertext pronti | MLS verificato e identità device |
| Microfono/camera | Permessi e anteprima locale reali | Peer connection + signaling |
| Screen share | Cattura e anteprima locale reali | Traccia WebRTC verso i peer |
| Identità | Fingerprint effimero della stanza | Identità per device, QR e recovery |

Lo schema Supabase, le policy RLS e l'adapter Realtime sono ora presenti. Ogni conversazione usa un topic privato `conversation:<uuid>`; l'accesso a Broadcast e Presence viene concesso soltanto ai membri autenticati. Un trigger Postgres trasmette il record cifrato già persistito, evitando divergenze fra realtime e cronologia. Signaling e messaggi condividono il collegamento Realtime, mentre i media restano sempre fuori da Postgres.

La chiave AES del prototipo nasce in memoria a ogni caricamento. Serve a dimostrare il confine di cifratura nel client e l'uso di AAD legato al canale; **non** implementa MLS, ratchet, multi-device o recovery.

## Sequenza consigliata

1. Completare inviti, creazione spazi/conversazioni e caricamento dati tramite Supabase RLS.
2. Identità device + integrazione di una implementazione MLS mantenuta e sottoposta ad audit.
3. Collegare il signaling Realtime alle peer connection WebRTC mesh e configurare coturn self-hosted.
4. Allegati E2EE, notifiche senza preview, backup chiavi opt-in cifrato.
5. Audit indipendente, threat modeling aggiornato e test multi-browser prima dell'uso reale.

## Riferimenti

- [RFC 9420 — Messaging Layer Security](https://www.rfc-editor.org/rfc/rfc9420.html)
- [W3C — WebRTC](https://www.w3.org/TR/webrtc/)
- [W3C — WebRTC Encoded Transform](https://www.w3.org/TR/webrtc-encoded-transform/)
- [MDN — Screen Capture API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API)
