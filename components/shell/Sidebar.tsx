"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav-items";
import { Logo } from "./Logo";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:w-60 md:flex-col md:border-r md:border-border md:bg-surface md:shrink-0">
      <div className="flex h-16 items-center px-5">
        <Link href="/" aria-label="MomentScout home">
          <Logo />
        </Link>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-2" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-accent-soft text-accent-strong"
                  : "text-text-muted hover:bg-surface-hover hover:text-text"
              }`}
            >
              <Icon size={17} strokeWidth={1.75} className="shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border px-5 py-4">
        <p className="text-xs leading-relaxed text-text-faint">
          Local workspace. Saved moments and uploads stay on this device.
        </p>
      </div>
    </aside>
  );
}
