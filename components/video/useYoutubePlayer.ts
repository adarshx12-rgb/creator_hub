"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface YTPlayer {
  getCurrentTime: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  destroy: () => void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    options: {
      videoId: string;
      playerVars?: Record<string, number>;
      events?: { onReady?: () => void };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;

function loadYoutubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
  return apiPromise;
}

export function useYoutubePlayer(videoId: string, enabled: boolean, startSeconds?: number) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const previewEnd = useRef<number | null>(null);

  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(() => {
      const time = playerRef.current?.getCurrentTime() ?? 0;
      setCurrentTime(time);
      if (previewEnd.current !== null && time >= previewEnd.current) {
        playerRef.current?.pauseVideo();
        previewEnd.current = null;
      }
    }, 150);
    return () => clearInterval(timer);
  }, [ready]);

  const seekTo = useCallback((seconds: number) => {
    previewEnd.current = null;
    playerRef.current?.seekTo(seconds, true);
    playerRef.current?.playVideo();
  }, []);
  const previewRange = useCallback((start: number, end: number) => {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return;
    previewEnd.current = end;
    playerRef.current?.seekTo(start, true);
    playerRef.current?.playVideo();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let destroyed = false;

    void loadYoutubeApi().then(() => {
      if (destroyed || !containerRef.current || !window.YT) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        playerVars: {
          rel: 0,
          modestbranding: 1,
          ...(startSeconds ? { start: Math.floor(startSeconds) } : {}),
        },
        events: {
          onReady: () => {
            if (!destroyed) setReady(true);
          },
        },
      });
    });

    return () => {
      destroyed = true;
      playerRef.current?.destroy?.();
      playerRef.current = null;
      previewEnd.current = null;
      setReady(false);
    };
    // startSeconds intentionally excluded - it should only seed the initial load, not re-init the player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, enabled]);

  return {
    containerRef,
    ready,
    currentTime,
    previewRange,
    getCurrentTime: () => playerRef.current?.getCurrentTime() ?? 0,
    seekTo,
  };
}
