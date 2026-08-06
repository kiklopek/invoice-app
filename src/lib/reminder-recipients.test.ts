import { describe, expect, it } from "vitest";
import { normalizeReminderDeliverySettings, parseReminderCcInput } from "./reminder-recipients";

describe("reminder delivery settings", () => {
  it("normalizes the reply address and unique copies", () => {
    expect(normalizeReminderDeliverySettings(" Ucetni@Firma.cz ", [" Kopie@Firma.cz ", "kopie@firma.cz"])).toEqual({
      reply_to: "ucetni@firma.cz",
      cc: ["kopie@firma.cz"],
    });
  });

  it("rejects malformed addresses and more than five copies", () => {
    expect(normalizeReminderDeliverySettings("neplatny-email", [])).toBeNull();
    expect(normalizeReminderDeliverySettings(null, ["a@a.cz", "b@b.cz", "c@c.cz", "d@d.cz", "e@e.cz", "f@f.cz"])).toBeNull();
    expect(normalizeReminderDeliverySettings(null, "kopie@firma.cz")).toBeNull();
  });

  it("accepts comma, semicolon and line separated input", () => {
    expect(parseReminderCcInput("a@a.cz, b@b.cz;\nc@c.cz")).toEqual(["a@a.cz", "b@b.cz", "c@c.cz"]);
  });
});
