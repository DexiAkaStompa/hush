// Opt-in Windows diagnostic using a disposable profile and the existing local Vite server.
// Compares the real native Low/Normal policy; never suspends or trims a process.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {mkdir,mkdtemp,realpath,rm,writeFile,readdir,readFile} from 'node:fs/promises';
import {createServer as createNetServer} from 'node:net';
import {createServer as createHttpServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {promisify} from 'node:util';
const createServer=createNetServer;
const execute=promisify(execFile);
const project=fileURLToPath(new URL('../',import.meta.url));
assert.equal(process.platform,'win32','Windows-only memory diagnostic.');
assert.equal(process.env.HUSH_RUN_MEMORY_CHECK,'1','Set HUSH_RUN_MEMORY_CHECK=1 to launch the isolated diagnostic.');
const binary=path.resolve(process.argv[2]||path.join(project,'src-tauri/target/debug/hush-desktop.exe'));
assert.ok((await import('node:fs')).existsSync(binary),'Build the Rust DEBUG runtime first.');
const outputDirectory=path.resolve(process.argv[3]||path.join(project,'release-rust-memory-check'));
await mkdir(outputDirectory,{recursive:true});
const output=path.join(outputDirectory,'memory-policy-report.json');
const report={status:'running',measuredAt:new Date().toISOString(),scope:'Windows DEBUG Rust runtime with real Hush sign-in UI served by Vite, fresh profile, same process tree in each phase. Background-memory-policy test; not release absolute RAM or active-call memory.',method:{samples:5,sampleSpacingMilliseconds:1000,settleMilliseconds:7000,workingSet:'Sum of Win32_Process.WorkingSetSize across complete owned process tree; shared pages may be counted more than once.',privateResident:'GetProcessMemoryInfo PROCESS_MEMORY_COUNTERS_EX2.PrivateWorkingSetSize, only owned PIDs; joined by process creation timestamp. Private physical resident pages exclude shared-page double counting.',privateCommit:'Sum of Win32_Process.PrivatePageCount; private committed memory is not necessarily resident RAM.',control:'Minimized Normal uses only synthetic native call guard: no microphone, WebRTC call, media allocation, forced GC or process working-set manipulation.'},phases:[],checks:{}};
const PRIVATE_RESIDENT_COUNTER = "using System;using System.Runtime.InteropServices;public static class HushPrivateResident{[StructLayout(LayoutKind.Sequential)]public struct Counters{public uint cb,PageFaultCount;public UIntPtr PeakWorkingSetSize,WorkingSetSize,QuotaPeakPagedPoolUsage,QuotaPagedPoolUsage,QuotaPeakNonPagedPoolUsage,QuotaNonPagedPoolUsage,PagefileUsage,PeakPagefileUsage,PrivateUsage,PrivateWorkingSetSize;public ulong SharedCommitUsage;}public sealed class Reading{public ulong Bytes;public long CreatedMilliseconds;public int StructureSize;}[DllImport(\"kernel32.dll\",SetLastError=true)]private static extern IntPtr OpenProcess(uint access,bool inherit,uint id);[DllImport(\"kernel32.dll\")]private static extern bool CloseHandle(IntPtr h);[DllImport(\"psapi.dll\",SetLastError=true)]private static extern bool GetProcessMemoryInfo(IntPtr h,ref Counters counts,uint size);[DllImport(\"kernel32.dll\")]private static extern bool GetProcessTimes(IntPtr h,out long created,out long ended,out long kernel,out long user);public static Reading Read(uint id){var h=OpenProcess(0x1000,false,id);if(h==IntPtr.Zero)return null;try{var value=new Counters();value.cb=(uint)Marshal.SizeOf(typeof(Counters));if(!GetProcessMemoryInfo(h,ref value,value.cb))return null;long created,ended,kernel,user;if(!GetProcessTimes(h,out created,out ended,out kernel,out user))return null;return new Reading{Bytes=value.PrivateWorkingSetSize.ToUInt64(),CreatedMilliseconds=new DateTimeOffset(DateTime.FromFileTimeUtc(created)).ToUnixTimeMilliseconds(),StructureSize=(int)value.cb};}finally{CloseHandle(h);}}}";

// Read only process metadata needed for ownership and memory accounting. Full
// command lines remain in memory and are not included in the saved report.
async function processes() {
  const script = `$ErrorActionPreference='Stop';Add-Type -TypeDefinition '${PRIVATE_RESIDENT_COUNTER}';$all=@(Get-CimInstance Win32_Process);$owned=@{};$rootId=${running()?child.pid:0};$rootProcess=$all|Where-Object ProcessId -eq $rootId|Select-Object -First 1;if($rootProcess -and $rootProcess.Name -eq 'hush-desktop.exe'){$owned[[int]$rootId]=$true;$changed=$true;while($changed){$changed=$false;foreach($item in $all){if($owned.ContainsKey([int]$item.ParentProcessId) -and -not $owned.ContainsKey([int]$item.ProcessId)){$owned[[int]$item.ProcessId]=$true;$changed=$true;}}}};@($all|ForEach-Object{$resident=$null;if($owned.ContainsKey([int]$_.ProcessId)){$resident=[HushPrivateResident]::Read([uint32]$_.ProcessId)};[PSCustomObject]@{pid=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;name=[string]$_.Name;working=[string]$_.WorkingSetSize;private=[string]$_.PrivatePageCount;residentPrivate=$(if($resident){$resident.Bytes}else{$null});residentCreated=$(if($resident){$resident.CreatedMilliseconds}else{$null});counterSize=$(if($resident){$resident.StructureSize}else{$null});created=$(if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('O')}else{''});command=[string]$_.CommandLine}})|ConvertTo-Json -Compress`;
  const { stdout } = await execute("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout.replace(/^\uFEFF/, ""));
  return Array.isArray(parsed) ? parsed : [parsed];
}

function tree(snapshot, root) {
  const result = snapshot.filter(process => process.pid === root);
  const included = new Set(result.map(process => process.pid));
  for (let index = 0; index < result.length; index++) {
    for (const process of snapshot) {
      if (!included.has(process.pid) && process.parent === result[index].pid && process.created >= result[0].created) {
        result.push(process); included.add(process.pid);
      }
    }
  }
  return result;
}

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

class Devtools {
  constructor(socket) {
    this.socket = socket; this.sequence = 0; this.pending = new Map();
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result);
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("Renderer debugger disconnected.")); }
      this.pending.clear();
    });
  }
  static async open(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error("Debugger connection timed out.")); }, 5000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); socket.close(); reject(new Error("Debugger connection failed.")); }, { once: true });
    });
    return new Devtools(socket);
  }
  send(method, params = {}, milliseconds = 5000) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out.`)); }, milliseconds);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { this.pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  }
  close() { this.socket.close(); }
}

async function removeOwnedDirectory(directory, parent) {
  assert.equal(path.dirname(directory), parent, "Refusing deletion outside the owned temporary parent.");
  assert.match(path.basename(directory), /^hush-rust-memory-[A-Za-z0-9]+$/, "Refusing deletion of an unowned profile directory.");
  assert.equal(await realpath(directory), directory, "Refusing to follow a changed temporary directory.");
  await rm(directory, { recursive: true, force: true, maxRetries: 25, retryDelay: 100 });
}

// A tiny loopback WebSocket echo checks actual packets, not just an increasing
// JavaScript counter. This server accepts only this test's short masked frames.
async function echoServer() {
  const sockets = new Set();
  const server = createHttpServer();
  server.on('upgrade', (request, socket, initial) => {
    if (request.url !== '/memory-policy' || typeof request.headers['sec-websocket-key'] !== 'string') { socket.destroy(); return; }
    const key = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + key + '\r\n\r\n');
    sockets.add(socket);
    let input = Buffer.alloc(0);
    function receive(bytes) {
      input = Buffer.concat([input, bytes]);
      if (input.length > 4096) { socket.destroy(); return; }
      while (input.length >= 2) {
        const opcode = input[0] & 15;
        const length = input[1] & 127;
        if (length > 125 || !(input[1] & 128)) { socket.destroy(); return; }
        if (input.length < length + 6) return;
        const mask = input.subarray(2, 6), payload = Buffer.from(input.subarray(6, 6 + length));
        input = input.subarray(6 + length);
        for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];
        if (opcode === 8) { socket.end(); return; }
        if (opcode !== 1 && opcode !== 9) { socket.destroy(); return; }
        socket.write(Buffer.concat([Buffer.from([opcode === 9 ? 0x8a : 0x81, payload.length]), payload]));
      }
    }
    socket.on('data', receive); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    if (initial.length) receive(initial);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { port: server.address().port, close: async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}

// Refuse a release binary before launch: release ignores isolation overrides
// and could otherwise discover a real account/profile. Scan with bounded memory.
const requiredDebugHooks=new Set(['HUSH_RUST_TEST_DATA_DIR','HUSH_RUST_TEST_ALLOW_MULTI_INSTANCE','HUSH_RUST_TEST_MIGRATION_MARKER']);
let hookTail=Buffer.alloc(0);
for await (const chunk of createReadStream(binary,{highWaterMark:65536})){
  const bytes=Buffer.concat([hookTail,chunk]);
  for(const name of requiredDebugHooks)if(bytes.includes(Buffer.from(name)))requiredDebugHooks.delete(name);
  if(!requiredDebugHooks.size)break;
  hookTail=bytes.subarray(Math.max(0,bytes.length-128));
}
assert.equal(requiredDebugHooks.size,0,'The memory diagnostic requires a DEBUG binary with isolated fixture hooks; release was not launched.');

const temporaryParent = await realpath(tmpdir());
const directory = await realpath(await mkdtemp(path.join(temporaryParent, 'hush-rust-memory-')));
const profile = path.join(directory, 'browser');
await mkdir(profile);
const port = await reservePort();
const echo = await echoServer();
const environment = { ...process.env,
  HUSH_RUST_TEST_URL: 'http://127.0.0.1:5173/',
  HUSH_RUST_TEST_DATA_DIR: profile,
  HUSH_RUST_TEST_BROWSER_ARGS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
  HUSH_RUST_TEST_ALLOW_MULTI_INSTANCE: '1',
  HUSH_RUST_TEST_WINDOW_TITLE: 'Hush memory policy ' + randomUUID(),
  // This absent debug marker disables discovering/migrating any real account.
  HUSH_RUST_TEST_MIGRATION_MARKER: path.join(directory, 'no-migration-marker.json'),
};
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
delete environment.WEBVIEW2_USER_DATA_FOLDER;
const launchedAt = new Date(Date.now() - 1000).toISOString();
const child = spawn(binary, [], { cwd: project, env: environment, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '', launchError;
child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-3000); });
child.on('error', error => { launchError = error; });
const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
const running = () => child.pid && child.exitCode === null && child.signalCode === null && !launchError;
let devtools;
const seen = new Map();

async function waitFor(check, message, milliseconds = 15000) {
  const deadline = Date.now() + milliseconds;
  let error;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (!running()) throw new Error('The owned Rust app exited early: ' + (child.exitCode ?? child.signalCode));
    try { const value = await check(); if (value) return value; } catch (failure) { error = failure; }
    await delay(100);
  }
  throw new Error(message + (error ? ': ' + error.message : ''));
}
async function waitForExit(milliseconds) {
  let timer;
  try { return await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => resolve(null), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
function remember(snapshot) {
  const root = snapshot.find(process => process.pid === child.pid && process.name.toLowerCase() === 'hush-desktop.exe' && process.created >= launchedAt);
  const owned = root && running() ? tree(snapshot, child.pid) : [];
  for (const process of snapshot) {
    if (process.created >= launchedAt && process.name.toLowerCase() === 'msedgewebview2.exe' && process.command.includes(profile)) {
      for (const descendant of tree(snapshot, process.pid)) if (!owned.some(item => item.pid === descendant.pid)) owned.push(descendant);
    }
  }
  for (const process of owned) seen.set(process.pid, process.created);
  return owned;
}
const status = () => devtools.evaluate(`window.__TAURI_INTERNALS__.invoke('native_get_memory_status')`);
const heartbeat = () => devtools.evaluate(`({ticks:window.__memoryProbe.ticks,sent:window.__memoryProbe.sent,received:window.__memoryProbe.received,hidden:document.hidden,ready:window.__memoryProbe.socket.readyState})`);

async function guard(active) {
  await devtools.evaluate(`window.hushWindow.setCallActive(${active})`);
}
async function waitTarget(target, active) {
  return waitFor(async () => {
    const current = await status();
    return current.supported === true && current.callActive === active && current.requestedTarget === target && current.appliedTarget === target && current;
  }, `WebView2 did not accept ${target} for call guard ${active}`);
}

async function phase(name, expectedTarget, active) {
  await waitTarget(expectedTarget, active);
  const before = await heartbeat();
  await delay(report.method.settleMilliseconds);
  const samples = [];
  const start = Date.now();
  for (let sample = 0; sample < report.method.samples; sample++) {
    if (sample) await delay(Math.max(0, start + sample * report.method.sampleSpacingMilliseconds - Date.now()));
    const snapshot = remember(await processes());
    assert.ok(snapshot.some(process => process.pid === child.pid));
    assert.ok(snapshot.every(process=>process.residentPrivate!==null&&process.counterSize===96&&process.residentCreated===Date.parse(process.created)), 'The private-resident counter did not match every owned process identity.');
    const rows = snapshot.map(process => ({ pid: process.pid, parent: process.parent, name: process.name, workingSetBytes: Number(process.working), privateCommitBytes: Number(process.private), privateWorkingSetBytes:Number(process.residentPrivate) }));
    samples.push({ sampledAt: new Date().toISOString(), workingSetBytes: rows.reduce((sum, process) => sum + process.workingSetBytes, 0), privateCommitBytes: rows.reduce((sum, process) => sum + process.privateCommitBytes, 0), privateWorkingSetBytes:rows.reduce((sum,process)=>sum+process.privateWorkingSetBytes,0), processes: rows });
  }
  const after = await heartbeat();
  assert.ok(after.ticks > before.ticks + 1, 'JavaScript timers stopped while backgrounded.');
  assert.ok(after.sent > before.sent + 1 && after.received > before.received + 1, 'Loopback WebSocket packet exchange stopped while backgrounded.');
  assert.equal(after.ready, 1, 'The WebSocket connection was closed.');
  const result = { name, policy: await waitTarget(expectedTarget, active), before, after, samples,
    medianWorkingSetBytes: median(samples.map(sample => sample.workingSetBytes)), medianPrivateWorkingSetBytes:median(samples.map(sample=>sample.privateWorkingSetBytes)), medianPrivateCommitBytes: median(samples.map(sample => sample.privateCommitBytes)) };
  report.phases.push(result);
  console.log(JSON.stringify({ phase: name, policy: result.policy, workingSetMiB: result.medianWorkingSetBytes / 1048576, privateResidentMiB:result.medianPrivateWorkingSetBytes/1048576, privateCommitMiB: result.medianPrivateCommitBytes / 1048576, timersAdvanced: after.ticks - before.ticks, packetsEchoed: after.received - before.received }));
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  return result;
}

let nativeHandle;
async function ownedWindowState(restore = false) {
  // The Rust bridge deliberately exposes no testing-only restore command. Use
  // the OS handle belonging to the exact process we launched, never a title
  // search or another Hush instance that parallel verification may be using.
  const script = `$ErrorActionPreference='Stop'; Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class HushMemoryWindow{[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint id);[DllImport("user32.dll")]public static extern bool ShowWindowAsync(IntPtr h,int command);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern IntPtr FindWindow(string cls,string title);[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,System.Text.StringBuilder text,int count);[DllImport("user32.dll")]public static extern bool IsIconic(IntPtr h);[DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);}'; $process=[Diagnostics.Process]::GetProcessById(${child.pid});$process.Refresh();$known=[long]${nativeHandle||0};if($known -ne 0){$handle=[IntPtr]::new($known);$exactTitle=$true}else{$handle=[HushMemoryWindow]::FindWindow($null,'${environment.HUSH_RUST_TEST_WINDOW_TITLE}');$exactTitle=$handle -ne [IntPtr]::Zero;if(-not $exactTitle){$handle=$process.MainWindowHandle;}}if($handle -eq [IntPtr]::Zero){throw 'Owned app window unavailable'};$owner=[uint32]0;[void][HushMemoryWindow]::GetWindowThreadProcessId($handle,[ref]$owner);if($owner -ne ${child.pid}){throw 'Window ownership changed'};$focused=$false;${restore ? '[void][HushMemoryWindow]::ShowWindowAsync($handle,9);$focused=[HushMemoryWindow]::SetForegroundWindow($handle);Start-Sleep -Milliseconds 150;' : ''}$title=New-Object System.Text.StringBuilder 256;[void][HushMemoryWindow]::GetWindowText($handle,$title,256);[PSCustomObject]@{owned=$true;handle=$handle.ToInt64();exactTitle=$exactTitle;title=$title.ToString();focusRequested=$focused;minimized=[HushMemoryWindow]::IsIconic($handle);visible=[HushMemoryWindow]::IsWindowVisible($handle)}|ConvertTo-Json -Compress`;
  const { stdout } = await execute('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000 });
  const value=JSON.parse(stdout.replace(/^\uFEFF/, '')); if(value.title===environment.HUSH_RUST_TEST_WINDOW_TITLE) nativeHandle=value.handle; return value;
}

try {
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
    const pages = response.ok ? await response.json() : [];
    const page = pages.find(page => page.type === 'page' && page.url.startsWith('http://127.0.0.1:5173/'));
    if (!page) return false;
    devtools = await Devtools.open(page.webSocketDebuggerUrl); return true;
  }, 'Owned Rust debugger did not open.', 30000);
  await waitFor(() => devtools.evaluate(`Boolean(document.querySelector('.auth-screen form') && typeof window.hushWindow?.setCallActive === 'function' && !document.querySelector('.app-crash'))`), 'Original sign-in UI or memory bridge did not load.');
  const owned = remember(await processes());
  assert.ok(owned.some(process => process.name.toLowerCase() === 'msedgewebview2.exe' && process.command.includes(profile)));
  assert.ok((await readdir(profile)).length > 0);
  report.checks.isolatedTemporaryProfile = true;
  report.renderer = await devtools.evaluate(`({origin:location.origin,width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.theme,userAgent:navigator.userAgent})`);
  // Wry mirrors the document title after navigation, overriding builder.title.
  // Change it in this disposable renderer, then require the exact owned HWND.
  await devtools.evaluate('document.title=' + JSON.stringify(environment.HUSH_RUST_TEST_WINDOW_TITLE) + ';true');
  await delay(250);
  report.initialWindow = await waitFor(async()=>{const value=await ownedWindowState();return value.title===environment.HUSH_RUST_TEST_WINDOW_TITLE&&value;},'The native app window title was not identified.');
  console.log(JSON.stringify({ nativeWindow: report.initialWindow }));
  await devtools.evaluate(`new Promise((resolve,reject)=>{const probe=window.__memoryProbe={ticks:0,sent:0,received:0,socket:new WebSocket('ws://127.0.0.1:${echo.port}/memory-policy')};probe.socket.onopen=()=>{probe.timer=setInterval(()=>{probe.ticks++;if(probe.socket.readyState===WebSocket.OPEN)probe.socket.send(String(++probe.sent));},250);resolve(true)};probe.socket.onmessage=()=>probe.received++;probe.socket.onerror=()=>reject(new Error('Loopback WebSocket failed'));setTimeout(()=>reject(new Error('Loopback WebSocket timed out')),5000);})`);
  await guard(true);
  await phase('visible-normal-control', 'normal', true);
  await devtools.evaluate('window.hushWindow.minimize();true');
  await waitFor(async () => { const current = await status(); return (!current.focused || current.minimized) && current; }, 'Minimization did not update native window activity.');
  report.minimizedWindow = await ownedWindowState();
  assert.equal(report.minimizedWindow.minimized, true, 'The original minimize button did not minimize the owned OS window.');
  const normal = await phase('minimized-normal-control', 'normal', true);
  await guard(false);
  const low = await phase('minimized-low', 'low', false);
  report.checks.timersAndWebSocketContinueInLow = true;
  report.backgroundComparison = { normalPrivateResidentMiB:normal.medianPrivateWorkingSetBytes/1048576, lowPrivateResidentMiB:low.medianPrivateWorkingSetBytes/1048576, privateResidentReductionPercent:100*(1-low.medianPrivateWorkingSetBytes/normal.medianPrivateWorkingSetBytes), normalWorkingSetMiB: normal.medianWorkingSetBytes / 1048576, lowWorkingSetMiB: low.medianWorkingSetBytes / 1048576, workingSetReductionPercent: 100 * (1 - low.medianWorkingSetBytes / normal.medianWorkingSetBytes), normalPrivateCommitMiB: normal.medianPrivateCommitBytes / 1048576, lowPrivateCommitMiB: low.medianPrivateCommitBytes / 1048576, privateCommitReductionPercent: 100 * (1 - low.medianPrivateCommitBytes / normal.medianPrivateCommitBytes) };
  await guard(true);
  await phase('minimized-call-guard-normal', 'normal', true);
  report.checks.activeCallGuardOverridesLowWhileHidden = true;
  report.restore = await ownedWindowState(true);
  assert.equal(report.restore.minimized, false, 'The owned OS window did not restore.');
  await guard(false);
  const restored = await status();
  if (restored.focused && !restored.minimized) await waitTarget('normal', false);
  else report.restore.focusHeldByAnotherWindow = true;
  const reacted = await devtools.evaluate(`(()=>{const input=document.querySelector('.auth-screen input');const before=input.value;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'memory_restore_probe');input.dispatchEvent(new Event('input',{bubbles:true}));return input.value==='memory_restore_probe';})()`);
  assert.equal(reacted, true, 'Restored sign-in UI did not respond.');
  report.checks.restoreUiResponds = true;
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.message;
  if (stderr) report.nativeStderr = stderr;
  throw error;
} finally {
  if (running()) {
    try { await devtools?.evaluate('clearInterval(window.__memoryProbe?.timer);window.__memoryProbe?.socket.close();window.hushWindow?.close();true'); } catch { /* Native close disconnects its own debugger. */ }
    await waitForExit(5000);
  }
  devtools?.close();
  let snapshot = await processes();
  remember(snapshot);
  for (const [pid, created] of seen) {
    if (!snapshot.some(process => process.pid === pid && process.created === created)) continue;
    await execute('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }).catch(() => undefined);
    snapshot = await processes();
  }
  assert.equal(snapshot.filter(process => seen.get(process.pid) === process.created).length, 0, 'An owned process survived cleanup.');
  await echo.close();
  await removeOwnedDirectory(directory, temporaryParent);
  report.checks.ownedProcessesAndTemporaryProfileRemoved = true;
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, backgroundComparison: report.backgroundComparison, checks: report.checks, report: output }));
}
