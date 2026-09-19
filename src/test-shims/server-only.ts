// Next.js resolves the real "server-only" package itself (it's not a plain
// npm dependency reachable outside Next's own build pipeline -- see
// https://www.npmjs.com/package/server-only). Vitest runs modules through
// Vite instead, which can't resolve it at all, so every file that does
// `import "server-only"` (a build-time guard against accidental client
// bundling, meaningless in a Node test run) needs this aliased in as a no-op
// -- see the "server-only" entry in vitest.config.mts.
export {};
