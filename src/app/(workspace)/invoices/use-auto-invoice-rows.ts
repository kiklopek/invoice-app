"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { fitInvoiceRows } from "@/lib/invoice-page-size";

export type AutoInvoiceRows = {
  /** Rows that fit between the table header and the pagination; null = not measured. */
  rows: number | null;
  /** Height for each row: its natural height plus the spread leftover (max +18 px). */
  rowHeight: number | null;
};

/**
 * Automaticky (TRANSITION_RULES pravidla 2–4): the list shows as many whole rows as
 * fit the window so the page does not scroll and leaves no gap under the list.
 * The room does not depend on how many rows are shown (it is measured from the
 * table header to the pagination and what follows it), so a new row count can
 * never feed back into the measurement. Desktop shell only; below 1024 px the
 * list keeps its regular page size.
 */
export function useAutoInvoiceRows(
  enabled: boolean,
  panel: RefObject<HTMLElement | null>,
): AutoInvoiceRows {
  const [fit, setFit] = useState<AutoInvoiceRows>({ rows: null, rowHeight: null });

  useLayoutEffect(() => {
    if (!enabled) {
      setFit((current) => (current.rows === null ? current : { rows: null, rowHeight: null }));
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const root = panel.current;
      const head = root?.querySelector("thead");
      const pagination = root?.querySelector<HTMLElement>("[data-invoice-pagination]");
      const row = root?.querySelector<HTMLElement>("tbody tr");
      if (!root || !head || !pagination || !row || window.innerWidth < 1024) {
        if (window.innerWidth < 1024) setFit((current) => (current.rows === null ? current : { rows: null, rowHeight: null }));
        return;
      }
      const scrollY = window.scrollY;
      // Natural row height without the fitted height (synchronous, never painted),
      // so a measurement taken before React re-renders the rows is still right.
      const fitted = row.style.height;
      row.style.height = "";
      const naturalRow = row.getBoundingClientRect().height;
      row.style.height = fitted;
      const paginationBox = pagination.getBoundingClientRect();
      const afterPagination =
        document.documentElement.scrollHeight - (paginationBox.bottom + scrollY);
      const room =
        window.innerHeight -
        (head.getBoundingClientRect().bottom + scrollY) -
        paginationBox.height -
        Math.max(0, afterPagination);
      const { rows, extra } = fitInvoiceRows(room, naturalRow);
      // Round down: fractional rows rounded up could add up to more than the room.
      const rowHeight = Math.floor(naturalRow + extra);
      setFit((current) =>
        current.rows === rows && current.rowHeight === rowHeight ? current : { rows, rowHeight },
      );
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", schedule);
    // Filters opening, the header wrapping or text growing after a resize moves
    // the table; re-measure then. Watching the panel itself is safe: the room
    // does not depend on the rows, so a refit settles after one more pass.
    const observer = new ResizeObserver(schedule);
    const filters = panel.current?.querySelector("[data-invoice-filters]");
    if (filters) observer.observe(filters);
    if (panel.current) observer.observe(panel.current);
    return () => {
      window.removeEventListener("resize", schedule);
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [enabled, panel]);

  return fit;
}
