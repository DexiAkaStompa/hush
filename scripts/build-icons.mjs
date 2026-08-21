import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const root = process.cwd();
const source = await readFile(path.join(root, "public", "favicon.svg"));
const outputDirectory = path.join(root, "build");
await mkdir(outputDirectory, { recursive: true });

const pngSizes = [16, 24, 32, 48, 64, 128, 256];
const pngBuffers = await Promise.all(
  pngSizes.map((size) => sharp(source).resize(size, size).png().toBuffer()),
);
await writeFile(path.join(outputDirectory, "icon.png"), await sharp(source).resize(512, 512).png().toBuffer());
await writeFile(path.join(outputDirectory, "icon.ico"), await pngToIco(pngBuffers));
