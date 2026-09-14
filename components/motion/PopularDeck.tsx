"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useInView, useMotionValue, type Variants } from "motion/react";
import { ArrowUpRight, CarFront, ChevronLeft, ChevronRight, Mic, Mountain, Pause, Play, Rocket, Sparkles, TrendingUp, type LucideIcon } from "lucide-react";
import { MotionPreferenceNote } from "@/components/motion/MotionPreferenceNote";
import { formatRelativeDate } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import type { PopularVideos } from "@/lib/types";

const DWELL_SECONDS = 4.5;
const ease = [0.16, 1, 0.3, 1] as const;

type DeckItem =
  | { kind: "video"; key: string; title: string; subtitle: string; image: string; href: string }
  | { kind: "topic"; key: string; title: string; query: string; icon: LucideIcon; tint: string };

const EXAMPLE_TOPICS: DeckItem[] = [
  { kind: "topic", key: "podcasts", title: "Long-form podcast interviews", query: "Long-form podcast interview about discipline", icon: Mic, tint: "#e3a34e" },
  { kind: "topic", key: "night-drive", title: "Night driving in the rain", query: "Red sports car driving through rain at night, no text overlays", icon: CarFront, tint: "#6d8cff" },
  { kind: "topic", key: "founders", title: "Founder stories", query: "Startup founder describing failure before their first success", icon: Rocket, tint: "#55b9b0" },
  { kind: "topic", key: "expeditions", title: "Mountain expeditions", query: "Hiker reaching a mountain ridge at sunrise", icon: Mountain, tint: "#c47de8" },
];

// Resting poses by stack depth; index 3 is the hidden slot cards enter from and sink back into.
const STACK = [
  { x: "0%", y: 0, scale: 1, rotate: 0, skewY: 0, rotateY: 0, opacity: 1, zIndex: 30 },
  { x: "5%", y: -24, scale: 0.93, rotate: 2.5, skewY: -2.5, rotateY: -10, opacity: 0.7, zIndex: 20 },
  { x: "9%", y: -44, scale: 0.86, rotate: 5, skewY: -4, rotateY: -18, opacity: 0.4, zIndex: 10 },
  { x: "12%", y: -58, scale: 0.8, rotate: 7, skewY: -5.5, rotateY: -24, opacity: 0, zIndex: 0 },
];
const THROWN = { x: "-65%", y: 36, scale: 0.88, rotate: -14, skewY: 10, rotateY: 48, opacity: 0, zIndex: 40 };

const SETTLE = { type: "spring", stiffness: 150, damping: 21, mass: 0.9, opacity: { duration: 0.45, ease }, zIndex: { duration: 0 } } as const;
// Reduced motion keeps every card in place and only cross-fades.
const FADE = { duration: 0, opacity: { duration: 0.45, ease } } as const;

type Motion = { direction: number; reduced: boolean };

const cardVariants: Variants = {
  enter: ({ direction, reduced }: Motion) => (reduced ? { opacity: 0 } : direction > 0 ? STACK[3] : THROWN),
  exit: ({ direction, reduced }: Motion) =>
    reduced
      ? { opacity: 0, transition: { duration: 0.45, ease } }
      : { ...(direction > 0 ? THROWN : STACK[3]), transition: { duration: 0.7, ease, zIndex: { duration: 0 } } },
};

function statusLine({ status, videos, fetchedAt }: PopularVideos): string {
  if (status === "ok" && videos.length > 0) {
    return fetchedAt ? `YouTube's most popular chart · updated ${formatRelativeDate(fetchedAt)}` : "YouTube's most popular chart";
  }
  if (status === "setup_required") return "Add a YouTube API key to show popular videos";
  if (status === "quota_exceeded") return "YouTube's daily quota is used up, so examples are shown";
  return "Popular videos are unavailable right now";
}

export function PopularDeck({ popular, onSearch }: { popular: PopularVideos; onSearch: (query: string) => void }) {
  const live = popular.status === "ok" && popular.videos.length > 0;
  const items: DeckItem[] = live
    ? popular.videos.map((video) => ({
        kind: "video",
        key: video.id,
        title: video.title,
        subtitle: video.channelTitle,
        image: video.thumbnailUrl,
        href: `/video/youtube/${encodeURIComponent(video.id)}`,
      }))
    : EXAMPLE_TOPICS;
  const count = items.length;

  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [userPaused, setUserPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const inView = useInView(stageRef, { amount: 0.4 });
  const progress = useMotionValue(0);

  const autoplay = count > 1 && !userPaused;
  const running = autoplay && inView && !hovered && !focused && !pageHidden;

  const step = useCallback(
    (delta: number) => {
      setDirection(delta);
      setIndex((current) => (current + delta + count) % count);
    },
    [count],
  );

  function jump(target: number) {
    if (target === index) return;
    setDirection(target > index ? 1 : -1);
    setIndex(target);
  }

  useEffect(() => {
    const onVisibility = () => setPageHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    progress.set(0);
  }, [index, progress]);

  useEffect(() => {
    if (!running) return;
    // Resumes from wherever a pause left the progress bar instead of restarting the dwell time.
    const controls = animate(progress, 1, {
      duration: DWELL_SECONDS * (1 - progress.get()),
      ease: "linear",
      onComplete: () => step(1),
    });
    return () => controls.stop();
  }, [running, index, progress, step]);

  const current = items[index];
  const custom: Motion = { direction, reduced };
  const visible = Array.from({ length: Math.min(3, count) }, (_, offset) => ({ offset, item: items[(index + offset) % count] }));

  return (
    <section aria-roledescription="carousel" aria-label={live ? "Popular on YouTube" : "Example topics"} className="flex min-w-0 flex-col">
      <div className="flex min-h-10 items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          {live ? <TrendingUp size={14} /> : <Sparkles size={14} />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">{live ? "Popular on YouTube" : "Example topics"}</p>
          <p className="truncate text-[11px] text-text-faint" suppressHydrationWarning>
            {statusLine(popular)}
          </p>
        </div>
        {count > 1 && (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <DeckButton label="Previous" onClick={() => step(-1)}>
              <ChevronLeft size={16} />
            </DeckButton>
            <DeckButton label={userPaused ? "Resume rotation" : "Pause rotation"} onClick={() => setUserPaused((paused) => !paused)}>
              {userPaused ? <Play size={14} /> : <Pause size={14} />}
            </DeckButton>
            <DeckButton label="Next" onClick={() => step(1)}>
              <ChevronRight size={16} />
            </DeckButton>
          </div>
        )}
      </div>

      <div
        ref={stageRef}
        className="relative pr-[8%] pt-[4.5rem]"
        onPointerEnter={(event) => event.pointerType === "mouse" && setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
        }}
      >
        <AnimatePresence initial={false}>
          <motion.div
            key={current.key}
            aria-hidden="true"
            className="pointer-events-none absolute bottom-[-6%] left-[4%] right-[12%] top-[30%] overflow-hidden rounded-[2rem] blur-3xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.45 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.45 : 0.9 }}
          >
            {current.kind === "video" ? (
              <Image src={current.image} alt="" fill sizes="160px" className="object-cover" />
            ) : (
              <div className="absolute inset-0" style={{ background: current.tint }} />
            )}
          </motion.div>
        </AnimatePresence>

        <div className="relative aspect-video" style={{ perspective: 1400 }} aria-live={running ? "off" : "polite"}>
          <AnimatePresence initial={false} custom={custom}>
            {visible.map(({ item, offset }) => (
              <motion.div
                key={item.key}
                custom={custom}
                variants={cardVariants}
                initial="enter"
                animate={STACK[offset]}
                exit="exit"
                transition={reduced ? FADE : SETTLE}
                className={`absolute inset-0 ${offset === 0 ? "" : "pointer-events-none"}`}
                aria-hidden={offset === 0 ? undefined : true}
                role={offset === 0 ? "group" : undefined}
                aria-roledescription={offset === 0 ? "slide" : undefined}
                aria-label={offset === 0 ? `${index + 1} of ${count}` : undefined}
              >
                <DeckCard item={item} interactive={offset === 0} onSearch={onSearch} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {count > 1 && (
        <div className="mt-3 flex items-center justify-center">
          {items.map((item, i) => (
            <button
              key={item.key}
              type="button"
              onClick={() => jump(i)}
              aria-label={`Show ${i + 1} of ${count}`}
              aria-current={i === index ? "true" : undefined}
              className="group flex h-7 items-center px-1"
            >
              <span
                className={`relative block h-1 overflow-hidden rounded-full transition-[width,background-color] duration-500 ${
                  i === index ? "w-8 bg-white/15" : "w-2 bg-white/15 group-hover:bg-white/35"
                }`}
              >
                {i === index && <motion.span className="absolute inset-0 origin-left rounded-full bg-accent" style={{ scaleX: autoplay ? progress : 1 }} />}
              </span>
            </button>
          ))}
        </div>
      )}
      <MotionPreferenceNote />
    </section>
  );
}

function DeckButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
    >
      {children}
    </button>
  );
}

function DeckCard({ item, interactive, onSearch }: { item: DeckItem; interactive: boolean; onSearch: (query: string) => void }) {
  const shell =
    "group relative block h-full w-full overflow-hidden bg-surface-raised text-left shadow-[0_30px_70px_-30px_rgba(0,0,0,0.9)] ring-1 ring-white/10";
  // Inline radius: the global :focus-visible rule would otherwise square the card's corners.
  const radius = { borderRadius: "1rem" };
  const tabIndex = interactive ? undefined : -1;

  if (item.kind === "video") {
    return (
      <Link href={item.href} tabIndex={tabIndex} className={shell} style={radius} aria-label={`${item.title}, by ${item.subtitle}. Open source details`}>
        <Image
          src={item.image}
          alt=""
          fill
          loading="eager"
          sizes="(max-width: 1024px) 90vw, 560px"
          className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
        />
        <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-black/5" />
        <span className="absolute inset-0 bg-[linear-gradient(120deg,transparent_35%,rgba(255,255,255,0.1)_50%,transparent_65%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
        <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-medium tracking-wide text-white backdrop-blur-md">
          YouTube
        </span>
        <span className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white opacity-0 backdrop-blur-md transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100">
          <ArrowUpRight size={15} />
        </span>
        <span className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
          <span className="line-clamp-2 font-display text-[0.95rem] font-medium leading-snug text-white sm:text-lg">{item.title}</span>
          <span className="mt-1 block truncate text-xs text-white/65">{item.subtitle}</span>
        </span>
      </Link>
    );
  }

  const Icon = item.icon;
  return (
    <button type="button" tabIndex={tabIndex} onClick={() => onSearch(item.query)} className={shell} style={radius} aria-label={`Search example topic: ${item.title}`}>
      <span
        className="absolute inset-0"
        style={{
          background: `radial-gradient(120% 90% at 85% 10%, ${item.tint}55 0%, transparent 55%), radial-gradient(90% 80% at 0% 100%, ${item.tint}30 0%, transparent 60%), linear-gradient(160deg, #1d212a 0%, #12151b 100%)`,
        }}
      />
      <span className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:28px_28px] [mask-image:radial-gradient(circle_at_70%_30%,black,transparent_75%)]" />
      <Icon
        className="absolute right-[8%] top-1/2 aspect-square h-[46%] w-auto -translate-y-1/2 text-white/[0.14] transition-transform duration-700 group-hover:scale-110"
        strokeWidth={1.25}
      />
      <span className="absolute left-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-[10px] font-medium text-white/80 backdrop-blur-md">Example topic</span>
      <span className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
        <span className="block font-display text-base font-medium text-white sm:text-lg">{item.title}</span>
        <span className="mt-1 inline-flex items-center gap-1 text-xs text-white/65">
          Search this topic <ArrowUpRight size={12} />
        </span>
      </span>
    </button>
  );
}
