import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const env = { ...process.env };

// Next.js 16.3 treats any inherited DEBUG value as its internal test mode and
// prints Turbopack diagnostics. These variables must be opt-in for this app.
delete env.DEBUG;
delete env.NEXT_TEST_MODE;
delete env.__NEXT_TEST_MODE;

const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error("Next.js se nepodařilo spustit:", error.message);
  process.exitCode = 1;
});

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
