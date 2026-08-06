import { describe, expect, it } from "vitest";
import { parseResendDeliveryEvent } from "./resend-webhook";

describe("Resend delivery webhook payload", () => {
  it("parses a delivered event", () => {
    expect(parseResendDeliveryEvent({
      type: "email.delivered",
      created_at: "2026-08-06T12:00:00Z",
      data: { email_id: "resend-message-1" },
    })).toEqual({ type: "email.delivered", createdAt: "2026-08-06T12:00:00.000Z", emailId: "resend-message-1", error: null });
  });

  it("extracts a bounded bounce reason", () => {
    const parsed = parseResendDeliveryEvent({
      type: "email.bounced",
      created_at: "2026-08-06T12:00:00Z",
      data: { email_id: "resend-message-2", bounce: { message: "Mailbox does not exist" } },
    });
    expect(parsed?.error).toBe("Mailbox does not exist");
  });

  it("rejects unrelated event types and malformed IDs", () => {
    expect(parseResendDeliveryEvent({ type: "email.opened", created_at: "2026-08-06T12:00:00Z", data: { email_id: "id" } })).toBeNull();
    expect(parseResendDeliveryEvent({ type: "email.delivered", created_at: "invalid", data: { email_id: "" } })).toBeNull();
  });
});
