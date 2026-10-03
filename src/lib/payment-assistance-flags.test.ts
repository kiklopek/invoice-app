import { describe, expect, it } from "vitest";
import { assistanceFlags } from "./payment-assistance-flags";
describe("payment assistance kill switches", () => {
  it("defaults to fully off without an explicit organization allowlist", () => {
    expect(assistanceFlags("org",{ PAYMENT_ASSISTANCE_MODE:"review",PAYMENT_PAYER_MEMORY_ENABLED:"true",PAYMENT_REEVALUATION_ENABLED:"true",PAYMENT_CAMT_ENABLED:"true",PAYMENT_CAMT_KB_SAMPLE_VERIFIED:"true" })).toEqual({ mode:"off",memory:false,reevaluation:false,camt:false });
  });
  it("requires both XML rollout and sample verification", () => {
    const env = { PAYMENT_ASSISTANCE_ORGANIZATIONS:"org",PAYMENT_CAMT_ENABLED:"true" };
    expect(assistanceFlags("org",env).camt).toBe(false);
    expect(assistanceFlags("org",{ ...env,PAYMENT_CAMT_KB_SAMPLE_VERIFIED:"true" }).camt).toBe(true);
  });
  it("separates shadow/review from optional learning and background reevaluation", () => {
    expect(assistanceFlags("org",{ PAYMENT_ASSISTANCE_ORGANIZATIONS:"other, org",PAYMENT_ASSISTANCE_MODE:"shadow" })).toEqual({ mode:"shadow",memory:false,reevaluation:false,camt:false });
  });
});
