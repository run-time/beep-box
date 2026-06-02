import { mkdir, rm, cp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const publicDir = join(rootDir, "public");

async function copyPath(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}

await rm(publicDir, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });

await copyPath(join(rootDir, "index.html"), join(publicDir, "index.html"));
await copyPath(join(rootDir, "src"), join(publicDir, "src"));
await copyPath(join(rootDir, "src/level-maker"), join(publicDir, "level-maker"));

await copyPath(
  join(rootDir, "node_modules/tone"),
  join(publicDir, "node_modules/tone")
);
await copyPath(
  join(rootDir, "node_modules/@stellarogs/tonejs-instruments"),
  join(publicDir, "node_modules/@stellarogs/tonejs-instruments")
);
await copyPath(
  join(rootDir, "node_modules/ua-parser-js"),
  join(publicDir, "node_modules/ua-parser-js")
);

