import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

assert.equal(process.platform, 'win32');
assert.equal(process.env.HUSH_RUN_LIVE_MIGRATION_TEST, '1', 'Explicit live disposable-backend opt-in required');
const workspace = fileURLToPath(new URL('../', import.meta.url));
const sourceExe = path.resolve(workspace, process.env.HUSH_MIGRATION_SOURCE_BINARY || 'release/win-unpacked/Hush.exe');
const rustExe = path.resolve(workspace, process.env.HUSH_RUST_BINARY || 'src-tauri/target/debug/hush-desktop.exe');
const keepSourceRunning = process.env.HUSH_MIGRATION_SOURCE_RUNNING === '1';
const reportDirectory = path.resolve(workspace, process.argv[2] || 'release-rust-check');
mkdirSync(reportDirectory, { recursive: true });
assert.ok(existsSync(sourceExe), 'Packaged Electron source missing');
assert.ok(existsSync(rustExe), 'Rust debug binary missing');
const root = mkdtempSync(path.join(tmpdir(), 'hush-migration-test-'));
assert.equal(path.dirname(path.resolve(root)).toLowerCase(), path.resolve(tmpdir()).toLowerCase());
const profile = path.join(root, 'profile'), targetProfile = path.join(root, 'webview2');
mkdirSync(profile); mkdirSync(targetProfile);
const marker = path.join(root, 'migration-ready.json');
const SOURCE_PORT = 9542, TARGET_PORT = 9541;
const BASE = 'https://zvzyzuzlqbuvvffxyquk.supabase.co';
const AUTH_KEY = 'sb-zvzyzuzlqbuvvffxyquk-auth-token';
const users = [], rooms = [], processes = [], connections = [];
const report = { status: 'running', checks: {}, tests: [], cleanup: false };
let admin, anon, source, native, sourceCdp, nativeCdp;

const childEnv = { ...process.env, HUSH_DISABLE_AUTO_UPDATE: '1' };
delete childEnv.ELECTRON_RUN_AS_NODE;
function launch(executable, args, label, extra = {}) {
  const child = spawn(executable, args, { cwd: workspace, windowsHide: true,
    env: { ...childEnv, ...extra }, stdio: ['ignore', openSync(path.join(root, label + '.log'), 'a'), openSync(path.join(root, label + '-error.log'), 'a')] });
  processes.push(child); return child;
}
async function stop(child, client) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  if (client) {
    await client.evaluate('window.hushWindow.close();true').catch(() => {});
    client.close();
  }
  const result = await Promise.race([exited.then(() => true), sleep(5000).then(() => false)]);
  if (!result && child.exitCode === null && child.signalCode === null) {
    child.kill(); await Promise.race([exited, sleep(5000)]);
  }
}
async function api(endpoint, headers, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(BASE + endpoint, { method, headers, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000) });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(endpoint.split('?')[0] + ' ' + response.status);
  return value;
}
class Devtools {
  constructor(socket) {
    this.socket = socket; this.sequence = 0; this.pending = new Map(); this.listeners = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data)), callbacks = this.pending.get(message.id);
      if (message.method) for (const listener of this.listeners.get(message.method) || []) listener(message.params);
      if (!callbacks) return;
      clearTimeout(callbacks.timer); this.pending.delete(message.id);
      if (message.error) callbacks.reject(new Error('Debugger request failed')); else callbacks.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Runtime closed')); }
      this.pending.clear();
    });
  }
  on(method, listener) { const listeners = this.listeners.get(method) || []; listeners.push(listener); this.listeners.set(method, listeners); }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence, timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Debugger operation timed out')); }, 20000);
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const value = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
    return value.result.value;
  }
  close() { this.socket.close(); }
}
async function connect(port, type = 'page') {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) }).then(response => response.json());
      const page = pages.find(page => page.type === type && page.webSocketDebuggerUrl);
      if (page) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { socket.close(); reject(new Error('Debugger did not connect')); }, 5000);
          socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
          socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Debugger connection failed')); }, { once: true });
        });
        const client = new Devtools(socket); connections.push(client); return client;
      }
    } catch {}
    await sleep(150);
  }
  throw new Error('Owned runtime did not expose its verification debugger');
}
async function waitFor(client, expression, label, timeout = 45000) {
  const deadline = Date.now() + Math.min(timeout, 60000);
  while (Date.now() < deadline) {
    if (await client.evaluate(expression).catch(() => false)) return;
    if (label === 'Automatic native migration did not complete' && await client.evaluate(`Boolean(document.querySelector('.app-loading[role="alert"]'))`).catch(() => false)) break;
    await sleep(150);
  }
  const state = await client.evaluate('({url:location.href,body:document.body.innerText.slice(0,600),ready:document.readyState,expectedAccountBound:(()=>{try{return!!JSON.parse(localStorage.getItem("hush:desktop-migration-pending:v1"))?.expectedUserId}catch{return false}})(),migrationKinds:globalThis.__migrationKinds})').catch(() => null);
  throw new Error(label + ': ' + JSON.stringify(state));
}
async function openConversation(client) {
  await waitFor(client, `Boolean(document.querySelector('.dm-row'))`, 'Conversation list missing');
  await client.evaluate(`document.querySelector('.dm-row').click();true`);
  await waitFor(client, `Boolean(document.querySelector('.composer textarea:not(:disabled)'))`, 'Encrypted composer not ready');
}
async function sendMessage(client, text) {
  await client.evaluate(`(()=>{const field=document.querySelector('.composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,${JSON.stringify(text)});field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await client.evaluate(`document.querySelector('form.composer').requestSubmit();true`);
  await waitFor(client, `Boolean(document.querySelector('.messages')?.innerText.includes(${JSON.stringify(text)}))`, 'Message did not appear');
}
function pass(name) { report.checks[name] = true; report.tests.push(name); console.log('PASS ' + name); }
async function identity(client, userId) {
  return client.evaluate(`(async()=>{const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('hush-device-keys');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('Identity database unavailable'))});try{return await new Promise((resolve,reject)=>{const request=database.transaction('identities','readonly').objectStore('identities').get(${JSON.stringify(userId)});request.onsuccess=()=>{const value=request.result;resolve(value?{id:value.id,userId:value.userId,extractable:value.privateKey.extractable,algorithm:value.privateKey.algorithm.name}:null)};request.onerror=()=>reject(new Error('Identity unavailable'))})}finally{database.close()}})()`);
}
function wav(samples, seed) {
  const bytes = new Uint8Array(44 + samples * 2), view = new DataView(bytes.buffer);
  const text = (offset, value) => { for (let index = 0; index < value.length; index++) bytes[offset + index] = value.charCodeAt(index); };
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 48000, true); view.setUint32(28, 96000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let index = 0; index < samples; index++) view.setInt16(44 + index * 2, Math.round(Math.sin(index / seed) * 1200), true);
  return bytes;
}
const soundFixtures = [
  { id: 'notification', database: 'hush_notification_sound_v1', store: 'sounds', samples: 300000, seed: 23, name: 'migration-message.wav' },
  { id: 'ringtone', database: 'hush_ringtone_v1', store: 'ringtones', samples: 225000, seed: 37, name: 'migration-call.wav' },
];
async function audioHashes(client) {
  return client.evaluate(`(async()=>{const result={};for(const sound of ${JSON.stringify(soundFixtures)}){const database=await new Promise((resolve,reject)=>{const request=indexedDB.open(sound.database);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('Sound database unavailable'))});try{const record=await new Promise((resolve,reject)=>{const request=database.transaction(sound.store,'readonly').objectStore(sound.store).get('active');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('Sound unavailable'))});if(!record)throw new Error('Custom sound absent');const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',await record.data.arrayBuffer()));result[sound.id]={hash:[...digest].map(byte=>byte.toString(16).padStart(2,'0')).join(''),name:record.name,size:record.data.size}}finally{database.close()}}return result})()`);
}
function ownedSourceProcesses() {
  const command = `$ownedProfile = $env:HUSH_MIGRATION_OWNED_PROFILE
@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Hush.exe' -and $_.CommandLine -and $_.CommandLine.Contains($ownedProfile) } | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress`;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true,
    env: { ...process.env, HUSH_MIGRATION_OWNED_PROFILE: profile }, encoding: 'utf8' }).trim();
  if (!output) return [];
  const value = JSON.parse(output); return Array.isArray(value) ? value : [value];
}
async function waitSourceClosed() {
  for (let attempt = 0; attempt < 20; attempt++) { if (!ownedSourceProcesses().length) return; await sleep(200); }
  throw new Error('Original client did not close after the verified handoff');
}
function launchSource() {
  const args = [`--user-data-dir=${profile}`, `--remote-debugging-port=${SOURCE_PORT}`, '--remote-debugging-address=127.0.0.1'];
  source = launch(sourceExe, args, 'source');
}
function launchTarget() {
  native = launch(rustExe, [], 'rust', { HUSH_RUST_TEST_MIGRATION_MARKER: marker,
    HUSH_RUST_TEST_DATA_DIR: targetProfile, HUSH_RUST_TEST_URL: 'http://127.0.0.1:5173/',
    HUSH_RUST_TEST_BROWSER_ARGS: `--remote-debugging-port=${TARGET_PORT} --remote-debugging-address=127.0.0.1 --autoplay-policy=no-user-gesture-required`,
    HUSH_RUST_TEST_ALLOW_MULTI_INSTANCE: '1', HUSH_RUST_TEST_WINDOW_TITLE: 'Hush migration verification' });
}
try {
  for (const port of [SOURCE_PORT, TARGET_PORT]) {
    const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(300) }).catch(() => null);
    assert.ok(!response?.ok, 'Verification debugger port is already in use');
  }
  assert.ok((await fetch('http://127.0.0.1:5173/', { signal: AbortSignal.timeout(2000) })).ok, 'Dedicated Vite startup server unavailable');
  const cli = spawnSync('npx.cmd', ['--yes', 'supabase@2.83.0', 'projects', 'api-keys', '--project-ref', 'zvzyzuzlqbuvvffxyquk', '--output', 'json'],
    { shell: true, encoding: 'utf8', timeout: 60000 });
  assert.equal(cli.status, 0, 'Authenticated backend CLI unavailable');
  const keys = JSON.parse(cli.stdout), service = keys.find(key => key.name === 'service_role')?.api_key;
  anon = keys.find(key => key.name === 'anon')?.api_key; assert.ok(service && anon, 'Backend verification credentials unavailable');
  admin = { apikey: service, Authorization: 'Bearer ' + service, 'Content-Type': 'application/json' };
  for (let index = 0; index < 2; index++) {
    const username = 'mg_' + randomBytes(7).toString('hex'), email = username + '@users.hush.invalid', password = randomBytes(24).toString('base64url');
    const account = await api('/auth/v1/admin/users', admin, { email, password, email_confirm: true, user_metadata: { username, display_name: 'Migration fixture ' + index } });
    users.push({ id: account.id, username });
    const session = await api('/auth/v1/token?grant_type=password', { apikey: anon, 'Content-Type': 'application/json' }, { email, password });
    Object.assign(users[index], { session, headers: { apikey: anon, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' } });
    report.sessionShape = { accessLength: session.access_token.length, refreshLength: session.refresh_token.length };
  }
  const room = await api('/rest/v1/rpc/create_group_dm', users[0].headers, { p_name: 'Migration verification group', p_usernames: [users[1].username] });
  rooms.push(room);
  launchSource(); sourceCdp = await connect(SOURCE_PORT);
  await waitFor(sourceCdp, `Boolean(window.hushWindow?.getDesktopMigrationRequest && document.querySelector('.auth-screen'))`, 'Packaged source did not expose the migration bridge');
  const ownMarker = JSON.parse(readFileSync(path.join(profile, 'migration-ready.json'), 'utf8'));
  assert.equal(path.resolve(ownMarker.profilePath).toLowerCase(), path.resolve(profile).toLowerCase(), 'Electron selected a different profile');
  assert.equal(path.resolve(ownMarker.executablePath).toLowerCase(), sourceExe.toLowerCase());
  const preferences = {
    'hush-theme': 'frosted-glass', 'hush:media:v1': JSON.stringify({ inputId: '', outputId: '', cameraId: '', inputVolume: 73, outputVolume: 62, noise: 'off', echoCancellation: true, autoGainControl: false, videoQuality: '1080p', audioQuality: 'high', screenFps: 60 }),
    'hush:user-status': 'dnd', 'hush:muted-chats': JSON.stringify([room]), 'hush:recent_emojis': JSON.stringify(['👍', '🎧']),
    'hush:room-music-volume:v1': '0.42', 'hush_user_audio_prefs': JSON.stringify({ [users[1].id]: { volume: 140, muted: false, videoDisabled: false, streamVolume: 120, streamMuted: false } }),
    [`hush:workspace:${users[0].id}`]: JSON.stringify({ pinned: [room], favorites: [room], serverOrder: [], hiddenMuted: [] }),
  };
  await sourceCdp.evaluate(`(async()=>{localStorage.setItem(${JSON.stringify(AUTH_KEY)},${JSON.stringify(JSON.stringify(users[0].session))});for(const[key,value]of Object.entries(${JSON.stringify(preferences)}))localStorage.setItem(key,value);for(const sound of ${JSON.stringify(soundFixtures)}){const bytes=(${wav.toString()})(sound.samples,sound.seed);const database=await new Promise((resolve,reject)=>{const request=indexedDB.open(sound.database,1);request.onupgradeneeded=()=>request.result.createObjectStore(sound.store,{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('Sound seed unavailable'))});try{await new Promise((resolve,reject)=>{const transaction=database.transaction(sound.store,'readwrite');transaction.objectStore(sound.store).put({id:'active',name:sound.name,size:bytes.length,type:'audio/wav',data:new Blob([bytes],{type:'audio/wav'}),updatedAt:Date.now()});transaction.oncomplete=resolve;transaction.onerror=()=>reject(new Error('Sound seed failed'))})}finally{database.close()}}return true})()`);
  await sourceCdp.call('Page.reload');
  await waitFor(sourceCdp, `Boolean(document.querySelector('.privacy-note')?.innerText.includes('Dispositivo'))`, 'Original device identity not registered');
  await openConversation(sourceCdp);
  const historical = 'Encrypted history before migration ' + randomBytes(8).toString('hex');
  const responseText = 'Encrypted message from Rust ' + randomBytes(8).toString('hex');
  await sendMessage(sourceCdp, historical);
  const originalIdentity = await identity(sourceCdp, users[0].id);
  assert.equal(originalIdentity.extractable, false); assert.equal(originalIdentity.algorithm, 'ECDH');
  const originals = await audioHashes(sourceCdp);
  for (const sound of soundFixtures) assert.equal(originals[sound.id].hash, createHash('sha256').update(wav(sound.samples, sound.seed)).digest('hex'));
  const rows = await api('/rest/v1/encrypted_messages?conversation_id=eq.' + room + '&select=nonce,ciphertext', users[0].headers);
  assert.equal(rows.length, 1); assert.ok(!rows[0].ciphertext.includes(historical));
  pass('packaged Electron seeded real encrypted history and both custom IndexedDB sounds in an owned profile');
  if (!keepSourceRunning) {
    await stop(source, sourceCdp); sourceCdp = null;
    await waitSourceClosed();
  }
  writeFileSync(marker, JSON.stringify({ protocolVersion: 1, executablePath: sourceExe, profilePath: profile, version: ownMarker.version }), { mode: 0o600 });
  launchTarget(); nativeCdp = await connect(TARGET_PORT);
  await waitFor(nativeCdp, 'Boolean(window.hushWindow?.onDesktopMigrationMessage)', 'Target bridge unavailable');
  await nativeCdp.evaluate('globalThis.__migrationKinds=[];window.hushWindow.onDesktopMigrationMessage(message=>globalThis.__migrationKinds.push(message.kind));true');
  await waitFor(nativeCdp, `Boolean(localStorage.getItem('hush:desktop-migrated:v1'))`, 'Automatic native migration did not complete', 60000);
  await waitSourceClosed();
  if (keepSourceRunning) {
    assert.ok(existsSync(path.join(profile, 'rust-migration-complete-v1')));
    pass('running Electron handed the profile to Rust before closing and recorded the completed upgrade');
  }
  assert.ok(existsSync(profile));
  assert.equal(await nativeCdp.evaluate(`Boolean(document.querySelector('.auth-screen'))`), false);
  assert.equal(await nativeCdp.evaluate(`document.documentElement.dataset.theme`), 'frosted-glass');
  for (const [key, value] of Object.entries(preferences)) assert.equal(await nativeCdp.evaluate(`localStorage.getItem(${JSON.stringify(key)})`), value, 'Migrated preference mismatch: ' + key);
  assert.deepEqual(await audioHashes(nativeCdp), originals);
  const targetIdentity = await identity(nativeCdp, users[0].id);
  assert.equal(targetIdentity.extractable, false); assert.equal(targetIdentity.algorithm, 'ECDH'); assert.notEqual(targetIdentity.id, originalIdentity.id);
  await openConversation(nativeCdp);
  await waitFor(nativeCdp, `Boolean(document.querySelector('.messages')?.innerText.includes(${JSON.stringify(historical)}))`, 'Migrated history did not decrypt');
  const envelopes = await api('/rest/v1/conversation_key_envelopes?conversation_id=eq.' + room + '&recipient_device_id=eq.' + targetIdentity.id + '&select=key_epoch', users[0].headers);
  assert.ok(envelopes.length > 0);
  pass('native authenticated pipe transferred login, exact preferences, both sound hashes and device-encrypted history without a password');
  await sendMessage(nativeCdp, responseText);
  const markerTime = statSync(path.join(profile, 'migration-ready.json')).mtimeMs;
  await stop(native, nativeCdp); nativeCdp = null;
  launchTarget(); nativeCdp = await connect(TARGET_PORT);
  await waitFor(nativeCdp, `Boolean(document.querySelector('.dm-row'))`, 'Restart did not restore the migrated account');
  await openConversation(nativeCdp);
  await waitFor(nativeCdp, `Boolean(document.querySelector('.messages')?.innerText.includes(${JSON.stringify(historical)})&&document.querySelector('.messages')?.innerText.includes(${JSON.stringify(responseText)}))`, 'Restart lost encrypted history');
  assert.equal((await identity(nativeCdp, users[0].id)).id, targetIdentity.id);
  assert.deepEqual(await audioHashes(nativeCdp), originals);
  await sleep(500);
  assert.deepEqual(ownedSourceProcesses(), []);
  assert.equal(statSync(path.join(profile, 'migration-ready.json')).mtimeMs, markerTime, 'Completed migration unnecessarily relaunched source');
  pass('Rust restart retained its non-extractable identity, both custom sounds and all history without reopening Electron');
  await stop(native, nativeCdp); nativeCdp = null;
  launchSource(); sourceCdp = await connect(SOURCE_PORT);
  await waitFor(sourceCdp, `Boolean(document.querySelector('.dm-row'))`, 'Retained source profile not readable');
  await openConversation(sourceCdp);
  await waitFor(sourceCdp, `Boolean(document.querySelector('.messages')?.innerText.includes(${JSON.stringify(responseText)}))`, 'Retained Electron profile cannot decrypt the Rust message');
  assert.equal((await identity(sourceCdp, users[0].id)).id, originalIdentity.id);
  assert.deepEqual(await audioHashes(sourceCdp), originals);
  pass('retained Electron profile kept its original private identity and can decrypt the new Rust message');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.message; throw error;
} finally {
  for (const client of connections) client.close();
  await stop(native); await stop(source);
  // Close only child processes carrying this fixture's unique absolute profile.
  const cleanupCommand = `$verificationRoot = [IO.Path]::GetFullPath($env:HUSH_MIGRATION_CLEANUP_ROOT)
if ([IO.Path]::GetDirectoryName($verificationRoot) -ne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\\') -or -not [IO.Path]::GetFileName($verificationRoot).StartsWith('hush-migration-test-')) { throw 'Unexpected verification root' }
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($verificationRoot) -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try { execFileSync('powershell.exe', ['-NoProfile', '-Command', cleanupCommand], { windowsHide: true, stdio: 'pipe', env: { ...process.env, HUSH_MIGRATION_CLEANUP_ROOT: root } }); } catch {}
  const cleanupErrors = [];
  if (admin) {
    for (const room of rooms) try { await api('/rest/v1/conversations?id=eq.' + room, admin, undefined, 'DELETE'); } catch { cleanupErrors.push('conversation'); }
    for (const user of users) try { await api('/auth/v1/admin/users/' + user.id, admin, undefined, 'DELETE'); } catch { cleanupErrors.push('account'); }
  }
  report.cleanup = cleanupErrors.length === 0;
  const reportPath = path.join(reportDirectory, 'desktop-migration-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  if (process.env.HUSH_KEEP_MIGRATION_FIXTURE !== '1') {
    assert.equal(path.dirname(path.resolve(root)).toLowerCase(), path.resolve(tmpdir()).toLowerCase());
    assert.ok(path.basename(root).startsWith('hush-migration-test-'));
    for (let attempt = 0; attempt < 6; attempt++) {
      try { await rm(root, { recursive: true, force: true }); break; }
      catch { await sleep(500); }
    }
  }
  console.log(report.cleanup ? 'Disposable migration verification accounts and conversations removed' : 'Disposable migration verification cleanup failed');
  if (cleanupErrors.length) throw new Error('Disposable backend cleanup incomplete');
}
