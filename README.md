# Hush

![Logo di Hush](public/favicon.svg)

Uno spazio privato per piccoli gruppi: server, canali, DM, chiamate e condivisione schermo, con la cifratura resa visibile e verificabile nell'interfaccia.

## Avvio locale

```bash
npm install
npm run dev
```

Il client si apre su `http://127.0.0.1:5173`. Senza credenziali Supabase mostra una workspace locale vuota; quando Supabase è configurato mostra registrazione e accesso tramite username/password.

La workspace non contiene server, canali, utenti o messaggi dimostrativi: dopo l'accesso legge esclusivamente profilo, spazi e conversazioni consentiti dalle policy RLS del progetto Supabase. Un database vuoto produce uno stato vuoto nell'interfaccia.

## Collegare Supabase

1. Crea un progetto Supabase nella regione più vicina al gruppo.
2. Dal pannello **Connect** copia Project URL e Publishable key dentro `.env`:

```env
VITE_SUPABASE_URL=https://project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

3. Segui la [guida completa Supabase](docs/SUPABASE_SETUP.md) ed esegui in ordine la migrazione iniziale, quella username/password e `20260821203000_functional_mvp.sql`.
4. In **Realtime Settings** disabilita `Allow public access`: Hush utilizza esclusivamente canali privati autorizzati tramite RLS.
5. In **Authentication → Providers → Email** lascia attivo il provider, abilita `Allow new users to sign up` e disabilita `Confirm Email`: gli indirizzi usati da Hush sono identificatori tecnici non recapitabili.
6. In **Authentication → Password Security** imposta la lunghezza minima a 12 caratteri e, se il piano lo consente, abilita il controllo delle password compromesse.
7. Riavvia `npm run dev`, scegli **Crea account** e registrati con username/password.

Non inserire mai `service_role`, password del database o JWT secret in una variabile `VITE_*`: tutto ciò che ha quel prefisso diventa pubblico nel bundle del browser.

## Comandi

```bash
npm run test
npm run build
```

## Licenza

Hush è distribuito con la **Hush Source-Available Reciprocity License (HSRL)
1.0**, disponibile nel file [LICENSE](LICENSE). L'uso non commerciale è
consentito. L'uso o la distribuzione commerciale, incluso offrire una versione
modificata come servizio, richiede di rendere disponibile gratuitamente il
Corresponding Source della stessa versione con la stessa licenza.

HSRL è una licenza source-available personalizzata e non una licenza Open
Source approvata da OSI. Per distribuzioni commerciali, fai verificare i
termini da un professionista legale.

## App desktop per Windows

Per avviare Hush come app Electron durante lo sviluppo:

```bash
npm run desktop:dev
```

Per creare l'installer Windows x64:

```bash
npm run desktop:build
```

L'installer viene scritto in `release/Hush-Setup-<versione>.exe`. La build desktop usa un protocollo locale `hush://`, isolamento del contesto e sandbox; link esterni, navigazioni non autorizzate e permessi media provenienti da origini diverse da Hush vengono bloccati. Su Windows la condivisione schermo apre un selettore interno per scegliere in modo esplicito una finestra o uno schermo.

Le variabili `VITE_*` vengono incorporate nel client durante la compilazione: configura `.env` prima di creare l'installer e usa esclusivamente la Project URL e la Publishable key di Supabase. L'installer locale non è firmato digitalmente, quindi Windows SmartScreen può mostrare un avviso; per distribuirlo agli amici senza quell'avviso servirà un certificato di code signing.

L'interfaccia usa pattern adattati dalle raccolte indicate nel brief: messaging/sidebar e controlli accessibili da Untitled UI; dot pattern e animated list da Magic UI; encrypted text e glow mirato da Aceternity UI. Il codice è locale e non carica immagini, font o analytics di terze parti.

Supabase Auth gestisce sessioni e password: ogni username viene tradotto localmente in un identificatore tecnico `username@users.hush.invalid`, mai mostrato all'utente. Supabase conserva soltanto il relativo hash bcrypt con salt casuale. Postgres conserva ciphertext e metadati minimi; Realtime Broadcast distribuisce i nuovi record su topic granulari per conversazione.

Senza email o telefono non esiste recupero automatico. L'amministratore può assegnare una nuova password tramite Supabase Auth Admin (`auth.admin.updateUserById`), eseguito esclusivamente da un ambiente server con Secret key. Non salvare password o hash alternativi nelle tabelle `public` e non modificare direttamente `auth.users`.

Leggi [l'architettura E2EE](docs/ARCHITECTURE.md) prima di collegare utenti reali. Il [player musicale client-only](docs/MUSIC_BRIDGE.md) sincronizza comandi e posizione tramite Supabase senza richiedere un server audio; supporta sorgenti HTTPS dirette, mentre un nodo Lavalink pubblico non può essere usato come flusso browser.
