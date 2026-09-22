import { describe, expect, it } from "vitest";
import { customerSearchFilter, sanitizeCustomerSearch } from "./customer-search-query";

describe("sanitizeCustomerSearch", () => {
  it("keeps what Czech company names, IČO, e-mails and phones actually contain", () => {
    expect(sanitizeCustomerSearch("Novák")).toBe("Novák");
    expect(sanitizeCustomerSearch("Stavby Plzeň s.r.o.")).toBe("Stavby Plzeň s.r.o.");
    expect(sanitizeCustomerSearch("12345678")).toBe("12345678");
    expect(sanitizeCustomerSearch("jan.novak@firma.cz")).toBe("jan.novak@firma.cz");
    expect(sanitizeCustomerSearch("+420 777 123 456")).toBe("+420 777 123 456");
  });

  // Tohle je ten duvod, proc funkce vznikla: carka je v PostgREST `or()`
  // oddelovac podminek, takze bez ocisteni sla pripojit dalsi filtr.
  it("strips the PostgREST control characters that allowed filter injection", () => {
    expect(sanitizeCustomerSearch("a,notes.ilike.*tajne*")).toBe("a notes.ilike. tajne");
    expect(sanitizeCustomerSearch("a),or(id.gt.0")).toBe("a or id.gt.0");
    for (const injected of ["a,notes.ilike.*x*", "a),(b", "a,or(x.eq.1)"]) {
      expect(sanitizeCustomerSearch(injected), injected).not.toContain(",");
      expect(sanitizeCustomerSearch(injected), injected).not.toContain("(");
      expect(sanitizeCustomerSearch(injected), injected).not.toContain(")");
    }
  });

  it("escapes the LIKE wildcard that legitimately occurs in e-mails", () => {
    // Podtrzitko projde (jan_novak@...), ale v LIKE znamena libovolny znak.
    expect(sanitizeCustomerSearch("a_b")).toBe("a\\_b");
    expect(sanitizeCustomerSearch("jan_novak@firma.cz")).toBe("jan\\_novak@firma.cz");
  });

  it("drops the percent wildcard entirely, since it means nothing in a name", () => {
    // Bez toho by samotne "%" vratilo vsechny zakazniky organizace.
    expect(sanitizeCustomerSearch("100%")).toBe("100");
    expect(sanitizeCustomerSearch("%%")).toBeNull();
  });

  it("returns null when nothing searchable is left", () => {
    for (const value of [null, undefined, "", " ", "a", ",,,", "()", ",.,"]) {
      expect(sanitizeCustomerSearch(value), String(value)).toBeNull();
    }
  });

  it("caps absurd lengths", () => {
    expect(sanitizeCustomerSearch("a".repeat(500))!.length).toBeLessThanOrEqual(100);
  });
});

describe("customerSearchFilter", () => {
  it("searches the four columns the UI promises", () => {
    expect(customerSearchFilter("Novák")).toBe(
      "name.ilike.%Novák%,ico.ilike.%Novák%,email.ilike.%Novák%,phone.ilike.%Novák%",
    );
  });
});
