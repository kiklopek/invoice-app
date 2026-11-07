import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const root = process.cwd(),
  prod = "/tmp/splatno-responsive-production-26defdc",
  out = path.resolve("artifacts/responsive-audit/2026-11-02");
const req = createRequire(path.resolve("package.json")),
  postcss = req("postcss");
function list(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? list(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
}
function inspect(source) {
  const cssFiles = list(path.join(source, "src")).filter((p) =>
    p.endsWith(".css"),
  );
  const css = [];
  for (const file of cssFiles) {
    const text = fs.readFileSync(file, "utf8"),
      tree = postcss.parse(text, { from: file }),
      media = [],
      containers = [],
      selectors = new Map(),
      dimensions = [];
    let important = 0;
    tree.walkAtRules((at) => {
      if (at.name === "media")
        media.push({ query: at.params, line: at.source.start.line });
      if (at.name === "container")
        containers.push({ query: at.params, line: at.source.start.line });
    });
    tree.walkRules((r) => {
      const n = selectors.get(r.selector) || [];
      n.push(r.source.start.line);
      selectors.set(r.selector, n);
    });
    tree.walkDecls((d) => {
      if (d.important) important++;
      if (
        /^(?:min-|max-)?(?:width|height)$|^grid-template|^overflow|^container-|^zoom$/.test(
          d.prop,
        )
      )
        dimensions.push({
          property: d.prop,
          value: d.value,
          line: d.source.start.line,
          selector: d.parent.selector || d.parent.name,
        });
    });
    css.push({
      path: path.relative(source, file),
      lines: text.split("\n").length,
      important,
      media,
      containers,
      duplicateSelectors: [...selectors]
        .filter(([, v]) => v.length > 1)
        .map(([selector, lines]) => ({ selector, lines })),
      layoutDeclarations: dimensions,
    });
  }
  const routes = list(path.join(source, "src/app"))
    .filter((p) => p.endsWith("/page.tsx") && !p.includes("/api/"))
    .map((p) => ({
      path: path.relative(source, p),
      url:
        "/" +
        path
          .relative(path.join(source, "src/app"), p)
          .replace(/\/page\.tsx$/, "")
          .split("/")
          .filter((s) => !/^\(.+\)$/.test(s))
          .join("/"),
      client: /^[\s]*["']use client["']/.test(fs.readFileSync(p, "utf8")),
    }));
  const runtime = [];
  for (const file of list(path.join(source, "src")).filter(
    (p) => /\.tsx?$/.test(p) && !p.includes(".test."),
  )) {
    fs.readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (
          /matchMedia|ResizeObserver|innerWidth|visualViewport|data-proportional-layout/.test(
            line,
          )
        )
          runtime.push({
            path: path.relative(source, file),
            line: i + 1,
            text: line.trim().slice(0, 300),
          });
      });
  }
  return {
    css,
    routes,
    runtime,
    summary: {
      cssFiles: css.length,
      mediaQueries: css.reduce((a, c) => a + c.media.length, 0),
      containerQueries: css.reduce((a, c) => a + c.containers.length, 0),
      importantDeclarations: css.reduce((a, c) => a + c.important, 0),
      routePages: routes.length,
    },
  };
}
const production = inspect(prod),
  local = inspect(root);
fs.writeFileSync(
  path.join(out, "static-inventory.json"),
  JSON.stringify({ production, local }, null, 2),
);
const changed = execFileSync("git", ["diff", "--name-only"], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);
fs.writeFileSync(
  path.join(out, "local-vs-production.patch"),
  execFileSync("git", ["diff", "--", "src", "next-env.d.ts"]),
);
fs.writeFileSync(
  path.join(out, "layer-map.json"),
  JSON.stringify(
    {
      source:
        "production commit 26defdc; current local differences separately inventoried",
      layers: [
        {
          layer: "application shell",
          owner: "AppShell/AppSidebar/WorkspaceTopbar",
          source: "src/components/layout/",
          trigger: "viewport and JS matchMedia",
        },
        {
          layer: "page composition",
          owner: "AppFrame and route-specific modules",
          source: "src/app/(workspace)/",
          trigger: "viewport, min/max-width, height",
        },
        {
          layer: "component groups",
          owner: "Dashboard/KPI/form/item-grid/table containers",
          trigger: "CSS grid and inline-size containers",
        },
        {
          layer: "component",
          owner: "MoneyAmount/InvoiceForm/cards",
          trigger: "container queries and ResizeObserver",
        },
        {
          layer: "interaction",
          owner: "Modal/PopupFitter/row menus/payment popovers",
          trigger:
            "top layer, viewport measurements, visualViewport and scroll/resize",
        },
      ],
      changedExistingPaths: changed,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      production: production.summary,
      local: local.summary,
      changedExistingPaths: changed,
    },
    null,
    2,
  ),
);
