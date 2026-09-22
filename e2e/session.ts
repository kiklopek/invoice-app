import { expect, test, type Page, type TestInfo } from "@playwright/test";

// Postranní panel se zobrazuje až nad 780 px; pod tím ho nahrazuje hamburger.
// Specy, které panel ověřují, se proto dřív přeskakovaly podmínkou
// `project.name.startsWith("mobile")` -- jenže projekt `tablet` má 768 px,
// takže na něm běžely a selhávaly na chování, které je správné. Odvozovat to
// od šířky místo od názvu znamená, že další přidaný projekt tenhle problém
// nezopakuje.
export const DESKTOP_NAVIGATION_MIN_WIDTH = 781;

function viewportWidth(testInfo: TestInfo) {
  // Bez nastavené šířky platí výchozích 1280 px Playwrightu.
  return testInfo.project.use.viewport?.width ?? 1280;
}

export function skipWithoutDesktopNavigation(testInfo: TestInfo) {
  const width = viewportWidth(testInfo);
  test.skip(
    width < DESKTOP_NAVIGATION_MIN_WIDTH,
    `Postranní panel se zobrazuje až od ${DESKTOP_NAVIGATION_MIN_WIDTH} px, tenhle projekt má ${width} px`,
  );
}

// Přesný doplněk předchozí podmínky: každý projekt musí spadnout právě do
// jedné z nich, jinak by některá šířka zůstala bez testu navigace úplně.
export function skipWithDesktopNavigation(testInfo: TestInfo) {
  const width = viewportWidth(testInfo);
  test.skip(
    width >= DESKTOP_NAVIGATION_MIN_WIDTH,
    `Hamburger je jen pod ${DESKTOP_NAVIGATION_MIN_WIDTH} px, tenhle projekt má ${width} px`,
  );
}

// Driv kazdy workspace spec zacinal na
//   test.skip(page.url().includes("/login"), "Requires an authenticated session")
// a protoze v CI zadna session neni, cela workspace sada se PRESKAKOVALA.
// Vysledek: zelene CI, ktere ve skutecnosti spustilo jediny test. Skip proto
// uz neni vychozi chovani, ale vedoma vyjimka zapnuta promennou prostredi --
// aby mezera byla videt v konfiguraci, ne schovana v testech.
export async function requireWorkspaceSession(page: Page, what: string) {
  if (!page.url().includes("/login")) return false;

  if (process.env.E2E_ALLOW_UNAUTHENTICATED === "true") {
    // Imperativni test.skip() preskoci i test, jehoz beforeEach tohle vola --
    // pouhy `return` by hook jen ukoncil a telo testu by pak bezelo dal
    // a spadlo na necem nesouvisejicim.
    test.skip(true, `Bez přihlášení: ${what}`);
    return true;
  }

  expect(
    page.url(),
    `Test "${what}" potřebuje přihlášenou session, ale server přesměroval na /login. ` +
      "Nastavte E2E_PASSWORD (a E2E_EMAIL), nebo běh bez přihlášení výslovně povolte " +
      "pomocí E2E_ALLOW_UNAUTHENTICATED=true.",
  ).not.toContain("/login");
  return false;
}
