import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function computeMaxLevelFromSongsDir(songsDir) {
  let entries = [];
  try {
    entries = fs.readdirSync(songsDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  const nums = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const m = /^(\d{4})\.md$/.exec(e.name);
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) continue;
    nums.push(n);
  }

  nums.sort((a, b) => a - b);
  let expected = 1;
  for (const n of nums) {
    if (n !== expected) break;
    expected++;
  }
  return expected - 1;
}

function buildLevelIndexFromSongsDir(songsDir) {
  let entries = [];
  try {
    entries = fs.readdirSync(songsDir, { withFileTypes: true });
  } catch {
    return {};
  }

  const byLevel = new Map();
  for (const e of entries) {
    if (!e.isFile()) continue;
    const m = /^0*(\d+)\.md$/i.exec(e.name);
    if (!m) continue;
    const level = Number(m[1]);
    if (!Number.isFinite(level) || level < 1) continue;
    const existing = byLevel.get(level);
    if (!existing || e.name.length > existing.length) {
      byLevel.set(level, e.name);
    }
  }

  return Object.fromEntries(
    Array.from(byLevel.entries()).sort((a, b) => a[0] - b[0])
  );
}

const server = http.createServer((req, res) => {
  if (req.url === "/level-maker" || req.url === "/level-maker/") {
    res.writeHead(302, { Location: "/src/level-maker/" });
    res.end();
    return;
  }
  if (req.url?.startsWith("/level-maker/")) {
    const remapped = `/src/level-maker/${req.url.slice("/level-maker/".length)}`;
    res.writeHead(302, { Location: remapped });
    res.end();
    return;
  }

  if (req.url === "/api/max-level") {
    const songsDir = path.join(__dirname, "src", "levels");
    const maxLevel = computeMaxLevelFromSongsDir(songsDir);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify({ maxLevel }));
    return;
  }
  if (req.url === "/api/levels-index") {
    const songsDir = path.join(__dirname, "src", "levels");
    const levels = buildLevelIndexFromSongsDir(songsDir);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify({ levels }));
    return;
  }

  let filePath = req.url === "/" ? "/index.html" : req.url;
  if (/^\/level\/\d+\/?$/.test(filePath)) {
    filePath = "/index.html";
  }
  let fullPath = path.join(__dirname, filePath);

  if (!fullPath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      fullPath = path.join(fullPath, "index.html");
    }
    const content = fs.readFileSync(fullPath);
    const ext = path.extname(fullPath);
    const contentType =
      {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".json": "application/json"
      }[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*"
    });
    res.end(content);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    res.writeHead(404);
    res.end("Not Found");
  }
});

const PORT = process.env.PORT || 42424;
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(
    `Level Maker on http://localhost:${PORT}/level-maker (redirects to /src/level-maker/)`
  );
});
