import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rustUpdateManifest } from './build-rust-update.mjs';

test('the Windows channel always names the designated repository and carries the signature contents', () => {
  const manifest = rustUpdateManifest('0.5.66', 'Hush Rust Preview_0.5.66_x64-setup.exe', 'c2lnbmF0dXJl', new Date('2026-11-15T00:00:00Z'));
  assert.equal(manifest.platforms['windows-x86_64'].signature, 'c2lnbmF0dXJl');
  assert.equal(manifest.platforms['windows-x86_64'].url, 'https://github.com/DexiAkaStompa/hush/releases/download/rust-preview/Hush%20Rust%20Preview_0.5.66_x64-setup.exe');
  assert.equal(manifest.version, '0.5.66');
});
test('untrusted filenames and absent signatures never become installer URLs', () => {
  for (const name of ['../installer.exe', 'C:\\installer.exe', 'installer.zip']) assert.throws(() => rustUpdateManifest('0.5.66', name, 'c2ln'));
  for (const signature of ['', 'https://example.com/file.sig', '../signature']) assert.throws(() => rustUpdateManifest('0.5.66', 'installer.exe', signature));
});
