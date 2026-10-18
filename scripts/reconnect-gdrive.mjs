import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

// Re-authorize the existing owner connection without changing its Drive folder.
const configPath = path.resolve("gdrive-config.json");
const project = process.argv[process.argv.indexOf("--project-ref") + 1];
if (!process.argv.includes("--project-ref") || !/^\w{20}$/.test(project ?? ""))
  throw Error("Specifica --project-ref con il progetto Supabase di Hush.");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
for (const key of [
  "GDRIVE_CLIENT_ID",
  "GDRIVE_CLIENT_SECRET",
  "GDRIVE_REFRESH_TOKEN",
  "GDRIVE_FOLDER_ID",
])
  if (
    typeof config[key] !== "string" ||
    !config[key] ||
    /[\r\n]/.test(config[key])
  )
    throw Error("Configurazione Drive esistente non valida.");
const port = 8989,
  redirect = `http://127.0.0.1:${port}/oauth2callback`;
const state = randomBytes(32).toString("base64url"),
  verifier = randomBytes(48).toString("base64url");
const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
auth.search = new URLSearchParams({
  client_id: config.GDRIVE_CLIENT_ID,
  redirect_uri: redirect,
  response_type: "code",
  scope: "https://www.googleapis.com/auth/drive.file",
  access_type: "offline",
  prompt: "consent",
  state,
  code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  code_challenge_method: "S256",
}).toString();
const consoleUrl =
  "https://console.cloud.google.com/auth/audience?project=" +
  encodeURIComponent(config.GDRIVE_CLIENT_ID.split("-")[0]);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const page = (content) =>
  `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ricollega Google Drive · Hush</title><style>body{margin:0;background:#151719;color:#eee;font:15px/1.6 system-ui;display:grid;place-items:center;min-height:100vh}main{width:min(540px,calc(100% - 64px));padding:28px;background:#202225;border:1px solid #3b3e42;border-radius:12px}h1{font-size:25px;letter-spacing:-.03em}a{color:#eee}a.action{display:block;padding:12px 16px;border:1px solid #646970;border-radius:6px;text-decoration:none;margin-top:20px;background:#34373c}p,li{color:#b9bec7}small{color:#969da8}</style><main>${content}</main></html>`;
async function deploy(next) {
  const envPath = path.resolve(".env.drive-renew.local");
  try {
    fs.writeFileSync(
      envPath,
      Object.entries(next)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
      { mode: 0o600 },
    );
    const result = spawnSync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      [
        "--yes",
        "supabase@2.83.0",
        "secrets",
        "set",
        "--project-ref",
        project,
        "--env-file",
        ".env.drive-renew.local",
      ],
      {
        shell: process.platform === "win32",
        encoding: "utf8",
        windowsHide: true,
      },
    );
    if (result.status !== 0)
      throw Error(
        "Autorizzazione salvata, ma aggiornamento del server non riuscito.",
      );
  } finally {
    if (fs.existsSync(envPath)) fs.unlinkSync(envPath);
  }
}
async function validateFolder(accessToken) {
  const response = await fetch(
    "https://www.googleapis.com/drive/v3/files/" +
      encodeURIComponent(config.GDRIVE_FOLDER_ID) +
      "?fields=id,mimeType,trashed",
    { headers: { Authorization: "Bearer " + accessToken } },
  );
  if (!response.ok)
    throw Error(
      "La cartella originale non è accessibile. Autorizza lo stesso account Google usato per Hush.",
    );
  const folder = await response.json();
  if (
    folder.trashed ||
    folder.mimeType !== "application/vnd.google-apps.folder"
  )
    throw Error("La cartella originale non è disponibile.");
}
let processing = false;
const server = http.createServer(async (req, res) => {
  const send = (status, content) => {
    res.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    });
    res.end(page(content));
  };
  if (req.headers.host !== `127.0.0.1:${port}` || req.method !== "GET") {
    send(403, "<h1>Richiesta non consentita</h1>");
    return;
  }
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname === "/") {
    send(
      200,
      `<h1>Ricollega il Drive di Hush</h1><p>La precedente autorizzazione Google è scaduta o è stata revocata.</p><ol><li>Apri <a href="${escape(consoleUrl)}" target="_blank" rel="noopener noreferrer">Google Auth Platform → Pubblico</a>. Se lo stato è <strong>Test</strong>, premi <strong>Pubblica app</strong>. Questo evita la scadenza dopo sette giorni.</li><li>Torna qui e continua con lo stesso account Google del Drive di Hush.</li></ol><a class="action" href="${escape(auth.toString())}">Continua con Google</a><p><small>La cartella e gli allegati esistenti vengono mantenuti. I permessi richiesti restano quelli già usati da Hush.</small></p>`,
    );
    return;
  }
  if (url.pathname !== "/oauth2callback") {
    send(404, "<h1>Pagina non trovata</h1>");
    return;
  }
  if (url.searchParams.get("state") !== state) {
    send(
      400,
      "<h1>Autorizzazione non valida</h1><p>Riparti dalla pagina di collegamento di Hush.</p>",
    );
    return;
  }
  if (url.searchParams.has("error")) {
    send(
      400,
      "<h1>Autorizzazione annullata</h1><p>Puoi tornare alla pagina iniziale e riprovare.</p>",
    );
    return;
  }
  const code = url.searchParams.get("code");
  if (!code || processing) {
    send(400, "<h1>Richiesta non valida</h1>");
    return;
  }
  processing = true;
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: config.GDRIVE_CLIENT_ID,
        client_secret: config.GDRIVE_CLIENT_SECRET,
        code,
        code_verifier: verifier,
        redirect_uri: redirect,
        grant_type: "authorization_code",
      }),
    });
    const tokens = await response.json();
    if (!response.ok || !tokens.refresh_token || !tokens.access_token)
      throw Error(
        "Google non ha completato l’autorizzazione. Riprova dalla pagina iniziale.",
      );
    await validateFolder(tokens.access_token);
    const next = { ...config, GDRIVE_REFRESH_TOKEN: tokens.refresh_token };
    const temp = configPath + ".tmp.local";
    fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(temp, configPath);
    if (process.platform === "win32" && process.env.APPDATA) {
      const appDir = path.join(process.env.APPDATA, "Hush");
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(
        path.join(appDir, "gdrive-config.json"),
        JSON.stringify(next, null, 2),
        { mode: 0o600 },
      );
    }
    await deploy(next);
    send(
      200,
      "<h1>Google Drive ricollegato</h1><p>Il server è stato aggiornato. Torna in Hush e riprova a inviare il file.</p>",
    );
    console.log(
      JSON.stringify({
        driveReauthorized: true,
        originalFolderPreserved: true,
        serverSecretsUpdated: true,
      }),
    );
    server.close();
    clearTimeout(timer);
  } catch (error) {
    processing = false;
    const message =
      error instanceof Error ? error.message : "Ricollegamento non riuscito.";
    send(
      502,
      "<h1>Ricollegamento non completato</h1><p>" + escape(message) + "</p>",
    );
    console.error(message);
  }
});
server.on("error", () => {
  console.error(
    "La porta 8989 non è disponibile. Chiudi altre procedure di configurazione Drive e riprova.",
  );
  process.exitCode = 1;
});
const timer = setTimeout(
  () => {
    console.log("Procedura di autorizzazione scaduta.");
    server.close();
  },
  15 * 60 * 1000,
);
timer.unref();
server.listen(port, "127.0.0.1", () =>
  console.log("Ricollegamento pronto: http://127.0.0.1:8989/"),
);
