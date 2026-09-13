import { FolderOpen, Scissors, Search, UploadCloud } from "lucide-react";

export const NAV_ITEMS = [
  { href: "/", label: "Search", icon: Search, match: (path: string) => path === "/" || path.startsWith("/results") || path.startsWith("/video") },
  { href: "/collections", label: "Collections", icon: FolderOpen, match: (path: string) => path.startsWith("/collections") },
  { href: "/studio", label: "Studio", icon: Scissors, match: (path: string) => path.startsWith("/studio") },
  { href: "/exports", label: "Exports", icon: UploadCloud, match: (path: string) => path.startsWith("/exports") },
] as const;
