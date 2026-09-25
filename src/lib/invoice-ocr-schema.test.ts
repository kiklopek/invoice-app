import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20260924102621_contextual_invoice_ocr.sql"), "utf8").toLowerCase();
const schema = readFileSync(join(process.cwd(), "supabase/schema.sql"), "utf8").toLowerCase();
const normalized = (source: string) => source.replaceAll("public.", "").replaceAll("on table ", "on ");

describe("contextual OCR database schema", () => {
  it("stores review decisions and corrections without retaining raw OCR text", () => {
    for (const rawSource of [migration, schema]) {
      const source = normalized(rawSource);
      expect(source).toContain("create table invoice_ocr_reviews");
      expect(source).toContain("corrected_fields text[]");
      expect(source).toContain("field_decisions jsonb");
      expect(source).toContain("vocabulary_version text");
      expect(source).not.toContain("raw_ocr_text");
    }
  });

  it("keeps registry cache and review audit server-only behind RLS", () => {
    for (const rawSource of [migration, schema]) {
      const source = normalized(rawSource);
      for (const table of ["company_registry_cache", "invoice_ocr_reviews", "invoice_ocr_keyword_suggestions"]) {
        expect(source).toContain(`alter table ${table} enable row level security`);
        expect(source).toContain(`revoke all on ${table} from anon, authenticated`);
        expect(source).toContain(`grant select, insert, update, delete on ${table} to service_role`);
      }
    }
  });

  it("adds backward-compatible OCR metadata to uploads", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("ocr_proposed_values");
      expect(source).toContain("ocr_field_decisions");
      expect(source).toContain("ocr_vocabulary_version");
    }
  });

  it("provides aggregate field accuracy without exposing it to browser roles", () => {
    for (const rawSource of [migration, schema]) {
      const source = normalized(rawSource);
      expect(source).toContain("create view invoice_ocr_field_accuracy");
      expect(source).toContain("accuracy_percent");
      expect(source).toContain("revoke all on invoice_ocr_field_accuracy from anon, authenticated");
      expect(source).toContain("grant select on invoice_ocr_field_accuracy to service_role");
    }
  });
});
