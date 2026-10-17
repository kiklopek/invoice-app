// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyLogo } from "./company-logo";

vi.mock("next/image", () => ({
  default: ({ unoptimized, preload, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean; preload?: boolean }) => {
    void unoptimized;
    void preload;
    return React.createElement("img", props);
  },
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("shared company logo", () => {
  it.each([null, undefined, "", "  "])("uses Splatno when company logo is %s", async (src) => {
    await act(async () => root.render(<CompanyLogo src={src} name="Novák" />));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/brand/splatno-mark.svg");
    expect(container.querySelector("img")?.alt).toBe("Splatno");
  });

  it("uses the organization's uploaded logo in every placement", async () => {
    const src = "/logo/00000000-0000-0000-0000-000000000001?v=1";
    await act(async () => root.render(<>
      <CompanyLogo src={src} name="Novák" className="sidebar-company-logo" />
      <CompanyLogo src={src} name="Novák" className="mobile-navigation-logo" />
    </>));
    expect([...container.querySelectorAll("img")].map((image) => image.getAttribute("src"))).toEqual([src, src]);
  });

  it("recovers from a missing upload and displays a newly uploaded version", async () => {
    await act(async () => root.render(<CompanyLogo src="/logo/company?v=1" name="Novák" />));
    await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/brand/splatno-mark.svg");
    await act(async () => root.render(<CompanyLogo src="/logo/company?v=2" name="Novák" />));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/logo/company?v=2");
    expect(container.querySelector("img")?.alt).toBe("Logo firmy Novák");
  });

  it("shows Splatno after switching to a company without a logo", async () => {
    await act(async () => root.render(<CompanyLogo src="/logo/first?v=1" name="První firma" />));
    await act(async () => root.render(<CompanyLogo src={null} name="Druhá firma" />));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/brand/splatno-mark.svg");
  });
});
