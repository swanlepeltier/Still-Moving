"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

type LazyVideoProps = {
  src: string;
  poster: string | null;
  /** Pause everything while the full-screen view is open. */
  paused: boolean;
  /** Pause while the wall is mid-resize; the current frame stays on screen. */
  suspended?: boolean;
  className?: string;
};

/**
 * Poster-first, viewport-aware video.
 *
 * - Nothing is downloaded until the tile is within half a screen.
 * - Playback is limited to videos actually on screen; everything else pauses.
 * - Posters cover the gap while a file is fetched.
 * - A resize drag pauses playback: every tile is being rescaled at once, and
 *   asking the decoder to keep up with eight of them is what makes the whole
 *   window feel stuck. Pausing freezes the last decoded frame in place, so the
 *   tiles still glide, and it resumes ~200ms after the drag stops.
 * - With reduced motion enabled, the tile stays a still image; the full-screen
 *   view offers a play control instead.
 */
export default function LazyVideo({
  src,
  poster,
  paused,
  suspended = false,
  className,
}: LazyVideoProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [inView, setInView] = useState(false);
  const [playing, setPlaying] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const loadObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          loadObserver.disconnect();
        }
      },
      { rootMargin: "500px 0px" },
    );

    loadObserver.observe(host);
    return () => loadObserver.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldLoad) return;
    const host = hostRef.current;
    if (!host) return;

    const playObserver = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting && entry.intersectionRatio > 0.12),
      { threshold: [0, 0.12, 0.5] },
    );

    playObserver.observe(host);
    return () => playObserver.disconnect();
  }, [shouldLoad]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const shouldPlay = shouldLoad && inView && !paused && !suspended && !reducedMotion;
    if (!shouldPlay) {
      video.pause();
      return;
    }

    const resume = () => {
      if (!document.hidden) void video.play().catch(() => {});
    };

    resume();
    document.addEventListener("visibilitychange", resume);
    return () => document.removeEventListener("visibilitychange", resume);
  }, [shouldLoad, inView, paused, suspended, reducedMotion]);

  return (
    <div ref={hostRef} className={`lazy-video ${className ?? ""}`}>
      {poster ? (
        // Plain <img>: posters are already small, local, static files.
        <img
          className={`lazy-poster${playing ? " is-hidden" : ""}`}
          src={poster}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      ) : (
        <span className="lazy-poster lazy-poster--empty" aria-hidden="true" />
      )}

      <video
        ref={videoRef}
        className={`lazy-media${playing ? " is-playing" : ""}`}
        src={shouldLoad ? src : undefined}
        preload={inView ? "auto" : "metadata"}
        muted
        loop
        playsInline
        disablePictureInPicture
        tabIndex={-1}
        aria-hidden="true"
        onPlaying={() => setPlaying(true)}
      />
    </div>
  );
}
