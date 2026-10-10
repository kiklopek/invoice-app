import { describe, expect, it } from "vitest";
import { cs } from "./dictionaries/cs";
import { en } from "./dictionaries/en";

type Leaf = { path: string; value: unknown };

function leaves(node: unknown, path = ""): Leaf[] {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    return Object.entries(node).flatMap(([key, value]) => leaves(value, path ? `${path}.${key}` : key));
  }
  if (Array.isArray(node)) return node.flatMap((value, index) => leaves(value, `${path}[${index}]`));
  return [{ path, value: node }];
}

// Funkce se pro kontrolu zavolají s ukázkovými argumenty.
function text(value: unknown) {
  return typeof value === "function" ? String((value as (...args: unknown[]) => unknown)("X", "X")) : value;
}

const CZECH = /[ěščřžýáíéůúňťďĚŠČŘŽÝÁÍÉŮÚŇŤĎ]/;
// Názvy jazyků v přepínači se píšou vždy v daném jazyce.
const ALLOWED_CZECH = new Set(["switcher.cs"]);

describe("slovníky veřejné části", () => {
  it("angličtina má přesně stejné klíče a délky seznamů jako čeština", () => {
    expect(leaves(en).map((leaf) => leaf.path)).toEqual(leaves(cs).map((leaf) => leaf.path));
  });

  it("žádný text není prázdný a typy se shodují", () => {
    const csLeaves = leaves(cs);
    leaves(en).forEach((leaf, index) => {
      expect(typeof leaf.value, leaf.path).toBe(typeof csLeaves[index].value);
      expect(String(text(leaf.value)).trim(), leaf.path).not.toBe("");
    });
  });

  it("anglické texty neobsahují zapomenutou češtinu", () => {
    const forgotten = leaves(en)
      .filter((leaf) => !ALLOWED_CZECH.has(leaf.path))
      .filter((leaf) => CZECH.test(String(text(leaf.value))))
      .map((leaf) => leaf.path);
    expect(forgotten).toEqual([]);
  });
});
