import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import os from "node:os";
import type { PackageDetail } from "./catalog.js";
import { writeLog } from "./logger.js";

type ActionRequest =
  | { type: "install" }
  | { type: "open-folder" }
  | { type: "script"; scriptName: string };

type KnownPackageManager = "npm" | "pnpm" | "yarn" | "bun";
type CommandSpec = {
  command: string;
  args: string[];
};

export type ActionResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  startedAt: string;
  endedAt: string;
};

const packageManagerCommands = {
  npm: {
    install: { command: "npm", args: ["install"] },
    script: (scriptName: string): CommandSpec => ({ command: "npm", args: ["run", scriptName] })
  },
  pnpm: {
    install: { command: "pnpm", args: ["install"] },
    script: (scriptName: string): CommandSpec => ({ command: "pnpm", args: [scriptName] })
  },
  yarn: {
    install: { command: "yarn", args: ["install"] },
    script: (scriptName: string): CommandSpec => ({ command: "yarn", args: [scriptName] })
  },
  bun: {
    install: { command: "bun", args: ["install"] },
    script: (scriptName: string): CommandSpec => ({ command: "bun", args: ["run", scriptName] })
  }
} as const;

const isKnownPackageManager = (value: string): value is KnownPackageManager =>
  value === "npm" || value === "pnpm" || value === "yarn" || value === "bun";

const resolveExecutable = (command: string) => {
  if (os.platform() !== "win32") {
    return command;
  }

  if (command === "npm" || command === "pnpm" || command === "yarn" || command === "bun") {
    return `${command}.cmd`;
  }

  return command;
};

const shouldUseShell = (command: string) => os.platform() === "win32" && command.endsWith(".cmd");

const resolveProcessCommand = (packageDetail: PackageDetail, action: ActionRequest) => {
  const packageManager = isKnownPackageManager(packageDetail.packageManager)
    ? packageDetail.packageManager
    : "npm";
  const manager = packageManagerCommands[packageManager];

  if (action.type === "install") {
    return manager.install;
  }

  if (action.type === "script") {
    return manager.script(action.scriptName);
  }

  if (os.platform() === "win32") {
    return { command: "explorer", args: [packageDetail.absolutePath] };
  }

  if (os.platform() === "darwin") {
    return { command: "open", args: [packageDetail.absolutePath] };
  }

  return { command: "xdg-open", args: [packageDetail.absolutePath] };
};

export const runAction = async (packageDetail: PackageDetail, action: ActionRequest): Promise<ActionResult> => {
  if (action.type === "script" && !packageDetail.scripts[action.scriptName]) {
    throw new Error(`Script "${action.scriptName}" does not exist in ${packageDetail.name}`);
  }

  const { command, args } = resolveProcessCommand(packageDetail, action);
  const executable = resolveExecutable(command);
  const startedAt = new Date().toISOString();

  writeLog("action", `Starting ${executable} ${args.join(" ")} in ${packageDetail.absolutePath}`);

  const result = await new Promise<ActionResult>((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams = spawn(executable, args, {
      cwd: packageDetail.absolutePath,
      env: process.env,
      stdio: "pipe",
      shell: shouldUseShell(executable)
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error: Error) => {
      reject(error);
    });

    child.on("close", (code: number | null) => {
      resolve({
        command: [executable, ...args].join(" "),
        exitCode: code ?? 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        startedAt,
        endedAt: new Date().toISOString()
      });
    });
  });

  writeLog("action", `Finished ${result.command} with exit code ${result.exitCode}`);

  return result;
};
