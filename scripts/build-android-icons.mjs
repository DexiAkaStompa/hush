import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import sharp from "sharp";
const source = await readFile("public/favicon.svg");
for (const [density, size] of Object.entries({
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
})) {
  const dir = `android/app/src/main/res/mipmap-${density}`;
  await mkdir(dir, { recursive: true });
  for (const name of [
    "ic_launcher",
    "ic_launcher_round",
    "ic_launcher_foreground",
  ]) {
    if (name === "ic_launcher_foreground") {
      const canvas = Math.round(size * 2.25);
      await sharp({
        create: {
          width: canvas,
          height: canvas,
          channels: 4,
          background: "#f1f1f2",
        },
      })
        .composite([
          {
            input: await sharp(source).resize(size, size).png().toBuffer(),
            gravity: "centre",
          },
        ])
        .png()
        .toFile(`${dir}/${name}.png`);
    } else
      await sharp(source).resize(size, size).png().toFile(`${dir}/${name}.png`);
  }
}
for (const dir of await readdir("android/app/src/main/res")) {
  if (
    dir === "drawable" ||
    dir.startsWith("drawable-land-") ||
    dir.startsWith("drawable-port-")
  ) {
    await sharp({
      create: { width: 1024, height: 1024, channels: 4, background: "#141517" },
    })
      .composite([
        {
          input: await sharp(source).resize(192, 192).png().toBuffer(),
          gravity: "centre",
        },
      ])
      .png()
      .toFile(`android/app/src/main/res/${dir}/splash.png`);
  }
}
