import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

assert.equal(process.platform, "win32", "The Rust runtime smoke check requires Windows.");
const project = fileURLToPath(new URL("../", import.meta.url));
const binary = path.resolve(process.argv[2] || path.join(project, "src-tauri/target/debug/hush-desktop.exe"));
const outputDirectory = path.resolve(process.argv[3] || path.join(project, "release-rust-check"));
assert.ok(existsSync(binary), `Rust debug executable not found: ${binary}`);
const { version } = JSON.parse(await readFile(path.join(project, "package.json"), "utf8"));
const verifyUpdates = process.env.HUSH_RUN_RUST_UPDATE_CHECK === "1";
await mkdir(outputDirectory, { recursive: true });

const temporaryParent = await realpath(tmpdir());
const server = createServer();
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const port = server.address().port;
await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
const browserDirectory = await realpath(await mkdtemp(path.join(temporaryParent, "hush-rust-smoke-")));

const child = spawn(binary, [], {
  cwd: project,
  windowsHide: true,
  stdio: ["ignore", "ignore", "pipe"],
  env: {
    ...process.env,
    HUSH_RUST_TEST_BROWSER_ARGS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1 --use-fake-ui-for-media-stream --use-fake-device-for-media-stream`,
    HUSH_RUST_TEST_DATA_DIR: browserDirectory,
    HUSH_RUST_TEST_ALLOW_MULTI_INSTANCE: "1",
    // An explicit absent fixture marker disables detection of real profiles.
    HUSH_RUST_TEST_MIGRATION_MARKER: path.join(browserDirectory, "missing-marker.json"),
    HUSH_RUST_TEST_UPDATE_VERIFY_ONLY: verifyUpdates ? "1" : "0",
  },
});
let stderr = "";
let launchFailure;
child.stderr.on("data", bytes => { stderr = (stderr + bytes).slice(-8000); });
child.on("error", error => { launchFailure = error; });
const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
const running = () => Boolean(child.pid) && !launchFailure && child.exitCode === null && child.signalCode === null;
async function waitForExit(milliseconds) {
  let timer;
  try {
    return await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => resolve(null), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

class Devtools {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result);
      } else {
        for (const listener of this.listeners.get(message.method) || []) listener(message.params);
      }
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Renderer disconnected during ${pending.method}.`));
      }
      this.pending.clear();
    });
  }

  static async open(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error("Renderer debugger connection timed out.")); }, 5000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); socket.close(); reject(new Error("Renderer debugger connection failed.")); }, { once: true });
    });
    return new Devtools(socket);
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener); this.listeners.set(method, listeners);
  }

  send(method, params = {}, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out.`)); }, Math.min(timeout, 60000));
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async evaluate(expression, timeout = 15000) {
    const response = await this.send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    }, timeout);
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  }

  close() { this.socket.close(); }
}

let devtools;
let failure;
const report = { status: "running", version, origin: null, checks: {}, exceptions: [], cspViolations: [], platform: process.platform };
const cspHook = `globalThis.__hushRustSmokeCsp = []; document.addEventListener('securitypolicyviolation', event => globalThis.__hushRustSmokeCsp.push({directive:event.effectiveDirective, blockedURI:event.blockedURI}));`;

async function waitFor(check, message, timeout = 20000) {
  const deadline = Date.now() + Math.min(timeout, 60000);
  let lastError;
  while (Date.now() < deadline) {
    if (launchFailure) throw launchFailure;
    if (!running()) throw new Error(`Rust app exited before verification completed (${child.exitCode ?? child.signalCode}).`);
    try { if (await check()) return; } catch (error) { lastError = error; }
    await delay(150);
  }
  throw new Error(`${message}${lastError ? ` (${lastError.message})` : ""}`);
}

async function waitForAuth() {
  await waitFor(() => devtools.evaluate(`Boolean(document.querySelector('.auth-screen form') && !document.querySelector('.app-crash') && typeof window.hushWindow?.getUpdateStatus === 'function')`), "Rust app did not render the sign-in UI with its native bridge.");
}

async function createCryptoFixture() {
  const identity = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const peer = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: peer.publicKey }, identity.privateKey, 256);
  const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode("Hush Rust runtime persistence smoke fixture");
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, plain);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aes, cipher);
  if (!new Uint8Array(decrypted).every((byte, i) => byte === plain[i])) throw new Error("AES-GCM roundtrip failed.");
  let exportRejected = false;
  try { await crypto.subtle.exportKey("pkcs8", identity.privateKey); } catch { exportRejected = true; }
  if (!exportRejected || identity.privateKey.extractable) throw new Error("The identity key must be non-extractable.");
  const corrupted = new Uint8Array(cipher.slice(0)); corrupted[0] ^= 1;
  let tamperRejected = false;
  try { await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aes, corrupted); } catch { tamperRejected = true; }
  if (!tamperRejected) throw new Error("Tampered ciphertext was accepted.");
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("hush-rust-smoke-fixture", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("keys");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("keys", "readwrite");
      transaction.objectStore("keys").put({ privateKey: identity.privateKey, peerPublicKey: peer.publicKey, aes, iv, cipher, expected: Array.from(new Uint8Array(shared)) }, "fixture");
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Identity persistence transaction aborted."));
    });
  } finally { database.close(); }
  localStorage.setItem("hush:rust-smoke-persisted", "yes");
  return { aesGcmRoundtrip: true, tamperedCiphertextRejected: true, nonExtractableIdentity: true, persistedToIndexedDb: true };
}

async function verifyCryptoFixture() {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("hush-rust-smoke-fixture", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  let fixture;
  try {
    fixture = await new Promise((resolve, reject) => {
      const request = database.transaction("keys", "readonly").objectStore("keys").get("fixture");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
  if (!fixture || fixture.privateKey.extractable || !(fixture.privateKey instanceof CryptoKey)) throw new Error("Stored identity key did not survive reload.");
  const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: fixture.peerPublicKey }, fixture.privateKey, 256));
  if (!derived.every((byte, i) => byte === fixture.expected[i])) throw new Error("Stored ECDH key changed across reload.");
  const plaintext = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fixture.iv }, fixture.aes, fixture.cipher));
  if (plaintext !== "Hush Rust runtime persistence smoke fixture") throw new Error("Stored encryption key cannot decrypt its ciphertext.");
  if (localStorage.getItem("hush:rust-smoke-persisted") !== "yes") throw new Error("Local preferences did not survive reload.");
  return { sameEcdhSecretAfterReload: true, ciphertextDecryptsAfterReload: true, localStoragePersists: true };
}

async function captureMediaCapabilities() {
  const audio = RTCRtpSender.getCapabilities("audio")?.codecs.map(codec => codec.mimeType) || [];
  const video = RTCRtpSender.getCapabilities("video")?.codecs.map(codec => codec.mimeType) || [];
  if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.getDisplayMedia || !audio.some(codec => codec.toLowerCase() === "audio/opus") || video.length === 0) throw new Error("Required calling and screen sharing APIs or codecs are missing.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  try {
    if (stream.getAudioTracks().length !== 1 || stream.getVideoTracks().length !== 1 || stream.getTracks().some(track => track.readyState !== "live")) throw new Error("Fake microphone/camera capture is not live.");
    return { audioCodecs: audio, videoCodecs: video, getDisplayMediaAvailable: true, fakeMicrophoneAndCameraCapture: true, screenCaptureTested: false };
  } finally { stream.getTracks().forEach(track => track.stop()); }
}

try {
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return false;
    const pages = await response.json();
    const page = pages.find(page => page.type === "page" && page.url.startsWith("https://tauri.localhost"));
    if (!page) return false;
    devtools = await Devtools.open(page.webSocketDebuggerUrl);
    return true;
  }, "Production Rust renderer debugger did not become available. Build debug with the custom-protocol feature.", 45000);
  devtools.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    report.exceptions.push({ text: exceptionDetails.text, description: exceptionDetails.exception?.description?.slice(0, 2000), lineNumber: exceptionDetails.lineNumber });
  });
  devtools.on("Log.entryAdded", ({ entry }) => {
    if (entry.source === "security" && /content security policy|violat.*directive/i.test(entry.text)) report.cspViolations.push({ text: entry.text.slice(0, 2000) });
  });
  await devtools.send("Runtime.enable");
  await devtools.send("Page.enable");
  await devtools.send("Log.enable");
  await devtools.send("Page.addScriptToEvaluateOnNewDocument", { source: cspHook });
  await devtools.evaluate(cspHook);
  await waitForAuth();
  const initial = await devtools.evaluate(`(async () => ({ origin:location.origin, secure:isSecureContext, version:(await window.hushWindow.getUpdateStatus()).currentVersion, maximized:await window.hushWindow.isMaximized(), controls:document.querySelectorAll('.window-controls button').length }))()`);
  assert.equal(initial.origin, "https://tauri.localhost", "The smoke check must use bundled production assets.");
  assert.equal(initial.secure, true, "Crypto and media require a secure app origin.");
  assert.equal(initial.version, version, "Rust and client versions differ.");
  assert.equal(initial.controls, 3, "The original window controls are missing.");
  report.origin = initial.origin;
  report.checks.signInAndBridge = true;
  for (const maximized of [!initial.maximized, initial.maximized]) {
    await devtools.evaluate(`document.querySelector('.window-controls button:nth-child(2)').click()`);
    await waitFor(() => devtools.evaluate(`(async () => (await window.hushWindow.isMaximized()) === ${maximized} && document.body.classList.contains('window-maximized') === ${maximized})()`), "The original maximize/restore button did not update the native window and UI.");
  }
  report.checks.windowMaximizeAndRestore = true;
  report.checks.rawAttachmentIpc = await devtools.evaluate(`(async () => {
    let rejection;
    try { await window.hushWindow.writeAttachmentSave('invalid-test-token', 0, new Uint8Array([1,2,3])); }
    catch (error) { rejection = String(error); }
    if (rejection !== 'Download non valido o non autorizzato.') throw new Error('Raw attachment IPC did not reach the native token validation: ' + rejection);
    return { rawBodyAndHeadersReachedNative: true, unknownTransferRejected: true };
  })()`);
  report.checks.cryptoBeforeReload = await devtools.evaluate(`(${createCryptoFixture.toString()})()`, 30000);
  report.checks.media = await devtools.evaluate(`(${captureMediaCapabilities.toString()})()`, 30000);
  await devtools.evaluate("globalThis.__hushRustSmokeOldDocument = true");
  await devtools.send("Page.reload", { ignoreCache: true });
  // Page.reload acknowledges before navigation finishes. Waiting for a fresh
  // global prevents accidentally reading the old document and passing a
  // persistence check without ever reopening IndexedDB in the new page.
  await waitFor(() => devtools.evaluate("!('__hushRustSmokeOldDocument' in globalThis)"), "The packaged renderer did not create a fresh document after reload.");
  await waitForAuth();
  report.checks.cryptoAfterReload = await devtools.evaluate(`(${verifyCryptoFixture.toString()})()`, 30000);
  if (verifyUpdates) {
    // Debug verification can download and verify the public current package,
    // but both explicit installation and install-on-quit are disabled natively.
    report.checks.signedUpdate = await devtools.evaluate(`(async () => {
      const phases = [];
      const unsubscribe = window.hushWindow.onUpdateStatus(status => phases.push(status.status));
      try {
        const status = await window.hushWindow.checkForUpdates();
        if (status.status !== 'downloaded' || status.version !== ${JSON.stringify(version)}) throw new Error('Signed update was not downloaded and verified: ' + status.status + '; phases: ' + phases.join(', '));
        await window.hushWindow.setCallActive(true);
        let activeCallRejected = false;
        try { await window.hushWindow.installUpdate(); } catch (error) { activeCallRejected = String(error).includes('Termina la chiamata'); }
        await window.hushWindow.setCallActive(false);
        let verificationInstallRejected = false;
        try { await window.hushWindow.installUpdate(); } catch (error) { verificationInstallRejected = String(error).includes('disattivata nelle build di verifica'); }
        if (!activeCallRejected || !verificationInstallRejected) throw new Error('Verification must not install or interrupt a call.');
        return { version: status.version, phases, activeCallRejected, verificationInstallRejected };
      } finally { unsubscribe(); }
    })()`, 60000);
  }
  report.cspViolations.push(...await devtools.evaluate("globalThis.__hushRustSmokeCsp || []"));
  assert.equal(report.exceptions.length, 0, "The renderer raised an uncaught exception.");
  assert.equal(report.cspViolations.length, 0, "The packaged renderer violated its content security policy.");
  const screenshot = await devtools.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(outputDirectory, "hush-rust-auth.png"), Buffer.from(screenshot.data, "base64"));
  // Closing through the same bridge used by the top-right X must end the app.
  await devtools.evaluate("window.hushWindow.close(); true").catch(error => {
    if (!/disconnected|closed/i.test(error.message)) throw error;
  });
  const exit = await waitForExit(10000);
  assert.ok(exit, "The native close button did not exit the Rust app.");
  assert.equal(exit.code, 0, "The Rust app exited with an error.");
  report.checks.closeExitsProcess = true;
  report.status = "passed";
} catch (error) {
  failure = error;
  report.status = "failed";
  report.error = error.message;
  if (stderr) report.nativeStderr = stderr;
  if (devtools) {
    try {
      const screenshot = await devtools.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, 4000);
      await writeFile(path.join(outputDirectory, "hush-rust-failure.png"), Buffer.from(screenshot.data, "base64"));
    } catch { /* The runtime may already have exited. */ }
  }
} finally {
  if (running()) {
    try { await devtools?.evaluate("window.hushWindow?.close(); true", 3000); } catch { /* Close may disconnect its own debugger. */ }
    await waitForExit(3000);
    if (running()) {
      // Only the process we spawned and its descendants are eligible for cleanup.
      await promisify(execFile)("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 10000 }).catch(() => undefined);
      await waitForExit(3000);
    }
  }
  devtools?.close();
  try {
    assert.equal(path.dirname(browserDirectory), temporaryParent, "Refusing to remove a directory outside the owned temporary parent.");
    assert.match(path.basename(browserDirectory), /^hush-rust-smoke-[A-Za-z0-9]+$/, "Refusing to remove an unowned profile.");
    await rm(browserDirectory, { recursive: true, force: true, maxRetries: 15, retryDelay: 100 });
    report.checks.temporaryProfileRemoved = true;
  } catch (error) {
    failure ||= error; report.status = "failed"; report.cleanupError = error.message;
  }
  await writeFile(path.join(outputDirectory, "runtime-report.json"), JSON.stringify(report, null, 2) + "\n");
}

if (failure) throw failure;
console.log("Rust Windows runtime verified: original sign-in UI and controls, persistent non-extractable keys, authenticated encryption, fake media capture, CSP and native close.");
console.log(`Report and screenshot: ${outputDirectory}`);
