import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveExecutable, resolveOpenFolderCommand } from "../server/process-runner.js";

describe("process runner compatibility", () => {
  let tempDirectory = "";

  beforeEach(async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), "xnpm-runner-"));
  });

  afterEach(async () => {
    await rm(tempDirectory, { recursive: true, force: true });
  });

  it("resolves native Windows executables without assuming only .cmd shims", async () => {
    const bunExecutablePath = path.join(tempDirectory, "bun.exe");
    await writeFile(bunExecutablePath, "", "utf8");

    const resolvedExecutable = resolveExecutable("bun", {
      platform: "win32",
      environment: {
        PATH: tempDirectory,
        PATHEXT: ".EXE;.CMD"
      }
    });

    expect(resolvedExecutable.toLowerCase()).toBe(bunExecutablePath.toLowerCase());
  });

  it("keeps Windows cmd shims as command names so shell resolution handles spaced install paths", async () => {
    await writeFile(path.join(tempDirectory, "npm.cmd"), "", "utf8");

    const resolvedExecutable = resolveExecutable("npm", {
      platform: "win32",
      environment: {
        PATH: tempDirectory,
        PATHEXT: ".CMD;.EXE"
      }
    });

    expect(resolvedExecutable).toBe("npm.cmd");
  });

  it("falls back to gio open when xdg-open is unavailable on Linux", async () => {
    const gioExecutablePath = path.join(tempDirectory, "gio");
    await writeFile(gioExecutablePath, "", "utf8");

    const command = resolveOpenFolderCommand("/tmp/demo-package", {
      platform: "linux",
      environment: {
        PATH: tempDirectory
      }
    });

    expect(command).toEqual({
      command: gioExecutablePath,
      args: ["open", "/tmp/demo-package"]
    });
  });

  it("allows overriding the folder opener explicitly through environment variables", () => {
    const command = resolveOpenFolderCommand("/tmp/demo-package", {
      platform: "linux",
      environment: {
        PATH: "",
        XNPM_OPEN_FOLDER_COMMAND: "custom-open"
      }
    });

    expect(command).toEqual({
      command: "custom-open",
      args: ["/tmp/demo-package"]
    });
  });
});
