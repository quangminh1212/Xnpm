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
});
