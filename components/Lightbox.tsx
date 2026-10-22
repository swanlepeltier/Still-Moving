"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import type { Video } from "@/lib/videos";
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
  video: Video;
  index: number;
  total: number;
  originRect: Rect;
  getReturnRect: () => Rect;
  onExited: () => void;
};

const OPEN_SPRING = {
  type: "spring" as const,
  stiffness: 165,
  damping: 26,
  mass: 1.02,
};

const CLOSE_EASE = [0.32, 0.72, 0, 1] as const;

export default function Lightbox({
  video,
  index,
  total,
  originRect,
  getReturnRect,
  onExited,
}: LightboxProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closingRef = useRef(false);
  const getReturnRectRef = useRef(getReturnRect);

  const reducedMotion = useReducedMotion();
  const [paused, setPaused] = useState(Boolean(reducedMotion));
  const [muted, setMuted] = useState(true);
  const [ready, setReady] = useState(false);
  const [closing, setClosing] = useState(false);
  const [exitRect, setExitRect] = useState<Rect>(originRect);
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

  // Focus the close control, trap Tab, and restore focus on exit.
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
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const isInside = container.contains(document.activeElement);

      if (event.shiftKey && (!isInside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!isInside || document.activeElement === last)) {
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
    if (closingRef.current) onExited();
  }, [onExited]);

  // Keep native playback state in sync with the custom controls.
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    if (paused) element.pause();
    else void element.play().catch(() => {});
  }, [paused]);

  useEffect(() => {
    const element = videoRef.current;
    if (element) element.muted = muted;
  }, [muted]);

  const pad = Math.round(
    Math.min(40, Math.max(14, Math.min(viewport.width, viewport.height) * 0.035)),
  );

  const openFrame = {
    x: pad,
    y: pad,
    width: viewport.width - pad * 2,
    height: viewport.height - pad * 2,
  };

  const closedFrame = {
    x: closing ? exitRect.left : originRect.left,
    y: closing ? exitRect.top : originRect.top,
    width: closing ? exitRect.width : originRect.width,
    height: closing ? exitRect.height : originRect.height,
  };

  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-labelledby="lightbox-title">
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
        transition={
          closing
            ? { duration: 0.48, ease: CLOSE_EASE }
            : OPEN_SPRING
        }
        onAnimationComplete={handleFrameAnimationComplete}
      >
        {video.poster ? (
          <img
            className="lightbox-poster"
            src={video.poster}
            alt=""
            decoding="async"
            draggable={false}
          />
        ) : null}

        <video
          ref={videoRef}
          className={`lightbox-video${ready ? " is-ready" : ""}`}
          src={video.src}
          autoPlay={!reducedMotion}
          muted
          loop
          playsInline
          preload="auto"
          onPlaying={() => {
            setReady(true);
            setPaused(false);
          }}
          onPause={() => setPaused(true)}
        />

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

          {paused ? (
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
                {video.collection ? ` — ${video.collection}` : ""}
              </p>
              <h2 className="lightbox-title" id="lightbox-title">
                {video.title}
              </h2>
              <p className="lightbox-file">{video.filename}</p>
            </div>

            <div className="lightbox-actions">
              <span className="lightbox-hint">Esc / click outside</span>
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
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>,
    document.body,
  );
}
