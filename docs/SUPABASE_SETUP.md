# Configurazione Supabase per Hush

Questa procedura abilita i flussi reali dell'app: server, canali, gruppi DM, inviti, messaggi E2EE, Presence e signaling WebRTC. Non richiede `service_role`, password del database o Secret key nel client.

## 1. Controlla le variabili locali

Nel file `.env` devono esserci soltanto:

```env
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Le variabili `VITE_*` finiscono nel bundle. La Publishable key è progettata per essere pubblica; non inserire mai `sb_secret_*`, `service_role`, JWT secret o password del database.

## 2. Applica le migrazioni

Nel Dashboard Supabase apri **SQL Editor → New query**. Se non le hai già eseguite, applica questi file nell'ordine:

1. `supabase/migrations/20260821143000_initial.sql`
2. `supabase/migrations/20260821170000_username_password_auth.sql`
3. `supabase/migrations/20260821203000_functional_mvp.sql`
4. `supabase/migrations/20260821210000_profile_repair.sql`
5. `supabase/migrations/20260821220000_voice_channels_and_call_topics.sql`
6. `supabase/migrations/20260821221000_invite_pgcrypto_schema_fix.sql`
7. `supabase/migrations/20260821222000_client_music_sync.sql`
8. `supabase/migrations/20260821223000_key_envelope_rpc_fix.sql`

La quarta migrazione ripara automaticamente anche gli account creati prima dell'attivazione del trigger profilo. È importante applicarla se compare `PGRST116` con “The result contains 0 rows”. La quinta aggiunge i canali vocali e separa il topic Realtime delle chiamate da quello dei messaggi; risolve l'errore `cannot add presence callbacks ... after subscribe()`. La sesta corregge la risoluzione delle funzioni `pgcrypto` usate per creare e verificare gli inviti. La settima abilita il player musicale distribuito e il topic privato `music:<uuid>`. L'ottava sposta la scrittura delle buste E2EE in una RPC verificata, correggendo `new row violates row-level security policy for table conversation_key_envelopes`.

Per ogni file:

1. Aprilo nel progetto.
2. Copia tutto il contenuto nel SQL Editor.
3. Premi **Run** una sola volta.
4. Attendi `Success. No rows returned` prima di passare al successivo.

La terza migrazione è ri-eseguibile per gran parte degli oggetti, ma non usarla come pulsante di riparazione: se Supabase mostra un errore, copia l'errore completo prima di modificare SQL o tabelle a mano.

## 3. Configura Auth senza email reali

Apri **Authentication → Sign In / Providers → Email** e imposta:

- Email provider: attivo
- Allow new users to sign up: attivo
- Confirm Email: disattivato

Hush converte lo username in un identificatore tecnico `username@users.hush.invalid`, quindi nessuna casella può ricevere una conferma. Con **Confirm Email** attivo Supabase crea un utente non confermato ma non restituisce una sessione.

In **Authentication → Password Security** imposta una lunghezza minima non superiore a quella richiesta dall'app (12 caratteri), oppure aggiorna anche il controllo client se scegli una regola più severa.

## 4. Rendi Realtime esclusivamente privato

Apri **Realtime → Settings** (in alcune versioni del Dashboard: **Project Settings → Realtime Settings**) e disattiva **Allow public access**.

Hush apre solo topic privati `conversation:<uuid>`, `call:<uuid>` e `music:<uuid>`. Le policy sulla tabella `realtime.messages` consentono Broadcast e Presence soltanto ai membri della conversazione.

## 5. Verifica che il database sia pronto

Esegui questa query nel SQL Editor:

```sql
select
  to_regclass('public.space_invites') is not null as invites_ready,
  to_regclass('public.conversation_key_envelopes') is not null as key_envelopes_ready,
  to_regclass('public.conversation_key_requests') is not null as key_requests_ready,
  to_regclass('public.conversation_music_state') is not null as music_ready;

select proname
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'create_space_with_general',
    'create_space_channel',
    'create_space_voice_channel',
    'create_group_dm',
    'create_space_invite',
    'join_space_with_invite',
    'leave_space',
    'delete_space_channel',
    'delete_owned_space',
    'set_conversation_music_state',
    'store_conversation_key_envelopes'
  )
order by proname;
```

La prima query deve restituire quattro valori `true`; la seconda deve restituire undici righe.

## 6. Primo test con due account

1. Installa la nuova build su due PC o usa due profili Windows/browser separati.
2. Registra due account e accedi almeno una volta con entrambi: in questo modo ogni dispositivo pubblica la propria chiave ECDH.
3. Dal primo account crea un server; il canale `generale` viene creato automaticamente.
4. Apri il menu del server e premi **Copia invito**.
5. Dal secondo account premi `+` nella barra server, scegli **Usa invito** e incolla il link.
6. Lascia aperto `generale` sul primo account per alcuni secondi: il primo dispositivo autorizza il secondo distribuendogli una busta cifrata.
7. Invia un messaggio da entrambi i dispositivi.
8. Crea o apri un canale nella sezione **canali vocali**, quindi entra da entrambi i dispositivi. Camera, microfono e schermo richiedono il consenso di Windows.
9. Nella chiamata apri **Musica condivisa**, incolla un URL HTTPS diretto a un file MP3/AAC/Ogg o a una radio e verifica che play, pausa e seek cambino anche sul secondo dispositivo. Il volume “solo per me” deve invece restare indipendente.

## Limiti di rete delle chiamate

La build usa una mesh WebRTC e server STUN pubblici: è la strada con meno latenza quando i peer possono collegarsi direttamente. Reti aziendali, CGNAT o firewall rigidi possono richiedere un server TURN. Non inserire credenziali TURN permanenti in `VITE_*`; per produzione conviene usare `coturn` sul tuo server e un piccolo endpoint autenticato che emetta credenziali temporanee.

Riferimenti ufficiali: [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization), [configurazione Auth](https://supabase.com/docs/guides/auth/general-configuration), [password Auth](https://supabase.com/docs/guides/auth/passwords).
