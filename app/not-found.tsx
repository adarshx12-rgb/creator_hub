import Link from "next/link";
import { CompassIcon } from "lucide-react";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <CompassIcon size={22} className="text-text-faint" />
      <h1 className="text-sm font-medium text-text">Nothing here</h1>
      <p className="text-sm leading-relaxed text-text-muted">
        This video or page couldn&apos;t be found. It may have been removed or made private.
      </p>
      <Link href="/" className="mt-1 text-sm text-accent-strong hover:underline">
        Back to search
      </Link>
    </div>
  );
}
