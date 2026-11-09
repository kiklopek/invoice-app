import { describe, expect, it } from "vitest";
import {
  fitInvoiceRows,
  invoicePageKeepingFirstRow,
  parseInvoicePageSizeChoice,
  parseInvoiceRequestPageSize,
} from "./invoice-page-size";

describe("invoice page size", () => {
  it("keeps the menu choices and adds Automaticky", () => {
    expect(parseInvoicePageSizeChoice("auto")).toBe("auto");
    expect(parseInvoicePageSizeChoice("50")).toBe(50);
    expect(parseInvoicePageSizeChoice("7")).toBeNull();
    expect(parseInvoicePageSizeChoice(undefined)).toBeNull();
  });
  it("accepts any whole request size from 5 to 100", () => {
    expect(parseInvoiceRequestPageSize("5")).toBe(5);
    expect(parseInvoiceRequestPageSize(13)).toBe(13);
    expect(parseInvoiceRequestPageSize("100")).toBe(100);
    for (const bad of ["4", "101", "7.5", "07", "auto", "", null]) expect(parseInvoiceRequestPageSize(bad)).toBeNull();
  });
  it("fits whole rows and spreads the rest, at most 18 px a row", () => {
    // 520 px of room, 63 px rows: 8 rows (504 px), 16 px left = 2 px a row.
    expect(fitInvoiceRows(520, 63)).toEqual({ rows: 8, extra: 2 });
    // Just under one more row: 9 × 63 = 567 > 566, so 8 rows and 62 px left -> capped at 7 a row.
    expect(fitInvoiceRows(566, 63)).toEqual({ rows: 8, extra: 7 });
    // Large window: 1150 / 63 = 18 rows, 16 px left.
    expect(fitInvoiceRows(1150, 63)).toEqual({ rows: 18, extra: 0 });
  });
  it("never goes below 5 or above 100 rows and never adds height when scrolling", () => {
    expect(fitInvoiceRows(100, 63)).toEqual({ rows: 5, extra: 0 });
    expect(fitInvoiceRows(10000, 63)).toEqual({ rows: 100, extra: 0 });
    expect(fitInvoiceRows(NaN, 63)).toEqual({ rows: 5, extra: 0 });
    expect(fitInvoiceRows(500, 0)).toEqual({ rows: 5, extra: 0 });
  });
  it("keeps the first visible invoice when the page size changes", () => {
    // Page 3 of 10 starts at the 21st invoice; with 8 rows that is page 3 (17–24).
    expect(invoicePageKeepingFirstRow(3, 10, 8)).toBe(3);
    expect(invoicePageKeepingFirstRow(1, 25, 7)).toBe(1);
    expect(invoicePageKeepingFirstRow(2, 25, 7)).toBe(4); // 26th invoice -> 22–28
    expect(invoicePageKeepingFirstRow(5, 7, 25)).toBe(2); // 29th invoice -> 26–50
  });
});
