import { rm, mkdir, cp } from "node:fs/promises";
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
await copyPath(join(rootDir, "favicon.ico"), join(publicDir, "favicon.ico"));
await copyPath(join(rootDir, "src"), join(publicDir, "src"));
await copyPath(
  join(rootDir, "node_modules/ua-parser-js"),
  join(publicDir, "node_modules/ua-parser-js")
);
