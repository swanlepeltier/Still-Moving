"use client";

import { useCallback } from "react";
import { motion } from "motion/react";
import type { Video } from "@/lib/videos";
import LazyVideo from "./LazyVideo";
import { ExpandIcon } from "./icons";

const EASE = [0.22, 1, 0.36, 1] as const;

type VideoTileProps = {
  video: Video;
  index: number;
  hidden: boolean;
  paused: boolean;
  /** The wall is being resized; freeze playback so decoding cannot compete with layout. */
  suspended: boolean;
  onOpen: (index: number, element: HTMLButtonElement) => void;
  registerRef: (id: string, element: HTMLButtonElement | null) => void;
};

export default function VideoTile({
  video,
  index,
  hidden,
  paused,
  suspended,
  onOpen,
  registerRef,
}: VideoTileProps) {
  const buttonRef = useCallback(
    (element: HTMLButtonElement | null) => registerRef(video.id, element),
    [registerRef, video.id],
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
        <LazyVideo
          src={video.src}
          poster={video.poster}
          paused={paused}
          suspended={suspended}
          className="tile-video"
        />
        <span className="tile-veil" aria-hidden="true" />
      </div>

      <div className="tile-top" aria-hidden="true">
        <span className="tile-index">{String(index + 1).padStart(2, "0")}</span>
        <span className="tile-expand">
          <ExpandIcon />
        </span>
      </div>

      <div className="tile-caption">
        {video.collection ? (
          <span className="tile-collection">{video.collection}</span>
        ) : null}
        <h2 className="tile-title">{video.title}</h2>
        <span className="tile-meta">Muted loop</span>
      </div>

      <button
        ref={buttonRef}
        type="button"
        className="tile-hit"
        onClick={handleClick}
        aria-label={`Open ${video.title} full screen`}
      />
    </motion.article>
  );
}
