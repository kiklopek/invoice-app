import { describe, expect, it } from "vitest";
import { isSameOriginMutation } from "./request-security";

describe("isSameOriginMutation", () => {
  it("povolí vlastní origin a serverový požadavek bez Origin hlavičky", () => {
    expect(isSameOriginMutation(new Request("https://app.example.cz/api/invoices", { headers: { origin: "https://app.example.cz" } }))).toBe(true);
    expect(isSameOriginMutation(new Request("https://app.example.cz/api/invoices"))).toBe(true);
  });

  it("odmítne mutaci z cizího webu", () => {
    expect(isSameOriginMutation(new Request("https://app.example.cz/api/invoices", { headers: { origin: "https://evil.example" } }))).toBe(false);
  });
});

