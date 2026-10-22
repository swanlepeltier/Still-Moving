"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MotionConfig } from "motion/react";
import type { Media } from "@/lib/videos";
import VideoTile from "./VideoTile";
import Lightbox from "./Lightbox";

type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type ActiveMedia = {
  index: number;
  originRect: Rect;
  /** Tile playback position when the frame was opened. */
  startTime: number;
};

type TileLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Layout = {
  tiles: TileLayout[];
  rows: number;
  height: number;
};

const DEFAULT_ROW_HEIGHT = 220;
const MIN_ROW_HEIGHT = 160;
const MAX_ROW_HEIGHT = 360;
// Narrow screens get a lower floor so a phone can still show a few frames.
const NARROW_ROW_HEIGHT = 120;
const NARROW_WALL_WIDTH = 720;
const FALLBACK_ASPECT = 16 / 10;
const FALLBACK_WIDTH = 1200;
// A final row this close to full width is justified; anything shorter stays at
// the target height and is centered, like the last line of a paragraph.
const LAST_ROW_JUSTIFY_RATIO = 0.86;

// useLayoutEffect is client-only; this keeps SSR quiet.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * Justified rows, sized from each item's real aspect ratio.
 *
 * Items are packed until the row overflows the wall at the target height, then
 * the row is solved to exactly the wall width: same height for every tile in
 * the row, widths proportional to each file's aspect. The last row is left at
 * the target height and centered unless it is nearly full, so a short tail does
 * not become a wall of giant crops.
 */
function buildLayout(
  items: Media[],
  width: number,
  gap: number,
  targetHeight: number,
): Layout {
  if (items.length === 0 || width <= 0) {
    return { tiles: [], rows: 0, height: 0 };
  }

  const tiles: TileLayout[] = new Array(items.length);
  let rowStart = 0;
  let aspectSum = 0;
  let y = 0;
  let rows = 0;

  const finishRow = (end: number) => {
    const count = end - rowStart + 1;
    const naturalWidth = aspectSum * targetHeight + gap * (count - 1);
    const isLast = end === items.length - 1;
    const justify = !isLast || naturalWidth >= width * LAST_ROW_JUSTIFY_RATIO;

    const height = justify
      ? (width - gap * (count - 1)) / aspectSum
      : targetHeight;

    const rowWidth = aspectSum * height + gap * (count - 1);
    const offset = Math.max(0, (width - rowWidth) / 2);

    let x = offset;
    for (let index = rowStart; index <= end; index += 1) {
      let tileWidth = (items[index].aspect || FALLBACK_ASPECT) * height;
      // Snap the final tile to the row's right edge so float math cannot leave
      // a hairline gap on a full-bleed row.
      if (index === end) {
        tileWidth = Math.max(0, offset + rowWidth - x);
      }
      tiles[index] = { x, y, width: tileWidth, height };
      x += tileWidth + gap;
    }

    y += height + gap;
    rows += 1;
    rowStart = end + 1;
    aspectSum = 0;
  };

  for (let index = 0; index < items.length; index += 1) {
    aspectSum += items[index].aspect || FALLBACK_ASPECT;
    const count = index - rowStart + 1;
    const naturalWidth = aspectSum * targetHeight + gap * (count - 1);
    if (naturalWidth >= width) {
      finishRow(index);
    }
  }

  if (rowStart < items.length) finishRow(items.length - 1);

  return { tiles, rows, height: Math.max(0, y - gap) };
}

/**
 * The wall is laid out in JavaScript rather than by CSS Grid.
 *
 * Why: a CSS reflow happens before React can react to it, so Motion has no
 * "before" layout to animate from on window resize. Owning the geometry lets
 * us keep the old positions and let every tile glide, grow and re-center into
 * the new layout — the morphing resize.
 */
export default function VideoWall({ media }: { media: Media[] }) {
  const wallRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef(new Map<string, HTMLButtonElement>());
  const [metrics, setMetrics] = useState({
    width: FALLBACK_WIDTH,
    gap: 20,
    measured: false,
  });
  const [layoutReady, setLayoutReady] = useState(false);
  const [active, setActive] = useState<ActiveMedia | null>(null);
  // True from the first width change of a drag until 200ms after the last one.
  const [resizing, setResizing] = useState(false);
  // The height every row is packed toward; rows that fill the wall settle just
  // under it, so the range is also what the control reports.
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);
  const [adjusting, setAdjusting] = useState(false);
  const sizeSettle = useRef(0);

  useEffect(() => {
    return () => window.clearTimeout(sizeSettle.current);
  }, []);

  const changeRowHeight = useCallback((value: number) => {
    setRowHeight(value);
    setAdjusting(true);
    window.clearTimeout(sizeSettle.current);
    sizeSettle.current = window.setTimeout(() => setAdjusting(false), 220);
  }, []);

  useIsomorphicLayoutEffect(() => {
    const wall = wallRef.current;
    if (!wall) return;

    let frame = 0;
    let settle = 0;
    let lastWidth = 0;
    let flagged = false;

    const endResizing = () => {
      flagged = false;
      setResizing(false);
      delete document.body.dataset.resizing;
    };

    const markResizing = () => {
      if (!flagged) {
        flagged = true;
        setResizing(true);
        // Read by CSS to park full-screen decorative layers.
        document.body.dataset.resizing = "true";
      }
      window.clearTimeout(settle);
      settle = window.setTimeout(endResizing, 200);
    };

    const measure = () => {
      frame = 0;
      const width = wall.getBoundingClientRect().width;
      if (!width) return;
      const gap = Math.min(20, Math.max(12, width * 0.015));
      setMetrics((current) => {
        if (
          current.measured &&
          Math.abs(current.width - width) < 0.5 &&
          Math.abs(current.gap - gap) < 0.5
        ) {
          return current;
        }
        return { width, gap, measured: true };
      });
    };

    const observer = new ResizeObserver((entries) => {
      const width =
        entries[0]?.contentRect.width ?? wall.getBoundingClientRect().width;
      // Only a width change re-lays-out and rescales the tiles (and therefore
      // the videos); a height-only resize needs no media work.
      if (lastWidth && Math.abs(width - lastWidth) > 0.5) markResizing();
      lastWidth = width;
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });

    observer.observe(wall);
    measure();

    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      delete document.body.dataset.resizing;
    };
  }, []);

  // Let the first measured layout paint without transitions, then switch the
  // morph on for every subsequent resize.
  useEffect(() => {
    if (!metrics.measured) return;
    const frame = requestAnimationFrame(() => setLayoutReady(true));
    return () => cancelAnimationFrame(frame);
  }, [metrics.measured]);

  const narrow = metrics.width < NARROW_WALL_WIDTH;
  const sliderMin = narrow ? NARROW_ROW_HEIGHT : MIN_ROW_HEIGHT;
  const targetHeight = Math.min(
    Math.max(rowHeight, sliderMin),
    MAX_ROW_HEIGHT,
  );

  const layout = buildLayout(
    media,
    metrics.width,
    metrics.gap,
    targetHeight,
  );

  const registerRef = useCallback(
    (id: string, element: HTMLButtonElement | null) => {
      if (element) tileRefs.current.set(id, element);
      else tileRefs.current.delete(id);
    },
    [],
  );

  const openMedia = useCallback(
    (index: number, element: HTMLButtonElement) => {
      const rect = element.getBoundingClientRect();
      const tileVideo = element
        .closest(".tile")
        ?.querySelector("video");
      const startTime =
        tileVideo && Number.isFinite(tileVideo.currentTime)
          ? tileVideo.currentTime
          : 0;

      setActive({
        index,
        startTime,
        originRect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
      });
    },
    [],
  );

  const getReturnRect = useCallback((): Rect => {
    if (!active) {
      return { left: 0, top: 0, width: 0, height: 0 };
    }

    const element = tileRefs.current.get(media[active.index]?.id ?? "");
    if (!element) return active.originRect;

    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }, [active, media]);

  const exitLightbox = useCallback(
    (position: number) => {
      const current = active;
      setActive(null);

      if (!current) return;
      const id = media[current.index]?.id;
      if (!id) return;

      // Hand the lightbox position back to the tile before the wall resumes.
      const tile = tileRefs.current.get(id);
      const tileVideo = tile?.closest(".tile")?.querySelector("video");
      if (tileVideo && position > 0) {
        const duration = tileVideo.duration;
        if (!Number.isFinite(duration) || position < duration) {
          try {
            tileVideo.currentTime = position;
          } catch {
            // The tile may not have loaded metadata yet; the next play starts
            // from its existing position instead.
          }
        }
      }

      // The wall is inert while the frame is open, so the browser cannot return
      // focus on its own. Hand it back to the tile that launched the frame once
      // that inert state has been removed.
      requestAnimationFrame(() => tileRefs.current.get(id)?.focus());
    },
    [active, media],
  );

  const hasMedia = media.length > 0;
  const activeMedia = active ? media[active.index] : null;

  return (
    <MotionConfig reducedMotion="user">
      <div className="ambient" aria-hidden="true" />

      <div
        className="site-shell"
        aria-hidden={active ? true : undefined}
        inert={active ? true : undefined}
      >
        <header className="masthead">
          <a className="brand" href="/" aria-label="Still / Moving, home">
            <span className="brand-word">Still</span>
            <span className="brand-slash">/</span>
            <span className="brand-word brand-word--light">Moving</span>
          </a>

          <div className="masthead-meta">
            <span className="live-pill">
              <span className="live-dot" aria-hidden="true" />
              Live wall
            </span>
            <span className="masthead-rule" aria-hidden="true" />
            <span className="masthead-note">Muted · Looping</span>
          </div>
        </header>

        <main>
          <section className="hero" aria-labelledby="page-title">
            <div className="hero-headline">
              <p className="eyebrow">A study in quiet motion — Vol. 01</p>
              <h1 className="hero-title" id="page-title">
                The wall is
                <br />
                <em>always</em> moving.
              </h1>
            </div>

            <div className="hero-aside">
              <p className="hero-copy">
                A wall of silent films and stills, playing all at once, forever.
                No sound, no clutter. Click a frame to step inside — click away
                to return.
              </p>

              <dl className="specs" aria-label="Wall details">
                <div className="spec">
                  <dt>Frames</dt>
                  <dd>{pad(media.length)}</dd>
                </div>
                <div className="spec">
                  <dt>Rows</dt>
                  <dd>{pad(layout.rows)}</dd>
                </div>
                <div className="spec">
                  <dt>Sound</dt>
                  <dd>Off</dd>
                </div>
              </dl>
            </div>
          </section>

          <div className="wall-bar">
            <span className="wall-label">01 / The wall</span>
            <div className="wall-tools">
              <label className="frame-control">
                <span className="frame-label">Row height</span>
                <input
                  className="frame-slider"
                  type="range"
                  min={sliderMin}
                  max={MAX_ROW_HEIGHT}
                  step={2}
                  value={targetHeight}
                  onChange={(event) =>
                    changeRowHeight(Number(event.target.value))
                  }
                  aria-label="Target row height"
                  aria-valuetext={`${targetHeight} pixels`}
                />
                <output className="frame-value">
                  {targetHeight}
                  <span>px</span>
                </output>
              </label>
              <span className="wall-hint">Click a frame to step inside</span>
            </div>
          </div>

          {hasMedia ? (
            <div
              className="wall"
              ref={wallRef}
              data-ready={layoutReady ? "true" : "false"}
              data-adjusting={adjusting ? "true" : undefined}
              style={{ height: layout.height || undefined }}
            >
              {media.map((item, index) => {
                const position = layout.tiles[index];
                if (!position) return null;
                return (
                  <div
                    key={item.id}
                    className="tile-slot"
                    data-ready={layoutReady ? "true" : "false"}
                    style={{
                      width: position.width,
                      height: position.height,
                      transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
                    }}
                  >
                    <VideoTile
                      media={item}
                      index={index}
                      hidden={active?.index === index}
                      paused={active !== null}
                      suspended={resizing || adjusting}
                      onOpen={openMedia}
                      registerRef={registerRef}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-wall" ref={wallRef}>
              <p className="empty-kicker">No signal</p>
              <h2 className="empty-title">The wall is waiting.</h2>
              <p className="empty-copy">
                Drop a video (<code>.mp4</code>, <code>.webm</code>,{" "}
                <code>.mov</code>) or an image (<code>.jpg</code>,{" "}
                <code>.png</code>, <code>.webp</code>) into{" "}
                <code>public/media</code>, then reload. Every file in that folder
                and its subfolders joins the wall automatically.
              </p>
              <code className="empty-command">npm run posters</code>
            </div>
          )}
        </main>

        <footer className="footer">
          <div>
            <p className="footer-title">Still / Moving</p>
            <p className="footer-copy">
              A local wall of quiet loops and stills. Nothing leaves this
              machine.
            </p>
          </div>
          <div className="footer-meta">
            <span>
              Frames <span className="footer-value">{pad(media.length)}</span>
            </span>
            <span>
              Rows <span className="footer-value">{pad(layout.rows)}</span>
            </span>
            <span className="footer-stamp">Next.js · Motion</span>
          </div>
        </footer>
      </div>

      {active && activeMedia ? (
        <Lightbox
          media={activeMedia}
          index={active.index}
          total={media.length}
          originRect={active.originRect}
          getReturnRect={getReturnRect}
          startTime={active.startTime}
          onExited={exitLightbox}
        />
      ) : null}
    </MotionConfig>
  );
}
