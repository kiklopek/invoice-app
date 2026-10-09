"use client";

import { useEffect } from "react";
import { findPlan, isBillingPeriod } from "@/lib/plans";

// Tarif vybraný v ceníku (/register?tarif=profi&obdobi=yearly) si prohlížeč
// zapamatuje, aby ho onboarding po potvrzení e-mailu předvyplnil. Nic se tím
// neobjednává; výběr jde v onboardingu změnit.
export function PlanChoiceMemo() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const plan = params.get("tarif");
    const period = params.get("obdobi");
    if (!plan || !findPlan(plan)) return;
    try {
      window.localStorage.setItem("splatno:plan-choice", JSON.stringify({ plan, period: isBillingPeriod(period) ? period : "monthly" }));
    } catch {
      // Bez úložiště se jen nepředvyplní.
    }
  }, []);
  return null;
}
