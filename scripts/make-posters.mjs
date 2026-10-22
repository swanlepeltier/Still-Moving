#!/usr/bin/env node
/**
 * Creates a poster frame for every video in public/videos that does not have
 * one yet. Posters keep the grid visually complete before a video is allowed
 * to download, which is the main reason the wall stays cheap to load.
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
const videoDir = path.join(root, "public", "videos");
const posterDir = path.join(root, "public", "posters");
const extensions = new Set([".mp4", ".webm", ".ogv", ".mov", ".m4v"]);

if (!fs.existsSync(videoDir)) {
  console.log("No public/videos folder yet — nothing to do.");
  process.exit(0);
}

fs.mkdirSync(posterDir, { recursive: true });

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return [full];
  });
}

const videos = walk(videoDir).filter((file) =>
  extensions.has(path.extname(file).toLowerCase()),
);

if (!videos.length) {
  console.log("No videos found in public/videos.");
  process.exit(0);
}

let made = 0;
for (const video of videos) {
  const relative = path.relative(videoDir, video);
  const base = relative.slice(0, -path.extname(relative).length);
  const poster = path.join(posterDir, `${base.replaceAll(path.sep, "__")}.jpg`);
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
  console.log(`poster ${relative} -> public/posters/${path.basename(poster)}`);
}

console.log(
  made ? `Created ${made} poster${made === 1 ? "" : "s"}.` : "Posters already up to date.",
);
