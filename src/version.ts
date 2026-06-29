/**
 * Single source of truth for the package version, read from package.json
 * at build time. ncc inlines the JSON into the bundle, so the constant is
 * available in both `dist/index.js` (the action) and `dist/cli/index.js`
 * (the CLI) without any filesystem lookups at runtime.
 *
 * Consumers:
 *   - `cli.ts` for `--version` output
 *   - `probe.ts` for the wire-level `clientInfo.version` advertised on both
 *     the stateless `server/discover` path and the legacy `initialize`
 *     fallback (kept consistent so packet captures show the same version
 *     no matter which probe path was taken)
 */
import pkg from "../package.json" with { type: "json" };

export const PACKAGE_VERSION: string = (pkg as { version: string }).version;
