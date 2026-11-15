import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function rustUpdateManifest(version, filename, signature, date = new Date()) {
  if (!/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(version)) throw new Error('Invalid app version');
  if (typeof filename !== 'string' || filename !== path.basename(filename) || !/^[A-Za-z0-9][A-Za-z0-9_.-]*\.exe$/.test(filename)) throw new Error('Invalid installer filename');
  if (typeof signature !== 'string' || !/^[A-Za-z\d+/]+={0,2}$/.test(signature.trim()) || signature.length > 16_384) throw new Error('Missing updater signature');
  return {
    version, notes: 'Aggiornamento Hush per Windows.', pub_date: date.toISOString(),
    platforms: { 'windows-x86_64': {
      url: `https://github.com/DexiAkaStompa/hush/releases/download/rust-preview/${encodeURIComponent(filename)}`,
      signature: signature.trim(),
    } },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const folder = path.resolve(process.argv[2] || 'src-tauri/target/release/bundle/nsis');
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const { productName } = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
  const files = (await readdir(folder)).filter(file => file.endsWith('.exe'));
  // GitHub replaces spaces in uploaded asset names with dots. Use an ASCII
  // name before publishing so the manifest names the exact downloadable asset.
  const filename = `Hush-Rust-Setup-${version}-x64.exe`;
  const original = `${productName}_${version}_x64-setup.exe`;
  const source = files.includes(original) ? original : filename;
  if (!files.includes(source) || files.some(file => file !== original && file !== filename)) throw new Error('Expected only the current signed Windows installer');
  const signature = await readFile(path.join(folder, source + '.sig'), 'utf8');
  const manifest = rustUpdateManifest(version, filename, signature);
  if (source !== filename) {
    await rename(path.join(folder, source), path.join(folder, filename));
    await rename(path.join(folder, source + '.sig'), path.join(folder, filename + '.sig'));
  }
  await writeFile(path.join(folder, 'rust-latest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('Signed Windows update manifest created.');
}
