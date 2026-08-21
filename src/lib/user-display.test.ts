import { describe, expect, it } from "vitest";
import { displayName, profileInitials } from "./user-display";

describe("user display", () => {
  it("uses the normalized registration name and creates initials", () => {
    expect(displayName("  Robert   Hlavica  ", "hlavica@hlavica.cz")).toBe("Robert Hlavica");
    expect(profileInitials("Robert Hlavica", "hlavica@hlavica.cz")).toBe("RH");
  });

  it("creates a readable fallback for older accounts without a name", () => {
    const name = displayName(undefined, "robert.hlavica@hlavica.cz");
    expect(name).toBe("Robert Hlavica");
    expect(profileInitials(name, "robert.hlavica@hlavica.cz")).toBe("RH");
  });
});
