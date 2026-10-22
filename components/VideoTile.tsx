"use client";

import { useCallback } from "react";
import { motion } from "motion/react";
import type { Media } from "@/lib/videos";
import LazyVideo from "./LazyVideo";
import { ExpandIcon } from "./icons";

const EASE = [0.22, 1, 0.36, 1] as const;

type VideoTileProps = {
  media: Media;
  index: number;
  hidden: boolean;
  paused: boolean;
  /** The wall is being resized; freeze playback so decoding cannot compete with layout. */
  suspended: boolean;
  onOpen: (index: number, element: HTMLButtonElement) => void;
  registerRef: (id: string, element: HTMLButtonElement | null) => void;
};

export default function VideoTile({
  media,
  index,
  hidden,
  paused,
  suspended,
  onOpen,
  registerRef,
}: VideoTileProps) {
  const buttonRef = useCallback(
    (element: HTMLButtonElement | null) => registerRef(media.id, element),
    [registerRef, media.id],
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      onOpen(index, event.currentTarget);
    },
    [index, onOpen],
  );

  const delay = Math.min(index * 0.04, 0.4);

  return (
    <motion.article
      className="tile"
      data-kind={media.kind}
      data-hidden={hidden || undefined}
      aria-hidden={hidden || undefined}
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        opacity: { duration: 0.65, delay, ease: EASE },
        y: { duration: 0.75, delay, ease: EASE },
      }}
    >
      <div className="tile-media">
        {media.kind === "image" ? (
          // The still is its own poster: no generated frame, no video element.
          <img
            className="tile-image"
            src={media.src}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : (
          <LazyVideo
            src={media.src}
            poster={media.poster}
            paused={paused}
            suspended={suspended}
            className="tile-video"
          />
        )}
        <span className="tile-veil" aria-hidden="true" />
      </div>

      <div className="tile-top" aria-hidden="true">
        <span className="tile-index">{String(index + 1).padStart(2, "0")}</span>
        <span className="tile-expand">
          <ExpandIcon />
        </span>
      </div>

      <div className="tile-caption">
        {media.collection ? (
          <span className="tile-collection">{media.collection}</span>
        ) : null}
        <h2 className="tile-title">{media.title}</h2>
        <span className="tile-meta">
          {media.kind === "video" ? "Muted loop" : "Still"}
        </span>
      </div>

      <button
        ref={buttonRef}
        type="button"
        className="tile-hit"
        onClick={handleClick}
        aria-label={`Open ${media.title} full screen`}
      />
    </motion.article>
  );
}
