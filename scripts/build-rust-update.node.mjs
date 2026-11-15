import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rustUpdateManifest } from './build-rust-update.mjs';

test('the Windows channel always names the designated repository and carries the signature contents', () => {
  const manifest = rustUpdateManifest('0.5.66', 'Hush-Rust-Setup-0.5.66-x64.exe', 'c2lnbmF0dXJl', new Date('2026-11-15T00:00:00Z'));
  assert.equal(manifest.platforms['windows-x86_64'].signature, 'c2lnbmF0dXJl');
  assert.equal(manifest.platforms['windows-x86_64'].url, 'https://github.com/DexiAkaStompa/hush/releases/download/rust-preview/Hush-Rust-Setup-0.5.66-x64.exe');
  assert.equal(manifest.version, '0.5.66');
});
test('untrusted filenames and absent signatures never become installer URLs', () => {
  for (const name of ['../installer.exe', 'C:\\installer.exe', 'installer.zip', 'Hush Rust.exe', '.installer.exe']) assert.throws(() => rustUpdateManifest('0.5.66', name, 'c2ln'));
  for (const signature of ['', 'https://example.com/file.sig', '../signature']) assert.throws(() => rustUpdateManifest('0.5.66', 'installer.exe', signature));
});

test('publishing normalizes the actual package and signature before referencing them, and can run twice', async () => {
  const parent = await realpath(tmpdir());
  const folder = await mkdtemp(path.join(parent, 'hush-update-manifest-'));
  try {
    const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    const { productName } = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
    const filename = `Hush-Rust-Setup-${version}-x64.exe`;
    const original = `${productName}_${version}_x64-setup.exe`;
    await writeFile(path.join(folder, original), 'complete signed fixture');
    await writeFile(path.join(folder, original + '.sig'), 'c2ln');
    await writeFile(path.join(folder, filename), 'previous build to replace');
    const script = fileURLToPath(new URL('./build-rust-update.mjs', import.meta.url));
    for (let attempt = 0; attempt < 2; attempt++) execFileSync(process.execPath, [script, folder], { windowsHide: true });
    assert.deepEqual((await readdir(folder)).sort(), [filename, filename + '.sig', 'rust-latest.json'].sort());
    const manifest = JSON.parse(await readFile(path.join(folder, 'rust-latest.json'), 'utf8'));
    assert.equal(new URL(manifest.platforms['windows-x86_64'].url).pathname.split('/').at(-1), filename);
    assert.equal(await readFile(path.join(folder, filename), 'utf8'), 'complete signed fixture');
    assert.equal(await readFile(path.join(folder, filename + '.sig'), 'utf8'), 'c2ln');
  } finally {
    assert.equal(path.dirname(folder), parent);
    assert.match(path.basename(folder), /^hush-update-manifest-/);
    await rm(folder, { recursive: true, force: true });
  }
});
