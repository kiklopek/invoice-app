// @vitest-environment jsdom
//
// Celý workspace sdílí jednu SWR cache s vlastním provider: () => new Map()
// (viz WorkspaceDataProvider). Ověřeno experimentem, který stálo za to
// zapsat, protože výsledek je proti očekávání: globální mutate() naimportované
// přímo z "swr" tuhle vlastní cache NEVIDÍ a proti ní tiše nedělá nic --
// funkční je jen mutate vrácené hookem useSWRConfig(), na kontext vázané.
// useInvalidateWorkspaceData() proto stojí na useSWRConfig(), ne na importu.
import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import useSWR, { SWRConfig } from "swr";
import { useInvalidateWorkspaceData } from "./workspace-cache";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let calls: Record<string, number> = {};
function makeFetcher(key: string) {
  calls[key] = (calls[key] ?? 0) + 1;
  return Promise.resolve(`${key}:${calls[key]}`);
}

function DashboardLike() {
  const { data } = useSWR("/api/dashboard", () => makeFetcher("/api/dashboard"));
  return createElement("span", { id: "dashboard" }, String(data));
}
function ReportsLike() {
  const { data } = useSWR("/api/reports?period=month", () => makeFetcher("/api/reports?period=month"));
  return createElement("span", { id: "reports" }, String(data));
}
function UnrelatedThirdParty() {
  // Simuluje klíč, který by predikát "začíná na /api/" neměl zasáhnout jinak
  // než přes obnovu -- zde jen ověřuje, že se nerozbije nic mimo /api/.
  const { data } = useSWR("swr-internal-marker", () => Promise.resolve("nedotčeno"));
  return createElement("span", { id: "other" }, String(data));
}
// Tlačítko s onClick místo vytažení funkce z renderu -- odpovídá tomu, jak
// se hook doopravdy volá v produkčním kódu (z event handleru po úspěšné
// mutaci), a nesráží se to s pravidly React Compileru proti vedlejším
// účinkům během renderu.
function Trigger() {
  const invalidate = useInvalidateWorkspaceData();
  return createElement("button", { id: "trigger", onClick: () => { void invalidate(); } });
}

function clickTrigger(container: HTMLDivElement) {
  container.querySelector<HTMLButtonElement>("#trigger")!.dispatchEvent(
    new MouseEvent("click", { bubbles: true }),
  );
}

async function renderAll(): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const provider = () => new Map();
  await act(async () => {
    root.render(
      createElement(
        SWRConfig,
        { value: { provider, dedupingInterval: 0 } },
        createElement(DashboardLike),
        createElement(ReportsLike),
        createElement(UnrelatedThirdParty),
        createElement(Trigger),
      ),
    );
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  return { container, root };
}

let activeRoot: Root | null = null;
afterEach(() => {
  if (activeRoot) act(() => activeRoot!.unmount());
  activeRoot = null;
  calls = {};
});

describe("useInvalidateWorkspaceData", () => {
  it("vynutí nové načtení na všech stránkách s klíčem začínajícím /api/", async () => {
    const { container, root } = await renderAll();
    activeRoot = root;
    expect(container.querySelector("#dashboard")?.textContent).toBe("/api/dashboard:1");
    expect(container.querySelector("#reports")?.textContent).toBe("/api/reports?period=month:1");

    await act(async () => {
      clickTrigger(container);
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Obě stránky musí zaznamenat druhé volání -- to je celý smysl funkce.
    expect(container.querySelector("#dashboard")?.textContent).toBe("/api/dashboard:2");
    expect(container.querySelector("#reports")?.textContent).toBe("/api/reports?period=month:2");
  });

  it("nechá klíče mimo /api/ na pokoji", async () => {
    const { container, root } = await renderAll();
    activeRoot = root;
    await act(async () => {
      clickTrigger(container);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    // Interní SWR klíč nezačíná /api/, takže se nesmí přerenderovat na chybu
    // ani zmizet -- žádost o predikát na "/api/" ho vůbec nezasáhne.
    expect(container.querySelector("#other")?.textContent).toBe("nedotčeno");
  });
});
