// Local, opt-in Windows integration check. Only a uniquely titled synthetic
// Hush test window may be selected. Media bytes are never saved or transmitted.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

assert.equal(process.platform, "win32", "This capture check requires Windows.");
assert.equal(process.env.HUSH_RUN_RUST_CAPTURE_CHECK, "1", "Set HUSH_RUN_RUST_CAPTURE_CHECK=1 to test a synthetic window and two seconds of local audio levels.");
const project = fileURLToPath(new URL("../", import.meta.url));
const executable = path.resolve(process.argv[2] || path.join(project, "src-tauri/target/debug/hush-desktop.exe"));
const output = path.resolve(process.argv[3] || path.join(project, "release-rust-capture-check"));
assert.ok(existsSync(executable), "Build the debug executable with --features custom-protocol first.");
await mkdir(output, { recursive: true });
const title = `HushCaptureFixture-${randomUUID()}`;
const server = createServer();
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const port = server.address().port;
await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
const temporaryParent = await realpath(tmpdir());
const profile = await realpath(await mkdtemp(path.join(temporaryParent, "hush-capture-fixture-")));
const child = spawn(executable, [], {
  cwd: project, windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
  env: {
    ...process.env,
    HUSH_RUST_TEST_WINDOW_TITLE: title,
    HUSH_RUST_TEST_DATA_DIR: profile,
    // These switches are confined to this isolated debug test. The product
    // always keeps its user-controlled source picker and audio checkbox.
    HUSH_RUST_TEST_BROWSER_ARGS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1 --auto-select-window-capture-source-by-title=${title} --system-audio-capture-default_checked --autoplay-policy=no-user-gesture-required`,
  },
});
let stderr = "", launchFailure;
child.stderr.on("data", value => { stderr = (stderr + value).slice(-4000); });
child.on("error", error => { launchFailure = error; });
const exited = new Promise(resolve => child.once("exit", resolve));
const running = () => Boolean(child.pid) && !launchFailure && child.exitCode === null && child.signalCode === null;
let socket, nextId = 0;
const requests = new Map();
const execute = promisify(execFile);
const report = {
  status: "running", source: "isolated-synthetic-window", windowTitle: title,
  autoSelectionForDebugTestOnly: true, audioCheckboxCheckedForDebugTestOnly: true,
  productPickerUiVerified: false, mediaRecordedOrTransmitted: false,
};

function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error(`${method} timed out.`)); }, 20000);
    requests.set(id, { resolve, reject, timer });
    try { socket.send(JSON.stringify({ id, method, params })); }
    catch (error) { clearTimeout(timer); requests.delete(id); reject(error); }
  });
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(check, message, milliseconds = 20000) {
  const deadline = Date.now() + Math.min(milliseconds, 60000);
  while (Date.now() < deadline) {
    if (launchFailure) throw launchFailure;
    if (!running()) throw new Error("The isolated capture app exited early.");
    if (await check()) return;
    await delay(150);
  }
  throw new Error(message);
}
async function waitForExit(milliseconds) {
  let timer;
  try { await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, milliseconds); })]); }
  finally { clearTimeout(timer); }
}

async function measureSyntheticCapture() {
  const result = { runtime: navigator.userAgent, origin: location.origin };
  const timeout = milliseconds => new Promise(resolve => setTimeout(() => resolve({ timeout: true }), milliseconds));
  const fixture = document.createElement("div");
  Object.assign(fixture.style, { position: "fixed", inset: "0", zIndex: "2147483647", backgroundColor: "rgb(10, 200, 90)", display: "grid", placeItems: "start center", color: "black", padding: "40px", font: "24px sans-serif" });
  fixture.textContent = "Hush — synthetic local capture verification";
  document.body.append(fixture);
  // Give the compositor time to replace the complete app content with the
  // synthetic fixture before requesting capture of that same native window.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  let stream, context, oscillator, reader, canceled = false;
  try {
    const acquisition = navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } },
      audio: { autoGainControl: false, echoCancellation: false, noiseSuppression: false, channelCount: 2, restrictOwnAudio: false, suppressLocalAudioPlayback: false },
      systemAudio: "include", windowAudio: "system", selfBrowserSurface: "include",
    }).then(value => {
      if (canceled) value.getTracks().forEach(track => track.stop());
      return { stream: value };
    }).catch(error => ({ error: { name: error.name, message: error.message } }));
    const acquired = await Promise.race([acquisition, timeout(12000)]);
    if (acquired.timeout) throw new Error("Window selection did not complete. No permission UI was automated.");
    if (acquired.error) throw new Error(`${acquired.error.name}: ${acquired.error.message}`);
    stream = acquired.stream;
    globalThis.__hushSyntheticCaptureStream = stream;
    const video = stream.getVideoTracks()[0];
    if (!video || video.getSettings().displaySurface !== "window") throw new Error("Refusing a capture source that is not a window.");
    if (typeof MediaStreamTrackProcessor !== "function") throw new Error("Cannot verify a real captured frame on this runtime.");
    const processor = new MediaStreamTrackProcessor({ track: video, maxBufferSize: 1 });
    reader = processor.readable.getReader();
    const first = await Promise.race([reader.read(), timeout(3000)]);
    if (first.timeout || first.done) throw new Error("No native capture video frame arrived.");
    const frame = first.value;
    try {
      const pixel = new Uint8Array(4);
      await frame.copyTo(pixel, { format: "RGBA", rect: { x: Math.floor(frame.codedWidth / 2), y: Math.floor(frame.codedHeight / 2), width: 1, height: 1 } });
      if (Math.abs(pixel[0] - 10) > 15 || Math.abs(pixel[1] - 200) > 15 || Math.abs(pixel[2] - 90) > 15) throw new Error("The captured frame does not show the synthetic test window.");
      result.video = { actualFrameReceived: true, syntheticWindowPixelMatches: true, width: frame.displayWidth, height: frame.displayHeight, displaySurface: "window" };
    } finally { frame.close(); }
    const tracks = stream.getAudioTracks();
    if (!tracks.length) throw new Error("The selected window did not provide a system audio track.");
    context = new AudioContext(); await context.resume();
    const gain = context.createGain(); gain.gain.value = 0.02;
    oscillator = context.createOscillator(); oscillator.frequency.value = 911;
    oscillator.connect(gain).connect(context.destination); oscillator.start();
    const analyser = context.createAnalyser(); analyser.fftSize = 4096;
    context.createMediaStreamSource(new MediaStream(tracks)).connect(analyser);
    const samples = new Float32Array(analyser.fftSize), bins = new Float32Array(analyser.frequencyBinCount);
    let peakRms = 0, peakToneDb = -Infinity;
    for (let index = 0; index < 20; index++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      analyser.getFloatTimeDomainData(samples); analyser.getFloatFrequencyData(bins);
      let energy = 0; for (const sample of samples) energy += sample * sample;
      peakRms = Math.max(peakRms, Math.sqrt(energy / samples.length));
      peakToneDb = Math.max(peakToneDb, bins[Math.round(911 / context.sampleRate * analyser.fftSize)]);
    }
    if (peakRms <= 0.0001 || peakToneDb <= -80) throw new Error("The local test tone was not present in captured system audio.");
    result.audio = { trackCount: tracks.length, sampleRate: tracks[0].getSettings().sampleRate, nonzeroLoopback: true, localTestToneDetected: true, peakRms, peakToneDb };
    return result;
  } finally {
    canceled = true; oscillator?.stop();
    if (context) await context.close();
    if (reader) await reader.cancel().catch(() => undefined);
    stream?.getTracks().forEach(track => track.stop());
    delete globalThis.__hushSyntheticCaptureStream;
    fixture.remove();
  }
}

let failure;
try {
  await waitFor(async () => {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
      const page = pages.find(page => page.type === "page" && page.url.startsWith("https://tauri.localhost"));
      if (!page) return false;
      socket = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.close(); reject(new Error("Debugger connection timed out.")); }, 5000);
        socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
        socket.addEventListener("error", () => { clearTimeout(timer); socket.close(); reject(new Error("Debugger connection failed.")); }, { once: true });
      });
      return true;
    } catch { return false; }
  }, "Build a debug custom-protocol executable with test hooks enabled.", 45000);
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data), request = requests.get(message.id);
    if (!request) return;
    requests.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  socket.addEventListener("close", () => {
    for (const request of requests.values()) { clearTimeout(request.timer); request.reject(new Error("Renderer closed.")); }
    requests.clear();
  });
  await waitFor(() => evaluate("Boolean(document.querySelector('.auth-screen') && window.hushWindow && [...document.querySelectorAll('input')].every(input => !input.value))"), "The isolated blank sign-in fixture did not become ready.");
  // Read only our process's title; never select an existing user's app window.
  const nativeTitle = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${child.pid}).MainWindowTitle`], { windowsHide: true, timeout: 10000 });
  assert.equal(nativeTitle.stdout.trim(), title, "The executable did not apply its unique debug-only window title. Capture was not attempted.");
  Object.assign(report, await evaluate(`(${measureSyntheticCapture.toString()})()`));
  assert.equal(report.origin, "https://tauri.localhost");
  report.status = "passed";
} catch (error) {
  failure = error; report.status = "failed"; report.error = error.message;
  if (stderr) report.nativeStderr = stderr;
} finally {
  try { if (socket) await evaluate("globalThis.__hushSyntheticCaptureStream?.getTracks().forEach(track => track.stop()); window.hushWindow?.close(); true"); } catch { /* Closing the window closes the debugger too. */ }
  socket?.close();
  if (running()) await waitForExit(3000);
  if (running()) {
    await execute("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 10000 }).catch(() => undefined);
    await waitForExit(3000);
  }
  try {
    assert.equal(path.dirname(profile), temporaryParent);
    assert.match(path.basename(profile), /^hush-capture-fixture-[A-Za-z0-9]+$/);
    await rm(profile, { recursive: true, force: true, maxRetries: 15, retryDelay: 100 });
    report.temporaryProfileRemoved = true;
  } catch (error) { failure ||= error; report.status = "failed"; report.cleanupError = error.message; }
  await writeFile(path.join(output, "capture-report.json"), JSON.stringify(report, null, 2) + "\n");
}
if (failure) throw failure;
console.log("PASS real native capture of the isolated synthetic Hush window and local system audio. Debug auto-selection does not verify the product picker UI.");
console.log(`Report: ${path.join(output, "capture-report.json")}`);
