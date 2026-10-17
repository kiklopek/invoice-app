import { describe, expect, it } from "vitest";
import { parseCustomerSearchQuery } from "./customer-search-query";

describe("customer search RPC input", () => {
  it.each(["Novák", "Stavby Plzeň s.r.o.", "12345678", "jan_novak@firma.cz", "+420 777 123 456", "Dlouhá 12, Brno", "a,or(id.eq.1)", "100%"])("keeps %s as a literal RPC value", (query) => {
    expect(parseCustomerSearchQuery(`  ${query}  `)).toEqual({ valid: true, query });
  });
  it.each([null, undefined, "", " ", "a", "a\u0301"])("does not search short input %s", (query) => {
    expect(parseCustomerSearchQuery(query)).toEqual({ valid: true, query: null });
  });
  it.each(["a".repeat(101), "foo\u0000bar", "foo\u007fbar"])("rejects unbounded or control input", (query) => {
    expect(parseCustomerSearchQuery(query)).toEqual({ valid: false });
  });
  it("accepts the length boundary", () => {
    expect(parseCustomerSearchQuery("a".repeat(100)).valid).toBe(true);
  });
});
