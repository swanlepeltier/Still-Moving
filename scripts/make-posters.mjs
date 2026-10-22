#!/usr/bin/env node
/**
 * Creates a poster frame for every video in public/media (plus the legacy
 * public/videos folder) that does not have one yet. Posters keep the grid
 * visually complete before a video is allowed to download, which is the main
 * reason the wall stays cheap to load. Images need no poster.
 *
 * Symlinked files and folders are followed; a realpath guard stops link loops.
 * When the same relative path exists in both roots, public/media wins.
 *
 * Usage: npm run posters          (skips existing posters)
 *        FORCE=1 npm run posters  (regenerates every poster)
 *
 * Requires ffmpeg + ffprobe on PATH.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const posterDir = path.join(root, "public", "posters");
const roots = [
  { dir: path.join(root, "public", "media"), label: "public/media" },
  { dir: path.join(root, "public", "videos"), label: "public/videos" },
];
const extensions = new Set([".mp4", ".webm", ".ogv", ".mov", ".m4v"]);

const existingRoots = roots.filter(({ dir }) => fs.existsSync(dir));
if (!existingRoots.length) {
  console.log("No public/media folder yet — nothing to do.");
  process.exit(0);
}

fs.mkdirSync(posterDir, { recursive: true });

// Public-path -> absolute path. Media is walked first, so it wins a collision.
const videos = new Map();

function walk(directory, base, seenDirs) {
  let real;
  try {
    real = fs.realpathSync(directory);
  } catch {
    return;
  }
  if (seenDirs.has(real)) return;
  seenDirs.add(real);

  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const full = path.join(directory, entry.name);
    // statSync (not the Dirent type) so symlinks are followed.
    let stats;
    try {
      stats = fs.statSync(full);
    } catch {
      continue; // broken symlink
    }

    if (stats.isDirectory()) {
      walk(full, base, seenDirs);
      continue;
    }
    if (!stats.isFile()) continue;
    if (!extensions.has(path.extname(entry.name).toLowerCase())) continue;

    const relative = path.relative(base, full).split(path.sep).join("/");
    if (!videos.has(relative)) videos.set(relative, full);
  }
}

for (const { dir } of existingRoots) walk(dir, dir, new Set());

if (!videos.size) {
  console.log("No videos found in public/media or public/videos.");
  process.exit(0);
}

let made = 0;
for (const [relative, video] of videos) {
  const base = relative.slice(0, -path.extname(relative).length);
  // Mirror the media tree so archive/b.mp4 and a top-level a__b.mp4 cannot
  // claim the same poster file.
  const poster = path.join(posterDir, `${base}.jpg`);
  if (fs.existsSync(poster) && process.env.FORCE !== "1") continue;

  fs.mkdirSync(path.dirname(poster), { recursive: true });
  const seek = spawnSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    "0.6",
    "-i",
    video,
    "-frames:v",
    "1",
    "-vf",
    "scale=960:-2:flags=lanczos",
    "-q:v",
    "4",
    poster,
  ]);

  if (seek.status !== 0) {
    console.warn(`poster failed: ${relative} (is ffmpeg installed?)`);
    continue;
  }
  made += 1;
  console.log(
    `poster ${relative} -> public/posters/${path.relative(posterDir, poster)}`,
  );
}

console.log(
  made
    ? `Created ${made} poster${made === 1 ? "" : "s"}.`
    : "Posters already up to date.",
);
