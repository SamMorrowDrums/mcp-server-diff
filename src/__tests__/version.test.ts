/**
 * Smoke test for the package-version single-source-of-truth wiring. The
 * production code reads from package.json at build time (via ncc's JSON
 * import inlining); the test reads the same package.json via the
 * filesystem and asserts both agree.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PACKAGE_VERSION } from "../version.js";

describe("PACKAGE_VERSION", () => {
  it("matches the version declared in package.json", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(here, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    expect(PACKAGE_VERSION).toBe(pkg.version);
  });

  it("is a non-empty semver-ish string", () => {
    expect(typeof PACKAGE_VERSION).toBe("string");
    expect(PACKAGE_VERSION.length).toBeGreaterThan(0);
    expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
