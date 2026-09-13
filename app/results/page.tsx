import { Suspense } from "react";
import { ResultsView } from "@/components/results/ResultsView";
import { ResultsSkeleton } from "@/components/results/ResultsSkeleton";

export default function ResultsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
          <ResultsSkeleton />
        </div>
      }
    >
      <ResultsView />
    </Suspense>
  );
}
