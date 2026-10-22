import fs from "node:fs/promises";
import path from "node:path";

export type Video = {
  /** Stable id derived from the relative path, e.g. "salt-flats". */
  id: string;
  title: string;
  /** Public URL, URL-encoded per path segment. */
  src: string;
  poster: string | null;
  /** Original file name, shown in the full-screen caption. */
  filename: string;
  /** Parent folder inside public/videos, if any. */
  collection: string | null;
};

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".ogv", ".mov", ".m4v"]);

const videoRoot = path.join(process.cwd(), "public", "videos");
const posterRoot = path.join(process.cwd(), "public", "posters");

async function listFiles(directory: string): Promise<string[]> {
  const entries = await fs
    .readdir(directory, { withFileTypes: true })
    .catch(() => []);

  const nested = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .map((entry) => {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) return listFiles(full);
        return entry.isFile() ? [full] : [];
      }),
  );

  return nested.flat();
}

function titleFromFilename(name: string) {
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function publicUrl(kind: "videos" | "posters", relative: string) {
  return `/${kind}/${relative
    .split(path.sep)
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
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
 * Reads every supported video from public/videos at request time.
 *
 * The folder is the only source of truth: add a file, reload, and it is on the
 * wall. Sub-folders are supported and shown as a small collection label.
 * A matching poster is used when public/posters holds one (see
 * scripts/make-posters.mjs); otherwise the tile renders as a quiet dark plate.
 */
export async function getVideos(): Promise<Video[]> {
  let files;
  try {
    files = await listFiles(videoRoot);
  } catch {
    return [];
  }

  files = files
    .filter((file) =>
      VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase()),
    )
    .sort((a, b) =>
      path
        .relative(videoRoot, a)
        .localeCompare(path.relative(videoRoot, b), undefined, {
          numeric: true,
          sensitivity: "base",
        }),
    );

  return Promise.all(
    files.map(async (file) => {
      const relative = path.relative(videoRoot, file);
      const extension = path.extname(relative);
      const base = relative.slice(0, -extension.length);
      const directory = path.dirname(relative);
      const posterRelative = `${base.split(path.sep).join("__")}.jpg`;
      const hasPoster = await exists(path.join(posterRoot, posterRelative));

      return {
        id: relative.split(path.sep).join("/"),
        title: titleFromFilename(path.basename(base)),
        src: publicUrl("videos", relative),
        poster: hasPoster ? publicUrl("posters", posterRelative) : null,
        filename: path.basename(relative),
        collection:
          directory === "."
            ? null
            : directory
                .split(path.sep)
                .map(titleFromFilename)
                .join(" / "),
      } satisfies Video;
    }),
  );
}
