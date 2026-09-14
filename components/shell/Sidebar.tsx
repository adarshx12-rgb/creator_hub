"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { NAV_ITEMS } from "./nav-items";
import { Logo } from "./Logo";

const STORAGE_KEY = "momentscout:sidebar-expanded";

export function Sidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(STORAGE_KEY); } catch { /* Storage optional. */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "1") setExpanded(true);
  }, []);

  function toggle() {
    setExpanded((previous) => {
      const next = !previous;
      try { window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* Storage optional. */ }
      return next;
    });
  }

  return (
    <aside
      className={`hidden md:flex md:flex-col md:overflow-hidden md:border-r md:border-border md:bg-surface md:shrink-0 md:transition-[width] md:duration-200 md:ease-out ${
        expanded ? "md:w-60" : "md:w-16"
      }`}
    >
      <div className="flex h-16 items-center gap-2.5 px-3">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse navigation" : "Expand navigation"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text"
        >
          <Menu size={18} strokeWidth={1.75} />
        </button>
        {expanded && (
          <Link href="/" aria-label="MomentScout home" className="min-w-0">
            <Logo />
          </Link>
        )}
      </div>
      <nav className="flex-1 space-y-1 px-3 py-2" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={expanded ? undefined : item.label}
              aria-current={active ? "page" : undefined}
              className={`group flex items-center rounded-md py-2 text-sm transition-colors ${
                expanded ? "gap-3 px-3" : "justify-center px-0"
              } ${
                active
                  ? "bg-accent-soft text-accent-strong"
                  : "text-text-muted hover:bg-surface-hover hover:text-text"
              }`}
            >
              <Icon size={17} strokeWidth={1.75} className="shrink-0" />
              <span className={expanded ? "" : "sr-only"}>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      {expanded && (
        <div className="border-t border-border px-5 py-4">
          <p className="text-xs leading-relaxed text-text-faint">
            Local workspace. Saved moments and uploads stay on this device.
          </p>
        </div>
      )}
    </aside>
  );
}
