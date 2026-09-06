import http from "node:http";
import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const PORT = 8989;
const REDIRECT_URI = "http://127.0.0.1:" + PORT + "/oauth2callback";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function openUrl(url) {
  if (process.platform === "win32") {
    exec('cmd /c start "" "' + url + '"');
  } else if (process.platform === "darwin") {
    exec('open "' + url + '"');
  } else {
    exec('xdg-open "' + url + '"');
  }
}

async function main() {
  console.log("\n===============================================");
  console.log("   Hush - Configurazione Google Drive (5 TB)   ");
  console.log("===============================================\n");

  let clientId = process.env.GDRIVE_CLIENT_ID;
  let clientSecret = process.env.GDRIVE_CLIENT_SECRET;

  if (!clientId) {
    clientId = await prompt("Inserisci il tuo ID Client (Client ID): ");
  }
  if (!clientSecret) {
    clientSecret = await prompt("Inserisci il tuo Segreto Client (Client Secret): ");
  }

  if (!clientId || !clientSecret) {
    console.error("Errore: ID Client e Segreto Client sono obbligatori.");
    process.exit(1);
  }

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  console.log("\nApertura del browser per l'autorizzazione Google...");
  console.log("Se il browser non si apre automaticamente, apri questo link:\n");
  console.log(authUrl.toString());
  console.log("\nIn attesa dell'autorizzazione...");

  openUrl(authUrl.toString());

  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url, "http://127.0.0.1:" + PORT);
      if (reqUrl.pathname !== "/oauth2callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = reqUrl.searchParams.get("code");
      const error = reqUrl.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h2>Autorizzazione annullata: " + error + "</h2><p>Puoi chiudere questa scheda.</p>");
        server.close();
        process.exit(1);
        return;
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h2>Nessun codice ricevuto</h2>");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h2>Autorizzazione completata con successo!</h2><p>Torna al terminale per completare la configurazione.</p>");
      server.close();

      console.log("\nCodice ricevuto. Scambio con il Refresh Token in corso...");

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
        }),
      });

      const tokens = await tokenRes.json();
      if (!tokenRes.ok || !tokens.refresh_token) {
        console.error("Errore durante l'ottenimento dei token:", tokens);
        process.exit(1);
      }

      const refreshToken = tokens.refresh_token;
      const accessToken = tokens.access_token;
      console.log("Refresh token ottenuto con successo!");

      console.log("Verifica cartella 'Hush-Media' su Google Drive...");
      let folderId = null;

      const searchRes = await fetch(
        "https://www.googleapis.com/drive/v3/files?q=name%3D%27Hush-Media%27+and+mimeType%3D%27application/vnd.google-apps.folder%27+and+trashed%3Dfalse&fields=files(id,name)",
        {
          headers: { Authorization: "Bearer " + accessToken },
        }
      );
      const searchData = await searchRes.json();

      if (Array.isArray(searchData.files) && searchData.files.length > 0) {
        folderId = searchData.files[0].id;
        console.log("Cartella 'Hush-Media' esistente trovata (ID: " + folderId + ")");
      } else {
        console.log("Creazione cartella 'Hush-Media' su Google Drive...");
        const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "Hush-Media",
            mimeType: "application/vnd.google-apps.folder",
          }),
        });
        const createData = await createRes.json();
        folderId = createData.id;
        console.log("Cartella 'Hush-Media' creata con successo (ID: " + folderId + ")");
      }

      const config = {
        GDRIVE_CLIENT_ID: clientId,
        GDRIVE_CLIENT_SECRET: clientSecret,
        GDRIVE_REFRESH_TOKEN: refreshToken,
        GDRIVE_FOLDER_ID: folderId,
      };

      const outPath = path.join(process.cwd(), "gdrive-config.json");
      fs.writeFileSync(outPath, JSON.stringify(config, null, 2), "utf-8");

      console.log("\n===============================================");
      console.log("   Configurazione completata con successo!     ");
      console.log("===============================================");
      console.log("File di configurazione salvato in: " + outPath);
      console.log("\nParametri generati:");
      console.log("GDRIVE_FOLDER_ID: " + folderId);
      console.log("GDRIVE_REFRESH_TOKEN: " + refreshToken.slice(0, 10) + "... (salvato in gdrive-config.json)");
      console.log("\nOra possiamo collegare Hush a questa cartella!");
      process.exit(0);
    } catch (err) {
      console.error("Errore imprevisto:", err);
      process.exit(1);
    }
  });

  server.listen(PORT, "127.0.0.1");
}

main().catch(console.error);