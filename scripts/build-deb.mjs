import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as tar from "tar";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const unpacked = join(root, "release", "linux-unpacked");
const work = join(root, "release", ".deb-build");
const data = join(work, "data");
const control = join(work, "control");
const output = join(root, "release", `Hush-${pkg.version}.deb`);

if (!existsSync(unpacked)) throw new Error("linux-unpacked non trovato: esegui electron-builder --linux dir prima del builder .deb.");
rmSync(work, { recursive: true, force: true });
rmSync(output, { force: true });
mkdirSync(join(data, "opt", "hush"), { recursive: true });
mkdirSync(join(data, "usr", "share", "applications"), { recursive: true });
mkdirSync(join(data, "usr", "share", "icons", "hicolor", "512x512", "apps"), { recursive: true });
mkdirSync(control, { recursive: true });
cpSync(unpacked, join(data, "opt", "hush"), { recursive: true });
cpSync(join(root, "build", "icon.png"), join(data, "usr", "share", "icons", "hicolor", "512x512", "apps", "hush.png"));
const executableName = ["hush", "Hush", "hush-private-space"].find((name) => existsSync(join(unpacked, name)));
if (!executableName) throw new Error("Binario Linux Electron non trovato in linux-unpacked.");
writeFileSync(join(data, "usr", "share", "applications", "hush.desktop"), [
  "[Desktop Entry]",
  "Name=Hush",
  "Comment=Spazio privato per messaggi e chiamate",
  `Exec=/opt/hush/${executableName} %U`,
  "Icon=hush",
  "Terminal=false",
  "Type=Application",
  "Categories=Network;Chat;",
  "MimeType=x-scheme-handler/hush;",
  "StartupWMClass=Hush",
  "", 
].join("\n"));
const binaryPath = join(data, "opt", "hush", executableName);
if (existsSync(binaryPath)) chmodSync(binaryPath, 0o755);
const controlText = [
  `Package: hush`,
  `Version: ${pkg.version}`,
  "Section: net",
  "Priority: optional",
  "Architecture: amd64",
  `Maintainer: ${pkg.author.name} <${pkg.author.email}>`,
  `Homepage: ${pkg.homepage}`,
  "Description: Spazio privato Hush",
  " Applicazione desktop per messaggi, chiamate e condivisione multimediale.",
  "",
].join("\n");
writeFileSync(join(control, "control"), controlText);
await tar.c({
  cwd: control,
  file: join(work, "control.tar.gz"),
  gzip: true,
  portable: true,
}, ["."]);
await tar.c({
  cwd: data,
  file: join(work, "data.tar.gz"),
  gzip: true,
  portable: true,
  onWriteEntry(entry) {
    if (entry.path.endsWith(`opt/hush/${executableName}`)) {
      entry.mode = 0o755;
      entry.stat.mode = 0o755;
    } else if (entry.path.endsWith("opt/hush/chrome-sandbox")) {
      entry.mode = 0o4755;
      entry.stat.mode = 0o4755;
    }
  },
}, ["."]);

function arEntry(name, buffer, mode = "100644") {
  const header = `${name}/`.padEnd(16, " ")
    + `${Math.floor(Date.now() / 1000)}`.padEnd(12, " ")
    + "0".padEnd(6, " ")
    + "0".padEnd(6, " ")
    + mode.padEnd(8, " ")
    + `${buffer.length}`.padEnd(10, " ")
    + "`\n";
  const body = buffer.length % 2 === 0 ? buffer : Buffer.concat([buffer, Buffer.from("\n")]);
  return Buffer.concat([Buffer.from(header), body]);
}

const archive = Buffer.concat([
  Buffer.from("!<arch>\n"),
  arEntry("debian-binary", Buffer.from("2.0\n")),
  arEntry("control.tar.gz", readFileSync(join(work, "control.tar.gz"))),
  arEntry("data.tar.gz", readFileSync(join(work, "data.tar.gz"))),
]);
writeFileSync(output, archive);
console.log(`Created ${output}`);
