"use client";

import { REVIEW_COPY } from "@/lib/payment-review-copy";
import type { ReviewBucket } from "@/lib/payment-review-model";

export type ReviewFilter = ReviewBucket | "all";

const BUCKETS: Array<{ key: ReviewBucket; label: string; hint: string }> = [
  { key: "needs_answer", label: REVIEW_COPY.bucketNeedsAnswer, hint: REVIEW_COPY.bucketNeedsAnswerHint },
  { key: "done", label: REVIEW_COPY.bucketDone, hint: REVIEW_COPY.bucketDoneHint },
  { key: "not_invoice", label: REVIEW_COPY.bucketNotInvoice, hint: REVIEW_COPY.bucketNotInvoiceHint },
];

/** Tři stavy plateb ve výpisu; karty zároveň filtrují seznam pod sebou. */
export function ReviewSummary({
  counts,
  filter,
  total,
  onFilter,
}: {
  counts: Record<ReviewBucket, number>;
  filter: ReviewFilter;
  total: number;
  onFilter: (filter: ReviewFilter) => void;
}) {
  return (
    <div className="payment-review-summary">
      <div className="review-buckets" role="group" aria-label="Zobrazit platby podle stavu">
        {BUCKETS.map((bucket) => (
          <button
            key={bucket.key}
            type="button"
            className={`review-bucket is-${bucket.key}${filter === bucket.key ? " is-active" : ""}`}
            aria-pressed={filter === bucket.key}
            onClick={() => onFilter(filter === bucket.key ? "all" : bucket.key)}
          >
            <span className="review-bucket-count">{counts[bucket.key]}</span>
            <span className="review-bucket-copy">
              <span className="review-bucket-label">{bucket.label}</span>
              <span className="review-bucket-hint">{bucket.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="review-filter-row">
        <p aria-live="polite">
          {filter === "all"
            ? `Zobrazujeme všechny platby (${total}).`
            : filter === "needs_answer" && counts.needs_answer === 0
              ? REVIEW_COPY.allAnswered
              : `Zobrazujeme: ${BUCKETS.find((bucket) => bucket.key === filter)?.label.toLowerCase()} (${counts[filter]}).`}
        </p>
        {filter !== "all" && (
          <button type="button" className="btn secondary review-show-all" onClick={() => onFilter("all")}>
            Zobrazit všechny ({total})
          </button>
        )}
      </div>
    </div>
  );
}
