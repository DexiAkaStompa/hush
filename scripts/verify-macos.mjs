import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

assert.equal(process.platform, "darwin", "This check requires a macOS runner.");
const require = createRequire(import.meta.url);
const { load } = require("js-yaml");
const { readFileSync } = require("node:fs");
const { version } = require("../package.json");
const release = path.resolve("release");

for (const arch of ["x64", "arm64"]) {
  const app = path.join(release, arch === "arm64" ? "mac-arm64" : "mac", "Hush.app");
  assert.ok(existsSync(app), `Missing ${arch} app bundle.`);
  execFileSync("codesign", ["--verify", "--deep", "--strict", app]);
  const plist = path.join(app, "Contents/Info.plist");
  for (const key of ["NSMicrophoneUsageDescription", "NSCameraUsageDescription"]) {
    assert.ok(execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist], { encoding: "utf8" }).trim());
  }
  for (const ext of ["dmg", "zip"]) assert.ok(existsSync(path.join(release, `Hush-${version}-mac-${arch}.${ext}`)));
  console.log(`Verified signed ${arch} bundle, privacy descriptions, DMG and ZIP.`);
}

// Both architectures must appear in the same updater manifest, without one
// build overwriting the other's metadata.
const metadata = load(readFileSync(path.join(release, "latest-mac.yml"), "utf8"));
assert.equal(metadata.version, version);
for (const arch of ["x64", "arm64"]) {
  const name = `Hush-${version}-mac-${arch}.zip`;
  const entry = metadata.files.find(file => file.url === name);
  assert.ok(entry, `Updater metadata is missing ${arch}.`);
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(path.join(release, name))) hash.update(chunk);
  assert.equal(hash.digest("base64"), entry.sha512, `Updater checksum mismatch for ${arch}.`);
}

const server = createServer();
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const userData = mkdtempSync(path.join(tmpdir(), "hush-macos-smoke-"));
const binary = path.join(release, process.arch === "arm64" ? "mac-arm64" : "mac", "Hush.app/Contents/MacOS/Hush");
const child = spawn(binary, [`--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${userData}`], { stdio: ["ignore", "ignore", "pipe"] });
let output = "";
let launchError;
child.stderr.on("data", data => { output = (output + data).slice(-4000); });
child.on("error", error => { launchError = error; });

async function evaluate(url) {
  const socket = new WebSocket(url);
  try {
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Renderer check timed out.")), 4000);
      socket.addEventListener("message", event => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        clearTimeout(timer);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result?.result?.value === true);
      });
      socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: {
        expression: "location.href === 'hush://app/index.html' && !!document.querySelector('.auth-screen') && !document.querySelector('.app-crash') && typeof window.hushWindow?.setMaterial === 'function'",
        returnByValue: true,
      } }));
    });
  } finally { socket.close(); }
}

try {
  let ready = false;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Packaged app exited early: ${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
      const pages = await response.json();
      const page = pages.find(candidate => candidate.type === "page" && candidate.url === "hush://app/index.html");
      if (page && await evaluate(page.webSocketDebuggerUrl)) { ready = true; break; }
    } catch { /* Retry while the native app and renderer initialize. */ }
    await delay(500);
  }
  assert.ok(ready, `The packaged app did not reach the sign-in screen: ${output}`);
  console.log(`Packaged ${process.arch} app opened its sign-in screen with the sandboxed preload bridge.`);
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await Promise.race([new Promise(resolve => child.once("exit", resolve)), delay(3000)]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await new Promise(resolve => child.once("exit", resolve));
    }
  }
  rmSync(userData, { recursive: true, force: true });
}
