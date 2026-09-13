import { AlertTriangle, KeyRound, SearchX, TimerReset } from "lucide-react";
import type { ReactNode } from "react";

interface StatusPanelProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

function StatusPanel({ icon, title, description, action }: StatusPanelProps) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-14 text-center">
      <div className="rounded-full bg-surface-raised p-3 text-text-faint">{icon}</div>
      <h2 className="text-sm font-medium text-text">{title}</h2>
      <p className="text-sm leading-relaxed text-text-muted">{description}</p>
      {action}
    </div>
  );
}

export function SetupRequiredPanel({ message }: { message?: string }) {
  return (
    <StatusPanel
      icon={<KeyRound size={20} />}
      title="Search isn't configured yet"
      description={
        message ??
        "Add a YOUTUBE_API_KEY to your environment to enable real search results. See the README for setup steps."
      }
    />
  );
}

export function QuotaExceededPanel({ message }: { message?: string }) {
  return (
    <StatusPanel
      icon={<TimerReset size={20} />}
      title="Daily search limit reached"
      description={message ?? "The YouTube API quota has been used up for today. Try again tomorrow."}
    />
  );
}

export function ErrorPanel({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <StatusPanel
      icon={<AlertTriangle size={20} />}
      title="Search failed"
      description={message ?? "Something went wrong while searching. Please try again."}
      action={
        onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 rounded-md border border-border-strong px-3 py-1.5 text-xs text-text hover:bg-surface-hover"
          >
            Try again
          </button>
        )
      }
    />
  );
}

export function EmptyResultsPanel({ query }: { query: string }) {
  return (
    <StatusPanel
      icon={<SearchX size={20} />}
      title="No matches found"
      description={`No public videos matched "${query}". Try a broader subject or drop the duration hint.`}
    />
  );
}
