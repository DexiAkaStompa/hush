import { type FormEvent, useMemo, useState } from "react";
import { ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, UserRound } from "lucide-react";
import { BrandMark } from "./BrandMark";
import { DotPattern } from "./DotPattern";
import {
  isStrongEnoughPassword,
  isValidUsername,
  normalizeUsername,
  usernameToInternalEmail,
} from "../lib/auth-identity";
import { supabase } from "../lib/supabase";

type AuthMode = "login" | "register";

export function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validUsername = isValidUsername(username);
  const validPassword = isStrongEnoughPassword(password);
  const canSubmit = useMemo(() => {
    if (!validUsername || !validPassword || loading) return false;
    if (mode === "register") return displayName.trim().length >= 1 && password === confirmPassword;
    return true;
  }, [confirmPassword, displayName, loading, mode, password, validPassword, validUsername]);

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError(null);
    setPassword("");
    setConfirmPassword("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !canSubmit) return;
    const normalizedUsername = normalizeUsername(username);
    const internalEmail = usernameToInternalEmail(normalizedUsername);
    setLoading(true);
    setError(null);

    if (mode === "login") {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: internalEmail,
        password,
      });
      setLoading(false);
      if (authError) setError("Username o password non corretti.");
      return;
    }

    const { data, error: authError } = await supabase.auth.signUp({
      email: internalEmail,
      password,
      options: {
        data: {
          username: normalizedUsername,
          display_name: displayName.trim(),
        },
      },
    });
    setLoading(false);
    if (authError) {
      const reason = authError.message.toLowerCase();
      setError(reason.includes("already") || reason.includes("registered")
        ? "Questo username è già occupato."
        : reason.includes("password")
          ? `Password rifiutata da Supabase: ${authError.message}`
          : `Registrazione rifiutata: ${authError.message}`);
    } else if (!data.session) {
      setError("Supabase richiede ancora la conferma email. Disattiva Confirm Email nel provider Email e riprova.");
    }
  };

  return (
    <main className="auth-screen">
      <DotPattern />
      <section className="auth-story" aria-label="Hush">
        <div className="auth-brand"><span><BrandMark size={34} /></span><strong>HUSH</strong></div>
        <div className="auth-thesis">
          <span className="eyebrow">uno spazio che non legge</span>
          <h1>Parlate voi.<br /><em>Il server ascolta zero.</em></h1>
          <p>Messaggi cifrati sul dispositivo, stanze private e chiamate dirette fra amici.</p>
        </div>
        <div className="auth-proof"><KeyRound size={16} /><span><strong>Password protette con bcrypt</strong><small>Supabase Auth conserva soltanto hash con salt casuale.</small></span></div>
      </section>

      <section className="auth-panel">
        <div className="auth-form-wrap">
          <div className="auth-mode" role="tablist" aria-label="Tipo di accesso">
            <button role="tab" aria-selected={mode === "login"} onClick={() => changeMode("login")}>Accedi</button>
            <button role="tab" aria-selected={mode === "register"} onClick={() => changeMode("register")}>Crea account</button>
          </div>
          <form onSubmit={submit}>
            <span className="eyebrow">{mode === "login" ? "bentornato" : "nuovo dispositivo"}</span>
            <h2>{mode === "login" ? "Entra nel tuo spazio" : "Crea il tuo account"}</h2>
            <p>{mode === "login" ? "Usa le credenziali scelte durante la registrazione." : "Nessuna email e nessun numero di telefono richiesti."}</p>

            {mode === "register" ? (
              <>
                <label htmlFor="auth-display-name">Nome visualizzato</label>
                <div className="auth-input"><UserRound size={17} /><input id="auth-display-name" autoComplete="name" maxLength={64} required value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Mattia" /></div>
              </>
            ) : null}

            <label htmlFor="auth-username">Username</label>
            <div className="auth-input"><UserRound size={17} /><input id="auth-username" autoComplete="username" minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" required value={username} onChange={(event) => setUsername(event.target.value)} placeholder="mattia_91" /></div>
            <span className={`field-hint ${username && !validUsername ? "hint-error" : ""}`}>3–24 caratteri: lettere, numeri e underscore.</span>

            <label htmlFor="auth-password">Password</label>
            <div className="auth-input"><LockKeyhole size={17} /><input id="auth-password" type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Almeno 12 caratteri" /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Nascondi password" : "Mostra password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
            {mode === "register" ? <span className={`field-hint ${password && !validPassword ? "hint-error" : ""}`}>Usa almeno 12 caratteri e una password unica.</span> : null}

            {mode === "register" ? (
              <>
                <label htmlFor="auth-confirm-password">Conferma password</label>
                <div className="auth-input"><LockKeyhole size={17} /><input id="auth-confirm-password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Ripeti la password" /></div>
                {confirmPassword && password !== confirmPassword ? <span className="field-hint hint-error">Le password non coincidono.</span> : null}
              </>
            ) : null}

            {error ? <div className="auth-error" role="alert">{error}</div> : null}
            <button className="auth-submit" disabled={!canSubmit}>{loading ? "Attendi…" : mode === "login" ? "Accedi" : "Crea account"}<ArrowRight size={17} /></button>
            <small>La password viene inviata a Supabase Auth tramite TLS e hashata con bcrypt lato server.</small>
          </form>
        </div>
      </section>
    </main>
  );
}
