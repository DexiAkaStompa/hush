const { createHash, createPublicKey, verify } = require("node:crypto");
const { spawn } = require("node:child_process");
const { createReadStream } = require("node:fs");
const { mkdtemp, open, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");

const CHANNEL = "https://github.com/DexiAkaStompa/hush/releases/download/rust-preview";
const PACKAGE_LIMIT = 64 * 1024 * 1024;
const MANIFEST_LIMIT = 32 * 1024;
const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const CDN = new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com"]);
const PUBLIC_KEY_PATH = path.join(__dirname, "..", "src-tauri", "updater.pub");

function currentOrNewer(version, currentVersion) {
  if (typeof version !== "string" || !VERSION.test(version) || !VERSION.test(currentVersion)) return false;
  const actual = version.split(".").map(Number);
  const current = currentVersion.split(".").map(Number);
  const differing = actual.findIndex((number, index) => number !== current[index]);
  return differing === -1 || actual[differing] > current[differing];
}

function selectPackage(manifest, currentVersion) {
  const version = manifest?.version;
  if (typeof version !== "string" || !VERSION.test(version)) throw new Error("Versione Rust non valida.");
  if (!currentOrNewer(version, currentVersion)) return null;
  const entry = manifest.platforms?.["windows-x86_64"];
  const url = `${CHANNEL}/Hush-Rust-Setup-${version}-x64.exe`;
  if (entry?.url !== url || typeof entry.signature !== "string" || entry.signature.length > 16_384) {
    throw new Error("Pacchetto Rust non valido.");
  }
  return { version, url, signature: entry.signature };
}

function decodeBase64(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error("Firma Rust non valida.");
  const data = Buffer.from(text, "base64");
  if (data.toString("base64") !== text) throw new Error("Firma Rust non valida.");
  return data;
}

function verifyInstaller(digest, { version, signature }, publicKey) {
  // Tauri wraps Minisign's text records in base64. We require its prehashed
  // form, and verify the signed comment which binds the installer to a version.
  const [, encodedPublicKey] = decodeBase64(publicKey.trim()).toString("utf8").trimEnd().split(/\r?\n/);
  const [, encodedSignature, comment, encodedGlobal, ...extra] = decodeBase64(signature).toString("utf8").trimEnd().split(/\r?\n/);
  const pk = decodeBase64(encodedPublicKey);
  const sig = decodeBase64(encodedSignature);
  const global = decodeBase64(encodedGlobal);
  const prefix = "trusted comment: ";
  if (digest.length !== 64 || extra.length || pk.length !== 42 || sig.length !== 74 || global.length !== 64
    || pk.toString("ascii", 0, 2) !== "Ed" || sig.toString("ascii", 0, 2) !== "ED"
    || !pk.subarray(2, 10).equals(sig.subarray(2, 10)) || !comment?.startsWith(prefix)) {
    throw new Error("Firma Rust non valida.");
  }
  const trusted = comment.slice(prefix.length);
  const versions = trusted.split("\t").filter(field => field.startsWith("version:"));
  const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), pk.subarray(10)]), type: "spki", format: "der" });
  if (versions.length !== 1 || versions[0] !== `version:${version}`
    || !verify(null, digest, key, sig.subarray(10))
    || !verify(null, Buffer.concat([sig.subarray(10), Buffer.from(trusted)]), key, global)) {
    throw new Error("Firma o versione Rust non valida.");
  }
}

async function fetchAsset(url, timeout) {
  const signal = AbortSignal.timeout(timeout);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.port || parsed.username || parsed.password || !CDN.has(parsed.hostname)) break;
    const response = await fetch(parsed, { redirect: "manual", signal, headers: { "Accept-Encoding": "identity" } });
    if (response.ok && response.body) return response;
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => {});
    if (!location || ![301, 302, 303, 307, 308].includes(response.status)) break;
    url = new URL(location, parsed).href;
  }
  throw new Error("Download di Hush Rust non disponibile. Riprova tra poco.");
}

async function readLimited(response, limit, consume) {
  const encoding = response.headers.get("content-encoding");
  const declared = encoding && encoding !== "identity" ? 0 : Number(response.headers.get("content-length"));
  if (declared > limit) {
    await response.body.cancel();
    throw new Error("Pacchetto Rust troppo grande.");
  }
  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.byteLength;
    if (received > limit) throw new Error("Pacchetto Rust troppo grande.");
    await consume(chunk, received, declared);
  }
  if (!received || (declared > 0 && received !== declared)) throw new Error("Download Rust incompleto.");
}

function createRustUpgrade({ version, updateStatus, installProcess = spawn }) {
  let ready = null;
  let installing = false;
  let closed = false;
  const status = (state, details = {}) => updateStatus(state, { target: "rust", ...details });
  const cleanup = directory => rm(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }).catch(() => {});

  async function check() {
    if (ready || installing || closed) return;
    status("checking");
    let directory;
    try {
      const chunks = [];
      await readLimited(await fetchAsset(`${CHANNEL}/rust-latest.json`, 12_000), MANIFEST_LIMIT, chunk => chunks.push(chunk));
      const selected = selectPackage(JSON.parse(Buffer.concat(chunks).toString("utf8")), version);
      if (!selected) {
        status("current", { message: "Il passaggio a Hush Rust sarà disponibile con il prossimo controllo." });
        return;
      }
      const publicKey = await readFile(PUBLIC_KEY_PATH, "utf8");
      const response = await fetchAsset(selected.url, 90_000);
      directory = await mkdtemp(path.join(tmpdir(), "hush-rust-upgrade-"));
      const filename = path.join(directory, "Hush-Rust-Setup.exe");
      const output = await open(filename, "wx", 0o600);
      const hash = createHash("blake2b512");
      let lastProgress = -5;
      try {
        status("downloading", { version: selected.version, percent: 0 });
        await readLimited(response, PACKAGE_LIMIT, async (chunk, received, declared) => {
          await output.writeFile(chunk);
          hash.update(chunk);
          const percent = declared ? Math.floor(received / declared * 100) : 0;
          if (percent >= lastProgress + 5) {
            lastProgress = percent;
            status("downloading", { version: selected.version, percent });
          }
        });
      } finally { await output.close(); }
      verifyInstaller(hash.digest(), selected, publicKey);
      if (closed) return;
      ready = { directory, filename, selected, publicKey };
      directory = undefined;
      status("downloaded", { version: selected.version, percent: 100, message: "Hush Rust è pronto. Le chat e le impostazioni verranno trasferite all’apertura." });
    } catch {
      status("error", { message: "Impossibile scaricare o verificare Hush Rust. Riprova tra poco." });
    } finally {
      if (directory) await cleanup(directory);
    }
  }

  async function install(canInstall) {
    if (!ready || installing || closed) throw new Error("Nessun aggiornamento Rust pronto.");
    if (!canInstall()) throw new Error("Termina la chiamata prima di installare Hush Rust.");
    installing = true;
    const candidate = ready;
    try {
      // Recheck the on-disk bytes immediately before handing them to Windows.
      const hash = createHash("blake2b512");
      let total = 0;
      for await (const chunk of createReadStream(candidate.filename)) {
        total += chunk.byteLength;
        if (total > PACKAGE_LIMIT) throw new Error("Pacchetto Rust troppo grande.");
        hash.update(chunk);
      }
      verifyInstaller(hash.digest(), candidate.selected, candidate.publicKey);
    } catch {
      ready = null;
      installing = false;
      await cleanup(candidate.directory);
      const message = "Il file di Hush Rust non è più valido. Scaricalo di nuovo.";
      status("error", { message });
      throw new Error(message);
    }
    try {
      if (closed || !canInstall()) throw new Error("Termina la chiamata prima di installare Hush Rust.");
      // The first installation needs WebView2 setup and Windows shortcuts.
      const child = installProcess(candidate.filename, ["/P", "/R", "/ARGS"], { stdio: "ignore", detached: true, windowsHide: true });
      status("installing", { version: candidate.selected.version, message: "Hush Rust si aprirà per trasferire le tue chat." });
      child.once("exit", code => {
        installing = false;
        if (code === 0) {
          ready = null;
          void cleanup(candidate.directory);
          status("current", { message: "Hush Rust è stato installato. Aprilo per completare il trasferimento." });
        } else status("downloaded", { version: candidate.selected.version, message: "Installazione interrotta. Puoi riprovare." });
      });
      await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
      child.unref();
    } catch (error) {
      installing = false;
      status("downloaded", { version: candidate.selected.version, message: "Il passaggio a Rust è ancora disponibile." });
      throw error;
    }
  }

  return {
    check, install,
    dispose() {
      closed = true;
      if (ready && !installing) { void cleanup(ready.directory); ready = null; }
    },
  };
}

module.exports = { createRustUpgrade, selectPackage, verifyInstaller };
