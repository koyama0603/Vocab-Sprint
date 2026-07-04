import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "cache-manifest.json");
const INCLUDE = [
  "index.html",
  "sw.js",
  "manifest.webmanifest",
  "css",
  "js",
  "data",
  path.join("assets", "icons"),
  path.join("assets", "audio")
];
const ASSET_GROUPS = [
  {
    path: path.join("assets", "word-audio"),
    revisionPolicy: "content-hash",
    versionPolicy: "ignored"
  }
];
const ALLOWED_EXTENSIONS = new Set([".html", ".css", ".js", ".json", ".csv", ".svg", ".mp3", ".webmanifest"]);
const EXCLUDED_FILES = new Set(["cache-manifest.json"]);

function toUrlPath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

async function collectFiles(entry) {
  const fullPath = path.join(ROOT, entry);
  const files = [];

  async function walk(current) {
    const children = await readdir(current, { withFileTypes: true });
    for (const child of children) {
      const childPath = path.join(current, child.name);
      if (child.isDirectory()) {
        await walk(childPath);
        continue;
      }
      if (!child.isFile() || EXCLUDED_FILES.has(child.name)) {
        continue;
      }
      if (ALLOWED_EXTENSIONS.has(path.extname(child.name).toLowerCase())) {
        files.push(childPath);
      }
    }
  }

  try {
    const stats = await stat(fullPath);
    if (stats.isDirectory()) {
      await walk(fullPath);
    } else if (stats.isFile() && ALLOWED_EXTENSIONS.has(path.extname(fullPath).toLowerCase())) {
      files.push(fullPath);
    }
  } catch {
    return [];
  }

  return files;
}

async function fileHash(filePath) {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

async function summarizeAssetGroup(group) {
  const files = (await collectFiles(group.path))
    .sort((a, b) => toUrlPath(a).localeCompare(toUrlPath(b)));
  const entries = [];
  let bytes = 0;

  for (const filePath of files) {
    const fileStats = await stat(filePath);
    bytes += fileStats.size;
    const revision = group.revisionPolicy === "content-hash"
      ? await fileHash(filePath)
      : String(fileStats.size);
    entries.push(`${toUrlPath(filePath)}:${fileStats.size}:${revision}`);
  }

  return {
    url: group.path.replace(/\\/g, "/"),
    files: files.length,
    bytes,
    revision: createHash("sha256").update(entries.join("\n")).digest("hex").slice(0, 16),
    revisionPolicy: group.revisionPolicy,
    versionPolicy: group.versionPolicy
  };
}

async function main() {
  const collected = [];
  for (const entry of INCLUDE) {
    collected.push(...await collectFiles(entry));
  }

  const unique = [...new Set(collected)]
    .filter((filePath) => !EXCLUDED_FILES.has(path.basename(filePath)))
    .sort((a, b) => toUrlPath(a).localeCompare(toUrlPath(b)));
  const assets = [];

  for (const filePath of unique) {
    assets.push({
      url: toUrlPath(filePath),
      revision: await fileHash(filePath)
    });
  }

  const assetGroups = [];
  for (const group of ASSET_GROUPS) {
    assetGroups.push(await summarizeAssetGroup(group));
  }

  const version = createHash("sha256")
    .update(assets.map((asset) => `${asset.url}:${asset.revision}`).join("\n"))
    .digest("hex")
    .slice(0, 16);
  const manifest = {
    version,
    generatedAt: new Date().toISOString(),
    assets,
    assetGroups
  };

  await writeFile(OUTPUT, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Generated cache-manifest.json (${assets.length} assets, ${assetGroups.length} groups, version ${version}).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
