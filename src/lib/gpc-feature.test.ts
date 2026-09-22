import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Rozhoduje, kdo smí importovat bankovní výpis -- tedy kdo smí spustit
// zápis plateb na faktury. Deset řádků, ale je to oprávnění k penězům.

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.GPC_IMPORT_ENABLED;
  delete process.env.GPC_IMPORT_ROLES;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

const load = async () => (await import("./gpc-feature")).canUseGpcImport;

describe("canUseGpcImport", () => {
  it("allows admin and accounting by default", async () => {
    const canUse = await load();
    expect(canUse("admin")).toBe(true);
    expect(canUse("accounting")).toBe(true);
  });

  it("never allows a read-only role by default", async () => {
    // Čtenář nesmí zaúčtovat platbu, i kdyby se k importu proklikal.
    const canUse = await load();
    expect(canUse("viewer")).toBe(false);
  });

  it("can be switched off entirely", async () => {
    process.env.GPC_IMPORT_ENABLED = "false";
    const canUse = await load();
    expect(canUse("admin")).toBe(false);
    expect(canUse("accounting")).toBe(false);
  });

  it("only the exact string 'false' disables it, so a typo cannot silently open it", async () => {
    process.env.GPC_IMPORT_ENABLED = "true";
    expect((await load())("admin")).toBe(true);
    vi.resetModules();
    process.env.GPC_IMPORT_ENABLED = "0";
    // "0" není "false" -- funkce zůstává zapnutá, což je bezpečnější
    // než hádat, co uživatel myslel.
    expect((await load())("admin")).toBe(true);
  });

  it("honours an explicit role list", async () => {
    process.env.GPC_IMPORT_ROLES = "admin";
    const canUse = await load();
    expect(canUse("admin")).toBe(true);
    expect(canUse("accounting")).toBe(false);
  });

  it("tolerates spaces in the configured list", async () => {
    process.env.GPC_IMPORT_ROLES = " admin , accounting ";
    const canUse = await load();
    expect(canUse("accounting")).toBe(true);
  });

  it("an empty list allows nobody rather than everybody", async () => {
    // Prázdná konfigurace se nesmí vyložit jako "bez omezení".
    process.env.GPC_IMPORT_ROLES = "";
    const canUse = await load();
    expect(canUse("admin")).toBe(false);
    expect(canUse("accounting")).toBe(false);
    expect(canUse("viewer")).toBe(false);
  });
});
