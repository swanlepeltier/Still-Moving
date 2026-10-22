"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import type { Media } from "@/lib/videos";
import {
  CloseIcon,
  PauseIcon,
  PlayIcon,
  SoundOffIcon,
  SoundOnIcon,
} from "./icons";

type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type LightboxProps = {
  media: Media;
  index: number;
  total: number;
  originRect: Rect;
  getReturnRect: () => Rect;
  /** Tile playback position when the frame was opened. */
  startTime: number;
  /** Receives the lightbox playback position so the tile can resume there. */
  onExited: (position: number) => void;
};

const OPEN_SPRING = {
  type: "spring" as const,
  stiffness: 165,
  damping: 26,
  mass: 1.02,
};

const CLOSE_EASE = [0.32, 0.72, 0, 1] as const;

const FALLBACK_ASPECT = 16 / 10;

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export default function Lightbox({
  media,
  index,
  total,
  originRect,
  getReturnRect,
  startTime,
  onExited,
}: LightboxProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closingRef = useRef(false);
  const reportedRef = useRef(false);
  const exitTimeRef = useRef(0);
  const getReturnRectRef = useRef(getReturnRect);

  const reducedMotion = useReducedMotion();
  const isVideo = media.kind === "video";
  const [paused, setPaused] = useState(Boolean(reducedMotion));
  const [muted, setMuted] = useState(true);
  const [ready, setReady] = useState(false);
  const [closing, setClosing] = useState(false);
  const [exitRect, setExitRect] = useState<Rect>(originRect);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    getReturnRectRef.current = getReturnRect;
  }, [getReturnRect]);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (videoRef.current) exitTimeRef.current = videoRef.current.currentTime;
    setExitRect(getReturnRectRef.current());
    setClosing(true);
    videoRef.current?.pause();
  }, []);

  // Keep the full-screen frame aligned when the window changes size.
  useEffect(() => {
    const onResize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Lock the page behind the frame without the content jumping sideways.
  useEffect(() => {
    const body = document.body;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;

    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
  }, []);

  // Focus the close control, trap Tab (including the timeline range), and
  // restore focus on exit.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }

      if (event.key !== "Tab") return;
      const container = frameRef.current;
      if (!container) return;

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const isInside = container.contains(document.activeElement);

      if (event.shiftKey && (!isInside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (!isInside || document.activeElement === last)
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [requestClose]);

  const handleFrameAnimationComplete = useCallback(() => {
    if (!closingRef.current || reportedRef.current) return;
    reportedRef.current = true;
    if (videoRef.current) exitTimeRef.current = videoRef.current.currentTime;
    onExited(exitTimeRef.current);
  }, [onExited]);

  // Start the full-screen film where the tile left off, then play it. The tile
  // itself stays paused while the frame is open, so there is only one decoder.
  const primeVideo = useCallback(() => {
    const element = videoRef.current;
    if (!element) return;

    if (Number.isFinite(element.duration)) setDuration(element.duration);

    if (startTime > 0 && Number.isFinite(element.duration)) {
      element.currentTime = Math.min(
        startTime,
        Math.max(0, element.duration - 0.05),
      );
      setTime(element.currentTime);
    }

    if (!reducedMotion) void element.play().catch(() => {});
  }, [reducedMotion, startTime]);

  // Keep native playback state in sync with the custom controls.
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    if (paused) {
      element.pause();
      return;
    }
    if (element.readyState >= 1) void element.play().catch(() => {});
  }, [paused]);

  useEffect(() => {
    const element = videoRef.current;
    if (element) element.muted = muted;
  }, [muted]);

  // The range follows playback without re-rendering for every decoded frame.
  useEffect(() => {
    if (!isVideo || paused || closing) return;
    let frame = 0;
    let last = 0;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < 100) return;
      last = now;
      const element = videoRef.current;
      if (element && !element.seeking) setTime(element.currentTime);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [closing, isVideo, paused]);

  const seekTo = useCallback((next: number) => {
    const element = videoRef.current;
    if (!element) return;
    const limit = Number.isFinite(element.duration)
      ? element.duration
      : Math.max(0, next);
    const clamped = Math.min(Math.max(next, 0), Math.max(0, limit));
    element.currentTime = clamped;
    setTime(clamped);
  }, []);

  const pad = Math.round(
    Math.min(40, Math.max(14, Math.min(viewport.width, viewport.height) * 0.035)),
  );

  // Fit the frame to the file's own aspect inside the viewport padding, so the
  // media fills it edge to edge instead of sitting in letterbox bars.
  const aspect = media.aspect > 0 ? media.aspect : FALLBACK_ASPECT;
  const availableWidth = Math.max(0, viewport.width - pad * 2);
  const availableHeight = Math.max(0, viewport.height - pad * 2);
  const openWidth = Math.min(availableWidth, availableHeight * aspect);
  const openHeight = openWidth / aspect;

  const openFrame = {
    x: (viewport.width - openWidth) / 2,
    y: (viewport.height - openHeight) / 2,
    width: openWidth,
    height: openHeight,
  };

  const closedFrame = {
    x: closing ? exitRect.left : originRect.left,
    y: closing ? exitRect.top : originRect.top,
    width: closing ? exitRect.width : originRect.width,
    height: closing ? exitRect.height : originRect.height,
  };

  return createPortal(
    <div
      className="lightbox"
      data-kind={media.kind}
      role="dialog"
      aria-modal="true"
      aria-labelledby="lightbox-title"
    >
      <motion.div
        className="lightbox-backdrop"
        aria-hidden="true"
        onClick={requestClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: closing ? 0 : 1 }}
        transition={{ duration: closing ? 0.3 : 0.45, ease: "easeOut" }}
      />

      <motion.div
        ref={frameRef}
        className="lightbox-frame"
        initial={closedFrame}
        animate={closing ? closedFrame : openFrame}
        transition={closing ? { duration: 0.48, ease: CLOSE_EASE } : OPEN_SPRING}
        onAnimationComplete={handleFrameAnimationComplete}
      >
        {isVideo ? (
          <>
            {media.poster ? (
              <img
                className="lightbox-poster"
                src={media.poster}
                alt=""
                decoding="async"
                draggable={false}
              />
            ) : null}

            <video
              ref={videoRef}
              className={`lightbox-video${ready ? " is-ready" : ""}`}
              src={media.src}
              muted
              loop
              playsInline
              preload="auto"
              onLoadedMetadata={primeVideo}
              onDurationChange={() => {
                const element = videoRef.current;
                if (element && Number.isFinite(element.duration)) {
                  setDuration(element.duration);
                }
              }}
              onPlaying={() => {
                setReady(true);
                setPaused(false);
              }}
              onPause={() => setPaused(true)}
            />
          </>
        ) : (
          <img
            className="lightbox-image"
            src={media.src}
            alt=""
            decoding="async"
            draggable={false}
          />
        )}

        <motion.div
          className="lightbox-ui"
          initial={{ opacity: 0 }}
          animate={{ opacity: closing ? 0 : 1 }}
          transition={{
            duration: closing ? 0.18 : 0.4,
            delay: closing ? 0 : 0.2,
          }}
        >
          <button
            ref={closeButtonRef}
            type="button"
            className="lightbox-close icon-button"
            onClick={requestClose}
            aria-label="Close full screen"
          >
            <CloseIcon />
          </button>

          {isVideo && paused ? (
            <button
              type="button"
              className="lightbox-center-play"
              onClick={() => setPaused(false)}
              aria-label="Play film"
            >
              <PlayIcon />
            </button>
          ) : null}

          <div className="lightbox-caption">
            <div className="lightbox-copy">
              <p className="lightbox-kicker">
                {String(index + 1).padStart(2, "0")} /{" "}
                {String(total).padStart(2, "0")}
                {media.collection ? ` — ${media.collection}` : ""}
              </p>
              <h2 className="lightbox-title" id="lightbox-title">
                {media.title}
              </h2>
              <p className="lightbox-file">{media.filename}</p>
            </div>

            <div className="lightbox-actions">
              <span className="lightbox-hint">Esc / click outside</span>
              {isVideo ? (
                <>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setPaused((value) => !value)}
                    aria-label={paused ? "Play film" : "Pause film"}
                    aria-pressed={paused}
                  >
                    {paused ? <PlayIcon /> : <PauseIcon />}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setMuted((value) => !value)}
                    aria-label={muted ? "Turn sound on" : "Mute film"}
                    aria-pressed={!muted}
                  >
                    {muted ? <SoundOffIcon /> : <SoundOnIcon />}
                  </button>
                </>
              ) : null}
            </div>

            {isVideo ? (
              <div className="lightbox-scrubber">
                <span className="lightbox-time">{formatTime(time)}</span>
                <input
                  className="lightbox-range"
                  type="range"
                  min={0}
                  max={duration > 0 ? duration : 1}
                  step={0.01}
                  value={Math.min(time, duration > 0 ? duration : 0)}
                  disabled={duration <= 0}
                  onChange={(event) => seekTo(Number(event.target.value))}
                  onPointerDown={(event) => event.stopPropagation()}
                  aria-label="Film position"
                  aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`}
                />
                <span className="lightbox-time">{formatTime(duration)}</span>
              </div>
            ) : null}
          </div>
        </motion.div>
      </motion.div>
    </div>,
    document.body,
  );
}
