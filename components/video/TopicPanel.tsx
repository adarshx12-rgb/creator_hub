import { Tags } from "lucide-react";

export function TopicPanel() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium text-text">
        <Tags size={14} /> Related topics
      </h3>
      <p className="mt-2 text-xs leading-relaxed text-text-faint">
        Topic suggestions are generated from transcript analysis, which requires authorized access to this
        video&apos;s media. This is a source-discovery result only, so topic chips aren&apos;t available here.
      </p>
    </div>
  );
}
