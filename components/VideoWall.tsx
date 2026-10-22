"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MotionConfig } from "motion/react";
import type { Video } from "@/lib/videos";
import VideoTile from "./VideoTile";
import Lightbox from "./Lightbox";

type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type ActiveVideo = {
  index: number;
  originRect: Rect;
};

type TileLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const MIN_TILE_WIDTH = 272;
const MAX_COLUMNS = 12;
const MIN_FRAME_WIDTH = 240;
const MAX_FRAME_WIDTH = 560;
const TILE_ASPECT = 16 / 10;
const FALLBACK_WIDTH = 1200;

// useLayoutEffect is client-only; this keeps SSR quiet.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function columnsFor(width: number, gap: number) {
  if (!width) return 1;
  return Math.max(
    1,
    Math.min(
      MAX_COLUMNS,
      Math.floor((width + gap) / (MIN_TILE_WIDTH + gap)),
    ),
  );
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * The wall is laid out in JavaScript rather than by CSS Grid.
 *
 * Why: a CSS reflow happens before React can react to it, so Motion has no
 * "before" layout to animate from on window resize. Owning the geometry lets
 * us keep the old positions and let every tile glide, grow and re-center into
 * the new layout — the morphing resize — while rows (including the last one)
 * stay horizontally centered.
 */
export default function VideoWall({ videos }: { videos: Video[] }) {
  const wallRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef(new Map<string, HTMLButtonElement>());
  const [metrics, setMetrics] = useState({
    width: FALLBACK_WIDTH,
    gap: 20,
    measured: false,
  });
  const [layoutReady, setLayoutReady] = useState(false);
  const [active, setActive] = useState<ActiveVideo | null>(null);
  // True from the first width change of a drag until 200ms after the last one.
  const [resizing, setResizing] = useState(false);
  // null keeps the wall edge-to-edge; a number pins every frame to that width.
  const [frameWidth, setFrameWidth] = useState<number | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const sizeSettle = useRef(0);

  useEffect(() => {
    return () => window.clearTimeout(sizeSettle.current);
  }, []);

  const changeFrameWidth = useCallback((value: number) => {
    setFrameWidth(value);
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
      const width = entries[0]?.contentRect.width ?? wall.getBoundingClientRect().width;
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

  // The slider can pin a frame width; otherwise the wall fills its container.
  // The slider's range follows the available width so it never overflows on
  // narrow screens.
  const sliderMax = Math.min(
    MAX_FRAME_WIDTH,
    Math.max(MIN_FRAME_WIDTH, Math.round(metrics.width)),
  );
  const sliderMin = Math.min(MIN_FRAME_WIDTH, sliderMax);
  const activeFrameWidth =
    frameWidth === null
      ? null
      : Math.min(Math.max(frameWidth, sliderMin), sliderMax);

  const columns = activeFrameWidth
    ? Math.max(
        1,
        Math.floor(
          (metrics.width + metrics.gap + 0.5) /
            (activeFrameWidth + metrics.gap),
        ),
      )
    : columnsFor(metrics.width, metrics.gap);
  const cardWidth = activeFrameWidth
    ? Math.min(
        activeFrameWidth,
        (metrics.width - metrics.gap * (columns - 1)) / columns,
      )
    : Math.max(
        0,
        (metrics.width - metrics.gap * (columns - 1)) / columns,
      );
  const cardHeight = cardWidth / TILE_ASPECT;
  const rows = Math.max(1, Math.ceil(videos.length / columns));
  const wallHeight =
    videos.length > 0 ? rows * cardHeight + (rows - 1) * metrics.gap : 0;

  const shownFrameWidth = Math.round(cardWidth);
  const sliderValue = Math.min(
    Math.max(shownFrameWidth, sliderMin),
    sliderMax,
  );

  const layout: TileLayout[] = videos.map((_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const itemsInRow = Math.min(columns, videos.length - row * columns);
    const rowWidth =
      itemsInRow * cardWidth + Math.max(0, itemsInRow - 1) * metrics.gap;
    const rowOffset = Math.max(0, (metrics.width - rowWidth) / 2);

    return {
      x: rowOffset + column * (cardWidth + metrics.gap),
      y: row * (cardHeight + metrics.gap),
      width: cardWidth,
      height: cardHeight,
    };
  });

  const registerRef = useCallback(
    (id: string, element: HTMLButtonElement | null) => {
      if (element) tileRefs.current.set(id, element);
      else tileRefs.current.delete(id);
    },
    [],
  );

  const openVideo = useCallback(
    (index: number, element: HTMLButtonElement) => {
      const rect = element.getBoundingClientRect();
      setActive({
        index,
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

    const element = tileRefs.current.get(videos[active.index]?.id ?? "");
    if (!element) return active.originRect;

    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }, [active, videos]);

  const exitLightbox = useCallback(() => {
    const index = active?.index;
    setActive(null);

    // The wall is inert while the frame is open, so the browser cannot return
    // focus on its own. Hand it back to the tile that launched the frame once
    // that inert state has been removed.
    if (index === undefined) return;
    const id = videos[index]?.id;
    if (!id) return;
    requestAnimationFrame(() => tileRefs.current.get(id)?.focus());
  }, [active, videos]);

  const hasVideos = videos.length > 0;
  const activeVideo = active ? videos[active.index] : null;

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
                A wall of silent films, playing all at once, forever. No
                timelines, no controls, no sound. Click a frame to step inside —
                click away to return.
              </p>

              <dl className="specs" aria-label="Wall details">
                <div className="spec">
                  <dt>Films</dt>
                  <dd>{pad(videos.length)}</dd>
                </div>
                <div className="spec">
                  <dt>Per row</dt>
                  <dd>{pad(columns)}</dd>
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
                <span className="frame-label">
                  <span className="frame-label-prefix">Frame </span>size
                </span>
                <input
                  className="frame-slider"
                  type="range"
                  min={sliderMin}
                  max={sliderMax}
                  step={2}
                  value={sliderValue}
                  onChange={(event) =>
                    changeFrameWidth(Number(event.target.value))
                  }
                  aria-label="Frame size"
                  aria-valuetext={`${shownFrameWidth} pixels`}
                />
                <output className="frame-value">
                  {shownFrameWidth}
                  <span>px</span>
                </output>
              </label>
              <span className="wall-hint">Click a frame to step inside</span>
            </div>
          </div>

          {hasVideos ? (
            <div
              className="wall"
              ref={wallRef}
              data-ready={layoutReady ? "true" : "false"}
              data-adjusting={adjusting ? "true" : undefined}
              style={{ height: wallHeight || undefined }}
            >
              {videos.map((video, index) => {
                const position = layout[index];
                return (
                  <div
                    key={video.id}
                    className="tile-slot"
                    data-ready={layoutReady ? "true" : "false"}
                    style={{
                      width: position.width,
                      height: position.height,
                      transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
                    }}
                  >
                    <VideoTile
                      video={video}
                      index={index}
                      hidden={active?.index === index}
                      paused={active !== null}
                      suspended={resizing || adjusting}
                      onOpen={openVideo}
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
                Drop a <code>.mp4</code> or <code>.webm</code> into{" "}
                <code>public/videos</code>, then reload. Every file in that
                folder and its subfolders joins the wall automatically.
              </p>
              <code className="empty-command">npm run posters</code>
            </div>
          )}
        </main>

        <footer className="footer">
          <div>
            <p className="footer-title">Still / Moving</p>
            <p className="footer-copy">
              A local, silent video wall. Nothing leaves this machine.
            </p>
          </div>
          <div className="footer-meta">
            <span>
              Films <span className="footer-value">{pad(videos.length)}</span>
            </span>
            <span>
              Columns <span className="footer-value">{pad(columns)}</span>
            </span>
            <span className="footer-stamp">Next.js · Motion</span>
          </div>
        </footer>
      </div>

      {active && activeVideo ? (
        <Lightbox
          video={activeVideo}
          index={active.index}
          total={videos.length}
          originRect={active.originRect}
          getReturnRect={getReturnRect}
          onExited={exitLightbox}
        />
      ) : null}
    </MotionConfig>
  );
}
