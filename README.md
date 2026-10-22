# Still / Moving

A silent wall for Next.js. Every film in `public/media` plays at once, muted and
looping, next to stills. The wall lays each file out at its real aspect ratio in
justified rows — no letterbox bars, no crops. Click a frame and it morphs into a
full-screen view sized to the same aspect; click outside or press `Esc` and it
flies back to its exact spot.

Built with Next.js 16 (App Router), React 19, TypeScript and Motion. All media
stays local — nothing is uploaded or fetched from a third party.

## Run it

```bash
npm install
npm run dev
```

Open the printed local URL (usually `http://localhost:3000`). Production:

```bash
npm run build
npm start
```

Requirements: Node.js 20.9+ and npm. `ffmpeg`/`ffprobe` are used by the optional
media scripts (demo loops and posters) and by the server to read dimensions.

In development a reload picks up new media. `next start` snapshots the public
file list when it boots, so restart the production server after adding files.

## Add your own media

1. Drop files into **`public/media`**. Videos: `.mp4`, `.webm`, `.ogv`, `.mov`,
   `.m4v`. Stills: `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`, `.gif`. Files are
   picked up automatically on reload.
2. Optionally generate lightweight poster frames for videos (recommended — the
   wall paints posters before any video downloads):

   ```bash
   npm run posters
   ```

   Stills are their own poster, so they are skipped. That's it: the folder is the
   single source of truth, there is no manifest to edit.

Generated demo files are ignored by git; add your own media explicitly by
removing the `public/media/*` rule in `.gitignore`. Filenames become titles
(`salt-flats.mp4` → “Salt Flats”). Sub-folders at any depth are scanned and shown
as a collection label on the tile:

```text
public/media/
  salt-flats.mp4
  harbour.jpg
  archive/
    night-swim.mp4
public/posters/
  salt-flats.jpg
  archive/
    night-swim.jpg          # posters mirror the media folders
```

Symlinked files and folders are followed (a realpath guard stops the scan and
the poster script from looping), so a library kept elsewhere on disk can be
linked into `public/media` without copying it. Avoid a self-referential link
inside `public/` itself: Next enumerates that folder at boot and does not guard
against cycles, so such a link can stop the server before the app runs.

Hidden files (names starting with `.`) are ignored. The legacy `public/videos`
folder is still scanned when present; if both folders hold the same relative
path, `public/media` wins.

Poster generation can be forced with `FORCE=1 npm run posters`.

### Recommended source format

Any aspect ratio works: the wall asks `ffprobe` for each file's dimensions and
gives it a tile of that shape. For a light, fast wall:

```bash
ffmpeg -i input.mov \
  -vf "scale='min(1920,iw)':-2" \
  -c:v libx264 -preset slow -crf 23 \
  -pix_fmt yuv420p -movflags +faststart -an \
  public/media/my-film.mp4
```

- 1080p or smaller, 8–15 seconds, H.264 + `faststart`, ideally under 5 MB.
- Muted clips save bytes; the wall is silent by default anyway.
- Demo clips are not versioned: generate them locally with `npm run demo:media`
  (requires `ffmpeg`). They are ~190 KB each. The matching posters are committed
  so the wall still paints instantly.

## What is optimised

- **Server-side folder scan.** `getMedia()` reads `public/media` (and legacy
  `public/videos`) per request (`force-dynamic`), so adding a file is enough. No
  client-side manifest.
- **Dimensions, cached.** Each file is probed once per version (path + mtime +
  size) with bounded concurrency and an in-memory cache. Failures fall back to
  16:10, so a missing `ffprobe` degrades instead of breaking the wall. Video
  rotation metadata is applied.
- **Poster-first tiles.** Posters are small JPEGs, lazily decoded. Videos are not
  requested until a tile is within 500 px of the viewport. Stills load lazily
  and need no poster.
- **Viewport-limited playback.** An `IntersectionObserver` plays only the films
  actually on screen and pauses everything off screen. Opening the full-screen
  view pauses the wall as well.
- **Silent decode.** `playsInline`, `muted`, `loop`, no controls, no picture-in-
  picture, `preload` starts as metadata and becomes auto only near the viewport.
- **Cached media.** `/media/*`, the legacy `/videos/*`, and `/posters/*` get a
  day-long public cache with stale-while-revalidate.
- **Reduced motion.** With `prefers-reduced-motion: reduce`, tiles stay as
  posters/stills, the wall's morph transitions are disabled, and the full-screen
  player starts paused with a play button.

## How the motion works

- **Justified, aspect-true rows.** The wall is absolutely positioned and measured
  in JS. It spans the full window width (no page max-width). Items are packed
  until a row overflows the target height, then the row is solved to exactly the
  wall width: one height for the row, widths proportional to each file's aspect.
  A 21:9 clip is wider and shorter than a 16:9 clip at the same row height, and
  a 9:16 clip is narrow and tall. Rows stay flush to both edges.
- **Row-height slider.** The control in the wall bar sets the target row height
  from 160–360 px (120 px floor on narrow screens). Rows land just under the
  target because they are justified. Short final rows keep the target height and
  are centered instead of stretching; a final row that is close to full width is
  justified like the rest. During a drag transitions shorten and playback
  pauses; both return to normal when the drag settles.
- **Full-screen morph.** On click, the tile's viewport rect is measured and a
  Motion spring animates the frame's position, width and height from that exact
  rect to the largest box with the file's aspect ratio that fits the viewport
  padding. The media fills that frame, so there are no bars. The radius comes
  from the same `--radius` token. On close, the current tile rect is measured
  again (so it still works after a resize) and the frame springs back; the
  overlay unmounts when the return animation completes.
- **Timeline and continuity.** Video frames get an accessible range scrubber
  showing current time / duration; it seeks on input and updates while playing.
  Opening starts the full-screen film at the tile's current position. Closing
  writes the full-screen position back to the tile before the wall resumes, so
  playback continues in both directions. Stills have no playback UI.
- **Details.** Backdrop blur/fade, caption and controls fade in after the frame
  settles, `Esc` closes, clicking the backdrop closes, the page behind the frame
  is made inert, focus is trapped (including the timeline) and then restored to
  the tile, and page scroll is locked without a sideways jump.

## Customise

| What | Where |
| --- | --- |
| Corner radius | `--radius` in `app/globals.css` |
| Default / min / max row height | `DEFAULT_ROW_HEIGHT`, `MIN_ROW_HEIGHT`, `MAX_ROW_HEIGHT` in `components/VideoWall.tsx` |
| Narrow-screen row-height floor | `NARROW_ROW_HEIGHT`, `NARROW_WALL_WIDTH` in `components/VideoWall.tsx` |
| Final-row justify threshold | `LAST_ROW_JUSTIFY_RATIO` in `components/VideoWall.tsx` |
| Page padding, gap, colours | `app/globals.css` (`--page-pad`, `--gap`, tokens) |
| Title/description, fonts | `app/layout.tsx` |
| Motion timings | `components/Lightbox.tsx`, `components/VideoTile.tsx` |

The typefaces are self-hosted in `app/fonts` (Instrument Serif, Instrument Sans,
IBM Plex Mono) so builds do not depend on Google Fonts.

## Structure

```text
app/
  page.tsx          server component: scans media, renders the wall
  layout.tsx        fonts + metadata
  globals.css       design tokens, layout, lightbox, responsive rules
  icon.svg          favicon
components/
  VideoWall.tsx     measuring, justified row layout, page shell
  VideoTile.tsx     image/video tile, hover affordances
  Lightbox.tsx      full-screen morph, timeline, focus + scroll handling
  LazyVideo.tsx     lazy loading and viewport-limited playback
  icons.tsx         inline SVG icons
lib/videos.ts       filesystem scan, dimensions, titles, poster lookup
scripts/
  generate-demo-videos.sh   optional demo loops (ffmpeg)
  make-posters.mjs          poster frames for every video
public/media/        your films and stills (demo loops generated on demand)
public/videos/       legacy folder, still scanned
public/posters/      generated poster JPEGs
```
