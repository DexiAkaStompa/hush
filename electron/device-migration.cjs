// A bounded, short-lived connection to the Rust process's current-user-only
// Windows pipe. Account/session data is AES-GCM sealed by the trusted renderer;
// this process forwards opaque frames and never writes migration data to disk.
const net = require("node:net");
const MAX_LINE_BYTES = 2 * 1024 * 1024;
const LIFETIME_MS = 5 * 60 * 1000;
const UUID = "[a-f\\d]{8}(?:-[a-f\\d]{4}){3}-[a-f\\d]{12}";
const PIPE = new RegExp("^HushMigration-" + UUID + "$", "i");
const ID = new RegExp("^" + UUID + "$", "i");
const TOKEN = /^[A-Za-z\d_-]{43}$/;

function object(value) { return value && typeof value === "object" && !Array.isArray(value); }
function validPublicKey(value) {
  return object(value) && value.kty === "EC" && value.crv === "P-256"
    && TOKEN.test(value.x) && TOKEN.test(value.y) && !("d" in value);
}
function validHello(value, now = Date.now()) {
  return object(value) && value.version === 1 && ID.test(value.id) && TOKEN.test(value.challenge)
    && Number.isSafeInteger(value.expiresAt) && value.expiresAt > now && value.expiresAt <= now + LIFETIME_MS + 1000
    && validPublicKey(value.publicKey);
}
function validFrame(value, transferId) {
  return object(value) && value.version === 1 && value.transferId === transferId
    && Number.isSafeInteger(value.sequence) && value.sequence >= 0
    && typeof value.nonce === "string" && /^[A-Za-z\d+/]{16}$/.test(value.nonce)
    && typeof value.ciphertext === "string" && value.ciphertext.length >= 24
    && value.ciphertext.length <= Math.ceil((1024 * 1024 + 16) / 3) * 4
    && /^[A-Za-z\d+/]*={0,2}$/.test(value.ciphertext);
}
function migrationArguments(argv) {
  const pipes = argv.filter(value => typeof value === "string" && value.startsWith("--hush-migration-pipe="));
  const tokens = argv.filter(value => typeof value === "string" && value.startsWith("--hush-migration-token="));
  if (!pipes.length && !tokens.length) return null;
  if (pipes.length !== 1 || tokens.length !== 1) throw new Error("Richiesta di migrazione non valida.");
  const pipe = pipes[0].slice("--hush-migration-pipe=".length), token = tokens[0].slice("--hush-migration-token=".length);
  if (!PIPE.test(pipe) || !TOKEN.test(token)) throw new Error("Richiesta di migrazione non valida.");
  return { pipe, token };
}
function migrationArgumentsForSecondInstance(argv, additionalData) {
  const forwarded = additionalData?.hushMigration;
  if (object(forwarded) && typeof forwarded.pipe === "string" && typeof forwarded.token === "string") {
    const restored = [`--hush-migration-pipe=${forwarded.pipe}`, `--hush-migration-token=${forwarded.token}`];
    try { if (migrationArguments(restored)) return restored; } catch { /* Fall back to validated native argv. */ }
  }
  return Array.isArray(argv) ? argv : [];
}

function registerDeviceMigration({ ipcMain, windowForEvent, getWindow, onFinished = () => {}, onAborted = () => {},
  platform = process.platform, connect = options => net.createConnection(options) }) {
  let active = null;
  const emit = message => {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send("migration:message", message);
  };
  function close(context, notify = true) {
    if (!context || active !== context) return;
    active = null;
    clearTimeout(context.timer);
    context.request = null;
    context.input = Buffer.alloc(0);
    context.socket.destroy();
    if (notify) { emit({ kind: "cancel" }); onAborted(); }
  }
  function owned(event) {
    const window = windowForEvent(event);
    if (!window || window !== getWindow() || !active || active.closed) {
      throw new Error("Trasferimento di Hush non autorizzato.");
    }
    return active;
  }
  function write(context, message) {
    if (active !== context || context.socket.destroyed) return Promise.reject(new Error("Trasferimento di Hush interrotto."));
    let serialized;
    try { serialized = JSON.stringify(message) + "\n"; }
    catch { return Promise.reject(new Error("Messaggio di migrazione non valido.")); }
    if (Buffer.byteLength(serialized, "utf8") > MAX_LINE_BYTES) return Promise.reject(new Error("Blocco di migrazione troppo grande."));
    return new Promise((resolve, reject) => context.socket.write(serialized,
      error => error ? reject(new Error("Invio del trasferimento interrotto.")) : resolve()));
  }
  function receive(context, message) {
    if (active !== context || !object(message)) throw new Error("Messaggio di migrazione non valido.");
    if (message.kind === "request") {
      if (context.request || !validHello(message.hello)) throw new Error("Richiesta di migrazione non valida.");
      context.request = message.hello;
      emit({ kind: "request", hello: message.hello });
      return;
    }
    if (message.kind === "cancel") { close(context); return; }
    if (!context.request || Date.now() >= context.request.expiresAt
        || message.kind !== "frame" || !validFrame(message.frame, context.request.id)) {
      throw new Error("Risposta di migrazione non valida.");
    }
    emit({ kind: "frame", frame: message.frame });
  }
  function beginFromArguments(argv) {
    const request = migrationArguments(argv);
    if (!request) return false;
    if (platform !== "win32") throw new Error("Il trasferimento automatico è disponibile su Windows.");
    if (active) throw new Error("Un trasferimento di Hush è già in corso.");
    const socket = connect({ path: "\\\\.\\pipe\\" + request.pipe });
    const context = { socket, request: null, input: Buffer.alloc(0), timer: null, sending: false, sentKey: false };
    active = context;
    context.timer = setTimeout(() => close(context), LIFETIME_MS);
    context.timer.unref?.();
    socket.once("connect", () => { void write(context, { kind: "authenticate", token: request.token }).catch(() => close(context)); });
    socket.on("data", chunk => {
      if (active !== context) return;
      if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
      // At most one complete line can wait in this accumulator. Large socket
      // batches are parsed incrementally rather than concatenated unboundedly.
      let offset = 0;
      while (offset < chunk.length && active === context) {
        const newline = chunk.indexOf(10, offset);
        const end = newline < 0 ? chunk.length : newline;
        if (context.input.length + end - offset > MAX_LINE_BYTES) { close(context); return; }
        context.input = Buffer.concat([context.input, chunk.subarray(offset, end)]);
        offset = end + 1;
        if (newline < 0) break;
        const line = context.input; context.input = Buffer.alloc(0);
        try { receive(context, JSON.parse(line.toString("utf8"))); }
        catch { close(context); return; }
      }
    });
    socket.once("error", () => close(context));
    socket.once("close", () => close(context));
    return true;
  }
  ipcMain.handle("migration:get-request", event => {
    const window = windowForEvent(event);
    if (!window || window !== getWindow()) throw new Error("Richiesta di migrazione non autorizzata.");
    return active?.request ?? null;
  });
  ipcMain.handle("migration:send", async (event, message) => {
    const context = owned(event);
    if (!context.request || context.sending || Date.now() >= context.request.expiresAt || !object(message)) {
      throw new Error("Richiesta di migrazione non valida.");
    }
    if (message.kind === "cancel") { close(context); return; }
    if (message.kind === "sender-key") {
      if (context.sentKey || !validPublicKey(message.publicKey)) throw new Error("Chiave di migrazione non valida.");
      context.sentKey = true;
    } else if (message.kind !== "frame" || !context.sentKey || !validFrame(message.frame, context.request.id)) {
      throw new Error("Messaggio di migrazione non valido.");
    }
    context.sending = true;
    try { await write(context, message); }
    catch (error) { close(context); throw error; }
    finally { context.sending = false; }
  });
  ipcMain.handle("migration:finish", async event => {
    const context = owned(event);
    if (!context.request || !context.sentKey) throw new Error("Trasferimento di Hush incompleto.");
    // The pipe server distinguishes orderly source completion from an abort.
    // This follows the encrypted `finished` frame already flushed above it.
    await write(context, { kind: "complete" });
    close(context, false); onFinished();
  });
  return { beginFromArguments, abort: () => close(active), hasPendingMigration: () => Boolean(active) };
}

module.exports = { registerDeviceMigration, migrationArguments, migrationArgumentsForSecondInstance, MAX_LINE_BYTES };
