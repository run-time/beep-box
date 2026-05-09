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

const server = http.createServer((req, res) => {
  if (req.url === "/api/max-level") {
    const songsDir = path.join(__dirname, "src", "components", "songs");
    const maxLevel = computeMaxLevelFromSongsDir(songsDir);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify({ maxLevel }));
    return;
  }

  // Special case: serve favicon.svg as /favicon.ico
  if (req.url === "/favicon.ico") {
    const svgPath = path.join(__dirname, "favicon.svg");
    try {
      const svgContent = fs.readFileSync(svgPath);
      res.writeHead(200, {
        "Content-Type": "image/svg+xml",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(svgContent);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      res.writeHead(404);
      res.end("Not Found");
    }
    return;
  }

  const filePath = req.url === "/" ? "/index.html" : req.url;
  const fullPath = path.join(__dirname, filePath);

  if (!fullPath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
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
});
