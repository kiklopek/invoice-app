# Dependency security fixes

`brace-expansion` is pinned to patched releases within each installed major line
using `package.json` overrides: 1.1.21, 2.1.6, and 5.0.12.

## braces 3.0.3 — CVE-2026-93687

Upstream has no published fixed version as of 2026-10-05:
https://github.com/advisories/GHSA-vfj7-8cjw-p6xm

`patches/braces@3.0.3.patch` caps parsing and all three recursive AST walkers
(compile, expand, stringify) at 128 nesting levels. Both strings and caller-supplied
ASTs receive a controlled SyntaxError before exhausting the native call stack.
Normal glob patterns and numeric ranges retain their existing behavior.

The npm registry audit cannot detect local patches, so only CVE-2026-93687 is
excluded from its version-based findings. `audit:ci` first runs the regression
tests against the actual dependency loaded by Next's lint tooling; the audit
step fails if the patch is absent or ineffective. All other high and critical
findings continue to block CI.

When upstream publishes a fixed release, replace the local patch with that
release and remove its audit exclusion. Keep the regression tests.
