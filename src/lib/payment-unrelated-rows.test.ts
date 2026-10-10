import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  OWN_TRANSFER_LABEL,
  buildReviewedEntriesPayload,
  buildStatementReviewSubmission,
  detectOwnTransfer,
} from "./payment-unrelated-rows";

// Skutečný výpis testera: E.ON vrací přeplatek (řádek 2) a firma si převádí
// 6 000 476,67 Kč mezi vlastními účty (řádek 5). Ani jedno nesouvisí
// s fakturami, a přesto by je commit zapsal do knihy plateb jako
// „nespárovanou platbu“ -- 6 milionů v přehledu nespárovaných plateb.

const credit = (overrides: Partial<Parameters<typeof detectOwnTransfer>[0]> = {}) => ({
  disposition: "accepted",
  amount: 6_000_476.67,
  counterparty_name: "R. HLAVICA S.R.O.",
  counterparty_account: "123-5473460237/0100",
  counterparty_account_verified: true,
  proposed_invoice_ids: [],
  ...overrides,
});

describe("rozpoznání vlastního převodu", () => {
  it("pozná protiúčet, který je jedním z vlastních účtů organizace", () => {
    const match = detectOwnTransfer(credit({ counterparty_name: "Kdokoli" }), {
      organizationName: "Úplně jiná firma a.s.",
      ownAccounts: ["6786420257/0100", "123-5473460237/0100"],
    });
    expect(match?.kind).toBe("account");
    expect(match?.reason).toContain("123-5473460237/0100");
  });

  it("porovná účty bez ohledu na úvodní nuly a zápis v IBAN", () => {
    expect(
      detectOwnTransfer(credit({ counterparty_name: null }), {
        ownAccounts: ["000123-0005473460237/0100"],
      })?.kind,
    ).toBe("account");
    // CZ + kontrolní číslice 08 + 0100 + 000123 + 5473460237
    expect(
      detectOwnTransfer(credit({ counterparty_name: null }), {
        ownAccounts: ["CZ08 0100 0001 2354 7346 0237"],
      })?.kind,
    ).toBe("account");
  });

  it("IBAN se špatnými kontrolními číslicemi za vlastní účet nepovažuje", () => {
    expect(
      detectOwnTransfer(credit({ counterparty_name: null }), {
        ownAccounts: ["CZ12 0100 0001 2354 7346 0237"],
      }),
    ).toBeNull();
  });

  it("stejné číslo v jiné bance není vlastní účet", () => {
    expect(
      detectOwnTransfer(credit({ counterparty_name: null }), {
        ownAccounts: ["123-5473460237/0800"],
      }),
    ).toBeNull();
  });

  it("nevěří číslu účtu, které neprošlo kontrolním součtem", () => {
    // Neověřené číslo není důkaz ničeho -- stejné pravidlo jako u učení
    // identity plátce v reconcile_bank_statement.
    expect(
      detectOwnTransfer(credit({ counterparty_name: null, counterparty_account_verified: false }), {
        ownAccounts: ["123-5473460237/0100"],
      }),
    ).toBeNull();
  });

  it("pozná plátce podle názvu organizace (diakritika, velikost písmen, interpunkce)", () => {
    const match = detectOwnTransfer(credit({ counterparty_account: "999-1234567899/0300" }), {
      organizationName: "R. Hlavica s.r.o.",
      ownAccounts: [],
    });
    expect(match?.kind).toBe("name");
    expect(match?.reason).toContain("R. HLAVICA S.R.O.");
  });

  it("u jména useknutého GPC na 20 znaků stačí shoda začátku", () => {
    expect(
      detectOwnTransfer(credit({ counterparty_name: "ESTIMATIC SYSTEMS S.", counterparty_account: null }), {
        organizationName: "ESTIMATIC Systems s.r.o.",
        ownAccounts: [],
      })?.kind,
    ).toBe("name");
  });

  it("krátké neúplné jméno za vlastní převod nepovažuje", () => {
    // „R. HLAVICA“ bez právní formy může být fyzická osoba -- zákazník.
    // Plátce, který by se chybně označil, by zůstal neuhrazený a dostal
    // upomínku, takže tady rozhoduje jen přesná shoda.
    expect(
      detectOwnTransfer(credit({ counterparty_name: "R. HLAVICA", counterparty_account: null }), {
        organizationName: "R. Hlavica s.r.o.",
        ownAccounts: [],
      }),
    ).toBeNull();
  });

  it("E.ON přeplatek vlastní převod není", () => {
    expect(
      detectOwnTransfer(
        credit({ amount: 1697.26, counterparty_name: "E.ON ENERGIE, A.S.", counterparty_account: "19-1760823/0100" }),
        { organizationName: "R. Hlavica s.r.o.", ownAccounts: ["6786420257/0100"] },
      ),
    ).toBeNull();
  });

  it("odchozí, ignorované a nulové řádky nikdy", () => {
    const context = { organizationName: "R. Hlavica s.r.o.", ownAccounts: ["123-5473460237/0100"] };
    expect(detectOwnTransfer(credit({ disposition: "ignored" }), context)).toBeNull();
    expect(detectOwnTransfer(credit({ amount: 0 }), context)).toBeNull();
    expect(detectOwnTransfer(credit({ amount: -5 }), context)).toBeNull();
  });

  it("štítek říká, co se s řádkem stane", () => {
    expect(OWN_TRANSFER_LABEL).toBe("Vlastní převod – nebude zapsán k fakturám");
  });
});

describe("sestavení kontroly výpisu v panelu", () => {
  const entries = [
    { id: "e2", line_number: 2, fingerprint: "f2" },
    { id: "e3", line_number: 3, fingerprint: "f3" },
    { id: "e5", line_number: 5, fingerprint: "f5" },
  ];
  const allocationsFor = (entry: { fingerprint: string }) =>
    entry.fingerprint === "f3"
      ? [{ invoice_id: "i1", amount: 1000, is_manual_partial: false }]
      : [];

  it("řádek označený „Nesouvisí s fakturami“ se nezaúčtuje jako platba", () => {
    const result = buildStatementReviewSubmission({
      entries,
      unrelated: { f2: true, f5: true },
      allocationsFor,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reviewed_entry_ids).toEqual(["e2", "e3", "e5"]);
    expect(result.unrelated_entry_ids).toEqual(["e2", "e5"]);
    // Jediné přiřazení je u řádku 3; označené řádky žádné nemají.
    expect(result.allocations).toEqual([
      { entry_id: "e3", invoice_id: "i1", amount: 1000, is_manual_partial: false },
    ]);
  });

  it("řádek označený jako nesouvisející a zároveň s vybranou fakturou je rozpor, ne tiché rozhodnutí", () => {
    const result = buildStatementReviewSubmission({
      entries,
      unrelated: { f3: true },
      allocationsFor,
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, line_number: 3 }));
  });
});

describe("validace uložení kontroly (PATCH)", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "33333333-3333-4333-8333-333333333333";

  it("bez nesouvisejících řádků posílá původní tvar -- funguje i proti staré databázi", () => {
    const result = buildReviewedEntriesPayload({ reviewed_entry_ids: [A, B], unrelated_entry_ids: undefined, allocations: [] });
    expect(result).toEqual({ ok: true, reviewed_entries: [A, B] });
  });

  it("nesouvisející řádek nese příznak uvnitř stávajícího JSON", () => {
    const result = buildReviewedEntriesPayload({ reviewed_entry_ids: [A, B], unrelated_entry_ids: [B], allocations: [] });
    expect(result).toEqual({
      ok: true,
      reviewed_entries: [
        { id: A, unrelated: false },
        { id: B, unrelated: true },
      ],
    });
  });

  it("odmítne nesouvisející řádek, který má zároveň přiřazenou fakturu", () => {
    const result = buildReviewedEntriesPayload({
      reviewed_entry_ids: [A],
      unrelated_entry_ids: [A],
      allocations: [{ entry_id: A, invoice_id: B, amount: 10 }],
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "unrelated_entry_has_allocations" }));
  });

  it("odmítne označení řádku, který není mezi kontrolovanými", () => {
    expect(
      buildReviewedEntriesPayload({ reviewed_entry_ids: [A], unrelated_entry_ids: [B], allocations: [] }),
    ).toEqual(expect.objectContaining({ ok: false, code: "invalid_unrelated_entries" }));
    expect(
      buildReviewedEntriesPayload({ reviewed_entry_ids: [A], unrelated_entry_ids: "A", allocations: [] }),
    ).toEqual(expect.objectContaining({ ok: false, code: "invalid_unrelated_entries" }));
    expect(
      buildReviewedEntriesPayload({ reviewed_entry_ids: [A], unrelated_entry_ids: [A, A], allocations: [] }),
    ).toEqual(expect.objectContaining({ ok: false, code: "invalid_unrelated_entries" }));
  });
});

// ---------------------------------------------------------------------------
// SQL kontrakt. Funkce se v historii migrací opakovaně předefinovávají, takže
// test čte VŽDY POSLEDNÍ definici napříč všemi migracemi -- tu, která je živá.
// ---------------------------------------------------------------------------

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const migrationFiles = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();

function definitionsOf(name: string) {
  const pattern = new RegExp(`create (?:or replace )?function public\\.${name}\\(`, "gi");
  const found: Array<{ file: string; body: string }> = [];
  for (const file of migrationFiles) {
    const sql = readFileSync(join(migrationsDir, file), "utf8").replace(/\r\n/g, "\n");
    for (const match of sql.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = sql.indexOf("end $$;", start);
      found.push({ file, body: sql.slice(start, end + "end $$;".length) });
    }
  }
  return found;
}
const latest = (name: string) => {
  const all = definitionsOf(name);
  return all[all.length - 1];
};
const codeLines = (body: string) =>
  body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("--"));

describe("reconcile_bank_statement přeskočí nesouvisející řádky", () => {
  const current = latest("reconcile_bank_statement");

  it("živá definice (automatika po firmách) zachovává signaturu", () => {
    expect(current.file).toMatch(/_auto_booking_per_organization\.sql$/);
    expect(current.body).toContain(
      "target_org uuid, actor_user uuid, target_import uuid, expected_revision integer,\n  automatic_only boolean default false, acknowledge_account_mismatch boolean default false\n) returns jsonb",
    );
  });

  it("řádek označený jako nesouvisející se nikdy nevloží do bank_payments", () => {
    expect(current.body).toMatch(
      /for e in select \* from public\.bank_statement_entries where import_id=target_import and disposition='accepted'[^;]*?and unrelated_at is null[\s\S]*?loop/,
    );
  });

  it("nesouvisející řádek nedrží import věčně ve stavu kontroly", () => {
    expect(current.body).toMatch(
      /select count\(\*\) into remaining from public\.bank_statement_entries where[^;]*unrelated_at is null;/,
    );
  });

  it("vrací počet vynechaných řádků, aby výsledek nic nezamlčel", () => {
    expect(current.body).toMatch(/'unrelated',\s*skipped/);
  });

  it("jinak je tělo shodné s předchozí živou verzí -- žádná kontrola nezmizela", () => {
    const all = definitionsOf("reconcile_bank_statement");
    const unrelatedRows = all[all.length - 2];
    const previous = all[all.length - 3];
    expect(unrelatedRows.file).toMatch(/_gpc_unrelated_rows\.sql$/);
    expect(previous.file).toBe("20260920140111_gpc_account_checksum_unverified.sql");
    // Řádky, které tahle migrace záměrně mění. Všechno ostatní musí přežít.
    const intentionallyChanged = new Set([
      "remaining integer; error_code text; allocated uuid[]; proposed uuid[];",
      "and bank_payment_id is null and (not automatic_only or (proposal_confidence='safe' and matching_version=private.matching_engine_version()))",
      "select count(*) into remaining from public.bank_statement_entries where import_id=target_import and disposition='accepted' and bank_payment_id is null;",
      "'imported',done,'matched',matched,'remaining',remaining,'errors',failures,'idempotent',false);",
    ]);
    const now = new Set(codeLines(unrelatedRows.body));
    const missing = codeLines(previous.body).filter((line) => !now.has(line) && !intentionallyChanged.has(line));
    expect(missing).toEqual([]);
  });

  // Automatika po firmách mění jen to, kdy se smí účtovat bez člověka.
  it("automatika po firmách nezahodila žádnou kontrolu", () => {
    const all = definitionsOf("reconcile_bank_statement");
    const previous = all[all.length - 2];
    const intentionallyChanged = new Set([
      "if automatic_only and (a.amount<>inv.amount-inv.paid_amount or not (",
      "or (coalesce(e.counterparty_account_verified,true)",
      "or (private.names_match(e.counterparty_name,inv.counterparty_name)",
      ")) then raise exception 'proposal_changed'; end if;",
    ]);
    const now = new Set(codeLines(current.body));
    const missing = codeLines(previous.body).filter((line) => !now.has(line) && !intentionallyChanged.has(line));
    expect(missing).toEqual([]);
    expect(current.body).toContain("booking_mode='off' or (s.account_mismatch and not s.account_mismatch_acknowledged)");
    expect(current.body).toContain("not coalesce(");
  });
});

describe("save_bank_statement_allocations uloží označení i s auditní stopou", () => {
  const current = latest("save_bank_statement_allocations");

  it("živá definice je v nové migraci se stejnou signaturou", () => {
    expect(current.file).toMatch(/_gpc_unrelated_rows\.sql$/);
    expect(current.body).toContain(
      "target_org uuid, actor_user uuid, target_import uuid, expected_revision integer, reviewed_entries jsonb, allocation_rows jsonb",
    );
  });

  it("přijme starý tvar (uuid) i nový ({id, unrelated})", () => {
    expect(current.body).toContain("jsonb_typeof(value)='string'");
    expect(current.body).toContain("value->>'unrelated'");
  });

  it("zapíše kdo a kdy řádek označil (první označení se nepřepisuje), a u odznačeného stopu smaže", () => {
    expect(current.body).toMatch(
      /unrelated_at=case when entry\.id=any\(unrelated_ids\) then coalesce\(entry\.unrelated_at,now\(\)\) else null end/,
    );
    expect(current.body).toMatch(
      /unrelated_by=case when entry\.id=any\(unrelated_ids\) then coalesce\(entry\.unrelated_by,actor_user\) else null end/,
    );
  });

  it("rozpor „nesouvisí“ + přiřazená faktura je chyba, ne tiché rozhodnutí", () => {
    expect(current.body).toContain("unrelated_entry_has_allocations");
  });

  it("zaúčtovaný řádek nejde dodatečně označit", () => {
    expect(current.body).toContain("unrelated_entry_already_booked");
  });

  it("zachová všechny původní kontroly", () => {
    const previous = definitionsOf("save_bank_statement_allocations").at(-2)!;
    expect(previous.file).toBe("20260915095449_add_bank_statement_imports.sql");
    for (const guard of [
      "insufficient_payment_import_permission",
      "invalid_allocations",
      "revision_conflict",
      "invalid_reviewed_entries",
      "invalid_allocation_target",
      "pg_advisory_xact_lock",
      "invoice.status in('pending','overdue')",
    ])
      expect(current.body).toContain(guard);
  });
});

describe("nová migrace", () => {
  const file = migrationFiles.find((name) => name.endsWith("_gpc_unrelated_rows.sql"));
  const sql = file ? readFileSync(join(migrationsDir, file), "utf8") : "";

  // Původně "je poslední migrací". Pozdější migrace, které tyhle tři funkce
  // nepředefinují (např. 20260930180000_collective_invoices.sql), živá těla
  // nemění; hlídá se proto přesně to, na čem záleží: že žádná novější
  // migrace žádnou z nich nepřepíše.
  it("drží živá těla funkcí -- žádná novější migrace je nepřepisuje", () => {
    expect(file).toBeDefined();
    // 20261010122000_auto_booking_per_organization.sql vědomě předefinovává
    // reconcile_bank_statement (kontrolu má vlastní test výše).
    const later = migrationFiles.filter((name) => name > file! && !name.endsWith("_auto_booking_per_organization.sql"));
    for (const name of later) {
      const source = readFileSync(join(migrationsDir, name), "utf8");
      for (const fn of ["reconcile_bank_statement", "save_bank_statement_allocations", "run_bank_reconciliation_jobs"])
        expect(source, `${name} předefinovává ${fn}`).not.toMatch(new RegExp(`function\\s+public\\.${fn}\\b`));
    }
  });

  it("přidává auditní sloupce a nedovolí označit zaúčtovaný řádek", () => {
    expect(sql).toMatch(/add column if not exists unrelated_at timestamptz/);
    expect(sql).toMatch(/add column if not exists unrelated_by uuid references auth\.users\(id\)/);
    expect(sql).toMatch(/\(unrelated_at is null\) = \(unrelated_by is null\)/);
    expect(sql).toMatch(/unrelated_at is null or bank_payment_id is null/);
  });

  it("automat v cronu nesahá na importy jen kvůli nesouvisejícím řádkům", () => {
    const jobs = latest("run_bank_reconciliation_jobs");
    expect(jobs.file).toBe(file);
    expect(jobs.body).toContain("and e.unrelated_at is null");
  });

  it("práva na funkce zůstávají jen serveru", () => {
    for (const signature of [
      "save_bank_statement_allocations(uuid,uuid,uuid,integer,jsonb,jsonb)",
      "reconcile_bank_statement(uuid,uuid,uuid,integer,boolean,boolean)",
      "run_bank_reconciliation_jobs()",
    ]) {
      expect(sql).toContain(`revoke all on function public.${signature} from public,anon,authenticated;`);
      expect(sql).toContain(`grant execute on function public.${signature} to service_role;`);
    }
  });
});
