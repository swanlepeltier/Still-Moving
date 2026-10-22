# Still / Moving

A silent video wall for Next.js. Every film in `public/videos` plays at once,
muted and looping, in a responsive grid. Click a frame and it morphs into a
near-full-screen view with the same corner radius; click outside or press
`Esc` and it flies back to its exact spot.

Built with Next.js 16 (App Router), React 19, TypeScript and Motion. All video
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

Requirements: Node.js 20.9+ and npm. `ffmpeg`/`ffprobe` are only needed for the
optional media scripts (demo loops and posters).

## Add your own films

1. Drop files into **`public/videos`**. `.mp4`, `.webm`, `.ogv`, `.mov` and
   `.m4v` are picked up automatically on reload.
2. Optionally generate lightweight poster frames (recommended — the wall paints
   posters before any video downloads):

   ```bash
   npm run posters
   ```

That's it. The folder is the single source of truth; there is no manifest to
edit. Generated demo files are ignored by git; add your own films explicitly
(or remove the `public/videos/*` rule in `.gitignore`). Filenames become titles (`salt-flats.mp4` → “Salt Flats”). Sub-folders at
any depth are scanned automatically and shown as a collection label on the tile:

```text
public/videos/
  salt-flats.mp4
  archive/
    night-swim.mp4
public/posters/
  salt-flats.jpg
  archive__night-swim.jpg   # note the double underscore for sub-folders
```

Poster generation can be forced with `FORCE=1 npm run posters`.

### Recommended source format

The wall fits each film inside a 16:10 tile with `object-fit: contain`, so the
whole frame stays visible: wider or taller films letterbox onto the tile's dark
ground instead of being cropped. Full-screen view keeps the same treatment. For
a light, fast wall:

```bash
ffmpeg -i input.mov \
  -vf "scale='min(1920,iw)':-2" \
  -c:v libx264 -preset slow -crf 23 \
  -pix_fmt yuv420p -movflags +faststart -an \
  public/videos/my-film.mp4
```

- 1080p or smaller, 8–15 seconds, H.264 + `faststart`, ideally under 5 MB.
- Muted clips save bytes; the wall is silent by default anyway.
- Demo loops are not versioned: generate them locally with
  `npm run demo:media` (requires `ffmpeg`). They are ~190 KB each. The
  matching posters are committed so the wall still paints instantly.

## What is optimised

- **Server-side folder scan.** `getVideos()` reads `public/videos` per request
  (`force-dynamic`), so adding a file is enough. No client-side manifest.
- **Poster-first tiles.** Posters are small JPEGs, lazily decoded. Videos are not
  requested until a tile is within 500 px of the viewport.
- **Viewport-limited playback.** An `IntersectionObserver` plays only the films
  actually on screen and pauses everything off screen. Opening the full-screen
  view pauses the wall as well.
- **Silent decode.** `playsInline`, `muted`, `loop`, no controls, no picture-in-
  picture, `preload` starts as metadata and becomes auto only near the viewport.
- **Cached media.** `/videos/*` and `/posters/*` get a day-long public cache with
  stale-while-revalidate.
- **Reduced motion.** With `prefers-reduced-motion: reduce`, tiles stay as
  posters, the wall's morph transitions are disabled, and the full-screen player
  starts paused with a play button.

## How the motion works

- **Responsive layout.** The wall is absolutely positioned and measured in JS.
  It spans the full window width (no page max-width), with up to 12 columns on
  ultrawide screens. Rows — including the last one — are centered. The layout
  uses explicit widths/heights plus `translate3d`, with CSS transitions, so a
  window resize visibly glides and morphs tiles into their new rows instead of
  snapping.
- **Frame-size slider.** The control in the wall bar pins every frame to a width
  from 240–560 px (clamped to the available width on small screens). Columns
  reflow around that size and rows stay centered. During a drag the transitions
  shorten and playback pauses; both return to normal when the drag settles.
- **Full-screen morph.** On click, the tile's viewport rect is measured and a
  Motion spring animates the frame's position, width and height from that exact
  rect to an inset full-screen box. The radius comes from the same `--radius`
  token. On close, the current tile rect is measured again (so it still works
  after a resize) and the frame springs back; the overlay unmounts when the
  return animation completes.
- **Details.** Backdrop blur/fade, caption and controls fade in after the frame
  settles, `Esc` closes, clicking the backdrop closes, the page behind the frame
  is made inert, focus is trapped and then restored to the tile, and page scroll
  is locked without a sideways jump.

## Customise

| What | Where |
| --- | --- |
| Corner radius | `--radius` in `app/globals.css` |
| Min tile width / max columns | `MIN_TILE_WIDTH`, `MAX_COLUMNS` in `components/VideoWall.tsx` |
| Slider range | `MIN_FRAME_WIDTH`, `MAX_FRAME_WIDTH` in `components/VideoWall.tsx` |
| Tile aspect ratio | `TILE_ASPECT` in `components/VideoWall.tsx` |
| Page padding, gap, colours | `app/globals.css` (`--page-pad`, `--gap`, tokens) |
| Title/description, fonts | `app/layout.tsx` |
| Motion timings | `components/Lightbox.tsx`, `components/VideoTile.tsx` |

The typefaces are self-hosted in `app/fonts` (Instrument Serif, Instrument Sans,
IBM Plex Mono) so builds do not depend on Google Fonts.

## Structure

```text
app/
  page.tsx          server component: scans videos, renders the wall
  layout.tsx        fonts + metadata
  globals.css       design tokens, layout, lightbox, responsive rules
  icon.svg          favicon
components/
  VideoWall.tsx     measuring, JS layout, live column readout, page shell
  VideoTile.tsx     poster/video tile, hover affordances
  Lightbox.tsx      full-screen morph, controls, focus + scroll handling
  LazyVideo.tsx     lazy loading and viewport-limited playback
  icons.tsx         inline SVG icons
lib/videos.ts       filesystem scan, titles, poster lookup
scripts/
  generate-demo-videos.sh   optional demo loops (ffmpeg)
  make-posters.mjs          poster frames for every video
public/videos/       your films (demo loops generated on demand)
public/posters/      generated poster JPEGs
```

## Checks run

- `npm run build` and `npx tsc --noEmit` pass.
- Verified at 3440, 1720, 1440, 760 and 390 px widths (11/12, 5, 4, 2 and 1
  columns) with no horizontal overflow, plus slider sizes from 240–560 px.
- Slider drags pause playback and shorten transitions; release restores both.
- Resize sampled frame-by-frame: tiles interpolate position and size rather than
  snapping.
- Lightbox: opens from the clicked rect, pauses the wall, locks scroll, traps
  focus, closes on backdrop click/Esc, restores focus, and returns to the current
  tile position after a resize.

No GitHub remote is configured; everything is committed locally for review.
