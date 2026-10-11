"use client";

import { Icon } from "@/components/icons";

export type AccountAnswer = null | "added" | "once";

/**
 * Výpis z účtu, který firma nemá v nastavení. Dřív zaškrtávátko „Potvrdit
 * kontrolu“, u kterého nebylo jasné, co se potvrzuje. Teď otázka s třemi
 * srozumitelnými odpověďmi; zaúčtovat jde až po odpovědi.
 */
export function AccountQuestion({
  statementAccount,
  expectedAccount,
  answer,
  canAddAccount,
  working,
  onAdd,
  onOnce,
  onMistake,
  onReset,
}: {
  statementAccount: string | null;
  expectedAccount: string | null;
  answer: AccountAnswer;
  canAddAccount: boolean;
  working: boolean;
  onAdd: () => void;
  onOnce: () => void;
  onMistake: () => void;
  onReset: () => void;
}) {
  const account = statementAccount || "neznámý účet";
  if (answer)
    return (
      <div className="account-question is-answered" role="status">
        <span className="account-question-icon"><Icon name="check" /></span>
        <p>
          {answer === "added"
            ? <>Účet <span className="account">{account}</span> je přidaný k účtům firmy.</>
            : <>Výpis z účtu <span className="account">{account}</span> zpracujete tentokrát.</>}
        </p>
        <button type="button" className="btn secondary payment-action" disabled={working} onClick={onReset}>Změnit odpověď</button>
      </div>
    );
  return (
    <section className="account-question" role="alert" aria-labelledby="account-question-title">
      <span className="account-question-icon"><Icon name="alert" /></span>
      <div className="account-question-copy">
        <h3 id="account-question-title">Je účet <span className="account">{account}</span> váš?</h3>
        <p>
          Výpis je z účtu, který u firmy nemáte uložený
          {expectedAccount ? <> (uložený máte <span className="account">{expectedAccount}</span>)</> : null}.
          Platby z cizího výpisu by se zapsaly k vašim fakturám, proto se ptáme.
        </p>
      </div>
      <div className="account-question-actions">
        {canAddAccount && statementAccount && (
          <button type="button" className="btn primary payment-action" disabled={working} onClick={onAdd}>Ano, přidat k účtům firmy</button>
        )}
        <button type="button" className={`btn ${canAddAccount && statementAccount ? "secondary" : "primary"} payment-action`} disabled={working} onClick={onOnce}>Ano, jen tentokrát</button>
        <button type="button" className="btn secondary payment-action account-question-mistake" disabled={working} onClick={onMistake}>Ne, je to omyl</button>
      </div>
    </section>
  );
}
