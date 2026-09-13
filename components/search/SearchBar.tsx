"use client";

import { Search } from "lucide-react";
import { useState } from "react";

interface SearchBarProps {
  defaultValue?: string;
  size?: "lg" | "md";
  placeholder?: string;
  onSubmit: (query: string) => void;
}

export function SearchBar({ defaultValue = "", size = "lg", placeholder, onSubmit }: SearchBarProps) {
  const [value, setValue] = useState(defaultValue);
  const isLarge = size === "lg";

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
      className={`flex w-full items-center gap-2 rounded-lg border border-border-strong bg-surface-raised transition-colors focus-within:border-accent/60 ${
        isLarge ? "px-5 py-4" : "px-3.5 py-2.5"
      }`}
    >
      <Search size={isLarge ? 20 : 17} strokeWidth={1.75} className="shrink-0 text-text-faint" />
      <label htmlFor="moment-search" className="sr-only">
        Search for a person, subject, or topic
      </label>
      <input
        id="moment-search"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder ?? "Naval Ravikant explaining discipline, 20-40 second interview segment"}
        className={`min-w-0 flex-1 bg-transparent text-text placeholder:text-text-faint focus:outline-none ${
          isLarge ? "text-base" : "text-sm"
        }`}
      />
      <button
        type="submit"
        disabled={!value.trim()}
        className={`shrink-0 rounded-md bg-accent font-medium text-accent-ink transition-opacity hover:bg-accent-strong disabled:opacity-30 ${
          isLarge ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-xs"
        }`}
      >
        Search
      </button>
    </form>
  );
}
