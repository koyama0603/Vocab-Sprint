import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 5173);

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".svg", "image/svg+xml"]
]);

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const resolved = path.resolve(ROOT, `.${requested}`);
  if (!resolved.startsWith(ROOT)) {
    return null;
  }
  return resolved;
}

function toUrlPath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function cacheControlFor(filePath) {
  const urlPath = toUrlPath(filePath);
  if (urlPath.startsWith("assets/word-audio/")) {
    return "public, max-age=31536000, immutable";
  }
  return "no-store";
}

const server = createServer(async (request, response) => {
  try {
    const filePath = safePath(request.url || "/");
    if (!filePath) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    const fileStat = await stat(filePath);
    const finalPath = fileStat.isDirectory() ? path.join(filePath, "index.html") : filePath;
    const body = await readFile(finalPath);
    response.writeHead(200, {
      "Content-Type": types.get(path.extname(finalPath)) || "application/octet-stream",
      "Cache-Control": cacheControlFor(finalPath)
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Word Rush: http://127.0.0.1:${PORT}/`);
});
