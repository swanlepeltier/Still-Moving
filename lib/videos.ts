import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export type MediaKind = "video" | "image";

export type Media = {
  /** Stable id derived from the relative path, e.g. "archive/night-swim.mp4". */
  id: string;
  title: string;
  /** Public URL, URL-encoded per path segment. */
  src: string;
  /** Poster URL for videos; images are their own poster. */
  poster: string | null;
  /** Original file name, shown in the full-screen caption. */
  filename: string;
  /** Parent folder inside the media root, if any. */
  collection: string | null;
  kind: MediaKind;
  width: number;
  height: number;
  /** width / height, used to lay out aspect-true tiles. */
  aspect: number;
};

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".ogv", ".mov", ".m4v"]);
// SVG is deliberately excluded: it is only ever shown through <img>, but the
// same file is also served from our origin, where an SVG can run script. The
// raster formats below cannot.
const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".gif",
]);

const FALLBACK_DIMENSIONS = { width: 1600, height: 1000 };
const PROBE_CONCURRENCY = 6;
const PROBE_TIMEOUT_MS = 5_000;

const mediaRoot = path.join(process.cwd(), "public", "media");
const legacyVideoRoot = path.join(process.cwd(), "public", "videos");
const posterRoot = path.join(process.cwd(), "public", "posters");

type RootKind = "media" | "videos";

type Candidate = {
  relative: string;
  absolute: string;
  root: RootKind;
  kind: MediaKind;
};

export type Dimensions = { width: number; height: number };

type ProbeStream = {
  width?: unknown;
  height?: unknown;
  tags?: Record<string, unknown>;
  side_data_list?: Array<Record<string, unknown>>;
};

function titleFromFilename(name: string) {
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function publicUrl(kind: RootKind | "posters", relative: string) {
  return `/${kind}/${relative
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

function extensionKind(name: string): MediaKind | null {
  const extension = path.extname(name).toLowerCase();
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  return null;
}

/**
 * Walk one media root in the order the filesystem gives us.
 *
 * Symlinks are followed — both for files and for directories — by stat'ing each
 * entry instead of trusting the Dirent type. `seen` holds real paths for every
 * directory already visited, which is what stops a symlink loop from hanging
 * the request. Each root gets its own set: a link from one root into the other
 * must not hide that other root's own files.
 */
async function collect(
  root: string,
  rootKind: RootKind,
  seen: Set<string>,
  out: Map<string, Candidate>,
): Promise<void> {
  const stack: Array<{ directory: string; relative: string }> = [
    { directory: root, relative: "" },
  ];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;

    let real: string;
    try {
      real = await fs.realpath(current.directory);
    } catch {
      continue;
    }
    if (seen.has(real)) continue;
    seen.add(real);

    const entries = await fs
      .readdir(current.directory, { withFileTypes: true })
      .catch(() => []);

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;

      const absolute = path.join(current.directory, entry.name);
      const relative = current.relative
        ? `${current.relative}/${entry.name}`
        : entry.name;

      // stat() follows symlinks; a broken link is simply skipped.
      let stats;
      try {
        stats = await fs.stat(absolute);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        stack.push({ directory: absolute, relative });
        continue;
      }
      if (!stats.isFile()) continue;

      const kind = extensionKind(entry.name);
      if (!kind) continue;

      // public/media is scanned first and wins over the legacy folder when both
      // hold the same relative path.
      if (!out.has(relative)) {
        out.set(relative, { relative, absolute, root: rootKind, kind });
      }
    }
  }
}

let activeProbes = 0;
const probeQueue: Array<() => void> = [];

async function withProbeSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeProbes >= PROBE_CONCURRENCY) {
    await new Promise<void>((resolve) => probeQueue.push(resolve));
  }

  activeProbes += 1;
  try {
    return await task();
  } finally {
    activeProbes -= 1;
    probeQueue.shift()?.();
  }
}

/** Best-effort ffprobe read; returns null when the file cannot be probed. */
function probe(file: string): Promise<Dimensions | null> {
  return new Promise((resolve) => {
    let settled = false;
    let output = "";

    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_streams",
        "-of",
        "json",
        file,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );

    const finish = (value: Dimensions | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS);

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 2_000_000) finish(null);
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => {
      if (code !== 0) {
        finish(null);
        return;
      }

      try {
        const parsed = JSON.parse(output) as { streams?: ProbeStream[] };
        const stream = parsed.streams?.[0];
        if (!stream) {
          finish(null);
          return;
        }

        let width = Number(stream.width);
        let height = Number(stream.height);
        if (
          !Number.isFinite(width) ||
          !Number.isFinite(height) ||
          width <= 0 ||
          height <= 0
        ) {
          finish(null);
          return;
        }

        // Phone clips are often stored landscape with a rotation flag. Swap the
        // axes so the wall and the lightbox match what the decoder shows.
        const rotationValue =
          stream.side_data_list?.find(
            (entry) => typeof entry.rotation !== "undefined",
          )?.rotation ?? stream.tags?.rotate;
        const rotation = Number(rotationValue);
        if (
          Number.isFinite(rotation) &&
          Math.abs(Math.round(rotation)) % 180 === 90
        ) {
          [width, height] = [height, width];
        }

        finish({ width: Math.round(width), height: Math.round(height) });
      } catch {
        finish(null);
      }
    });
  });
}

const dimensionsCache = new Map<string, Dimensions>();
const pendingProbes = new Map<string, Promise<Dimensions>>();
let warnedProbeFailure = false;

/**
 * Probe once per file version (path + mtime + size), with bounded concurrency.
 * The cache survives between requests, so a live wall of a dozen files pays for
 * ffprobe on the first request only.
 */
async function measure(file: string): Promise<Dimensions> {
  let stats;
  try {
    stats = await fs.stat(file);
  } catch {
    return FALLBACK_DIMENSIONS;
  }

  const key = `${file}\u0000${stats.mtimeMs}\u0000${stats.size}`;
  const cached = dimensionsCache.get(key);
  if (cached) return cached;

  const pending = pendingProbes.get(key);
  if (pending) return pending;

  const promise = withProbeSlot(() => probe(file))
    .then((dimensions) => {
      if (!dimensions && !warnedProbeFailure) {
        warnedProbeFailure = true;
        console.warn(
          "ffprobe could not read media dimensions; falling back to 16:10. Tiles may crop until ffprobe is available.",
        );
      }
      const value = dimensions ?? FALLBACK_DIMENSIONS;
      dimensionsCache.set(key, value);

      // A re-encoded file gets a new key; drop the stale entry for that path.
      for (const existing of dimensionsCache.keys()) {
        if (existing !== key && existing.startsWith(`${file}\u0000`)) {
          dimensionsCache.delete(existing);
        }
      }
      return value;
    })
    .finally(() => pendingProbes.delete(key));

  pendingProbes.set(key, promise);
  return promise;
}

async function exists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads every supported image and video from public/media, plus the legacy
 * public/videos folder, at request time.
 *
 * The folders are the only source of truth: add a file, reload, and it is on
 * the wall. Sub-folders at any depth are supported and shown as a collection
 * label, symlinked folders and files are followed, and a video's matching
 * poster is used when public/posters holds one (see scripts/make-posters.mjs).
 *
 * Real dimensions are probed so the wall can lay every frame out at its true
 * aspect ratio; files that cannot be probed fall back to 16:10.
 */
export async function getMedia(): Promise<Media[]> {
  const found = new Map<string, Candidate>();

  // Separate cycle guards per root. A symlink from public/media into
  // public/videos must not mark that tree as seen before the legacy scan runs.
  await collect(mediaRoot, "media", new Set(), found);
  await collect(legacyVideoRoot, "videos", new Set(), found);

  const candidates = [...found.values()].sort((a, b) =>
    a.relative.localeCompare(b.relative, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );

  return Promise.all(
    candidates.map(async (candidate) => {
      const extension = path.extname(candidate.relative);
      const base = candidate.relative.slice(0, -extension.length);
      const segments = candidate.relative.split("/");
      const directory = segments.slice(0, -1).join("/");
      const dimensions = await measure(candidate.absolute);

      let poster: string | null = null;
      if (candidate.kind === "video") {
        // Keep the media path, swapping only the extension. Mirroring folders
        // avoids the old "a__b.jpg" collision between archive/b.mp4 and a
        // top-level file literally named a__b.mp4.
        const posterRelative = `${base}.jpg`;
        if (await exists(path.join(posterRoot, posterRelative))) {
          poster = publicUrl("posters", posterRelative);
        }
      }

      return {
        id: candidate.relative,
        title: titleFromFilename(path.basename(base)),
        src: publicUrl(candidate.root, candidate.relative),
        poster,
        filename: segments[segments.length - 1],
        collection:
          directory === ""
            ? null
            : directory
                .split("/")
                .map(titleFromFilename)
                .join(" / "),
        kind: candidate.kind,
        width: dimensions.width,
        height: dimensions.height,
        aspect: dimensions.width / dimensions.height,
      } satisfies Media;
    }),
  );
}
