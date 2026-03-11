import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { createServer } from "../server/app.js";

describe("server API", () => {
  let workspaceRoot = "";
  let originalRuntimeDirectory = "";

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "xnpm-server-"));
    originalRuntimeDirectory = process.env.XNPM_RUNTIME_DIR ?? "";
    process.env.XNPM_RUNTIME_DIR = path.join(workspaceRoot, ".xnpm-runtime");
    await mkdir(path.join(workspaceRoot, "package-a"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "package-a", "package.json"),
      JSON.stringify(
        {
          name: "package-a",
          version: "0.1.0",
          scripts: {
            lint: "echo lint"
          }
        },
        null,
        2
      ),
      "utf8"
    );
  });

  afterEach(async () => {
    if (originalRuntimeDirectory) {
      process.env.XNPM_RUNTIME_DIR = originalRuntimeDirectory;
    } else {
      delete process.env.XNPM_RUNTIME_DIR;
    }
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("stores roots and returns scanned packages", async () => {
    const server = await createServer();
    await server.ready();

    await request(server.server)
      .post("/api/roots")
      .send({ roots: [workspaceRoot] })
      .expect(200);

    const packageResponse = await request(server.server).get("/api/packages?refresh=1").expect(200);

    expect(packageResponse.body.packages).toHaveLength(1);
    expect(packageResponse.body.packages[0]).toMatchObject({
      name: "package-a",
      status: "minimal"
    });

    await server.close();
  });

  it("returns detail and runs actions for packages with long encoded ids", async () => {
    const deeplyNestedPackagePath = path.join(
      workspaceRoot,
      "segment-one-very-long-router-limit-check",
      "segment-two-very-long-router-limit-check",
      "segment-three-very-long-router-limit-check",
      "package-router-limit-regression-check"
    );

    await mkdir(deeplyNestedPackagePath, { recursive: true });
    await writeFile(
      path.join(deeplyNestedPackagePath, "package.json"),
      JSON.stringify(
        {
          name: "package-router-limit-regression-check",
          version: "1.0.0",
          scripts: {
            lint: "node -e \"console.log('lint ok')\""
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const server = await createServer();
    await server.ready();

    await request(server.server)
      .post("/api/roots")
      .send({ roots: [workspaceRoot] })
      .expect(200);

    const packageResponse = await request(server.server).get("/api/packages?refresh=1").expect(200);
    const longIdPackage = packageResponse.body.packages.find(
      (entry: { name: string; id: string }) => entry.name === "package-router-limit-regression-check"
    );

    expect(longIdPackage).toBeDefined();
    expect(longIdPackage.id.length).toBeGreaterThan(100);

    const detailResponse = await request(server.server).get(`/api/packages/${longIdPackage.id}`).expect(200);
    expect(detailResponse.body.package).toMatchObject({
      name: "package-router-limit-regression-check"
    });

    const actionResponse = await request(server.server)
      .post(`/api/packages/${longIdPackage.id}/actions`)
      .send({ type: "script", scriptName: "lint" })
      .expect(200);

    expect(actionResponse.body.result.exitCode).toBe(0);
    expect(actionResponse.body.result.stdout).toContain("lint ok");

    await server.close();
  });
});
