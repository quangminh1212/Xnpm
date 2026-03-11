import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getCatalog } from "../server/catalog.js";

describe("catalog scanning", () => {
  let workspaceRoot = "";

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "xnpm-catalog-"));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("discovers package manifests and analyzes workflow status", async () => {
    const packagePath = path.join(workspaceRoot, "packages", "core");
    await mkdir(packagePath, { recursive: true });
    await writeFile(
      path.join(packagePath, "package.json"),
      JSON.stringify(
        {
          name: "@demo/core",
          version: "1.2.3",
          scripts: {
            lint: "eslint .",
            test: "vitest run",
            build: "tsc -p tsconfig.json"
          },
          dependencies: {
            react: "^19.0.0"
          },
          devDependencies: {
            typescript: "^5.0.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const catalog = await getCatalog([workspaceRoot], true);

    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      name: "@demo/core",
      version: "1.2.3",
      status: "healthy",
      dependencyCount: 1,
      devDependencyCount: 1,
      scriptCount: 3
    });
  });
});
