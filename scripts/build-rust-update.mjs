import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function rustUpdateManifest(version, filename, signature, date = new Date()) {
  if (!/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(version)) throw new Error('Invalid app version');
  if (typeof filename !== 'string' || filename !== path.basename(filename) || /[\\/]/.test(filename) || !filename.endsWith('.exe')) throw new Error('Invalid installer filename');
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
  const files = (await readdir(folder)).filter(file => file.endsWith('.exe'));
  if (files.length !== 1) throw new Error('Expected one signed Windows installer');
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const signature = await readFile(path.join(folder, files[0] + '.sig'), 'utf8');
  await writeFile(path.join(folder, 'rust-latest.json'), JSON.stringify(rustUpdateManifest(version, files[0], signature), null, 2) + '\n');
  console.log('Signed Windows update manifest created.');
}
