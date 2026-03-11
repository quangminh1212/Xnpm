import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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

type RuntimeContext = {
  platform: NodeJS.Platform;
  environment: NodeJS.ProcessEnv;
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

const defaultRuntimeContext = (): RuntimeContext => ({
  platform: os.platform(),
  environment: process.env
});

const hasPathSeparator = (value: string) => value.includes("/") || value.includes("\\");

const getExecutableSearchPath = (environment: NodeJS.ProcessEnv) =>
  (environment.PATH ?? environment.Path ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

const getCommandCandidates = (command: string, runtime: RuntimeContext) => {
  if (runtime.platform !== "win32" || path.extname(command)) {
    return [command];
  }

  const executableExtensions = Array.from(
    new Set(
      (runtime.environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .map((extension) => extension.trim().toLowerCase())
        .filter(Boolean)
    )
  );

  return [...executableExtensions.map((extension) => `${command}${extension}`), command];
};

const findExecutable = (command: string, runtime: RuntimeContext) => {
  const candidates = getCommandCandidates(command, runtime);

  if (path.isAbsolute(command) || hasPathSeparator(command)) {
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }

  for (const directory of getExecutableSearchPath(runtime.environment)) {
    for (const candidate of candidates) {
      const resolvedPath = path.join(directory, candidate);
      if (existsSync(resolvedPath)) {
        return resolvedPath;
      }
    }
  }

  return null;
};

export const resolveExecutable = (command: string, runtime = defaultRuntimeContext()) => {
  const resolvedCommand = findExecutable(command, runtime);
  if (resolvedCommand) {
    const resolvedExtension = path.extname(resolvedCommand).toLowerCase();
    if (
      runtime.platform === "win32" &&
      [".cmd", ".bat"].includes(resolvedExtension) &&
      !path.isAbsolute(command) &&
      !hasPathSeparator(command)
    ) {
      return path.basename(resolvedCommand);
    }

    return resolvedCommand;
  }

  if (runtime.platform === "win32" && !path.extname(command)) {
    return `${command}.cmd`;
  }

  return command;
};

const shouldUseShell = (command: string, runtime = defaultRuntimeContext()) =>
  runtime.platform === "win32" && [".cmd", ".bat"].includes(path.extname(command).toLowerCase());

const openFolderCommandsByPlatform = {
  win32: [{ command: "explorer", args: [] }],
  darwin: [{ command: "open", args: [] }],
  linux: [
    { command: "xdg-open", args: [] },
    { command: "gio", args: ["open"] },
    { command: "gnome-open", args: [] },
    { command: "kde-open", args: [] }
  ]
} as const;

export const resolveOpenFolderCommand = (directoryPath: string, runtime = defaultRuntimeContext()): CommandSpec => {
  const overrideCommand = runtime.environment.XNPM_OPEN_FOLDER_COMMAND?.trim();

  if (overrideCommand) {
    return {
      command: overrideCommand,
      args: [directoryPath]
    };
  }

  const candidates =
    runtime.platform === "win32"
      ? openFolderCommandsByPlatform.win32
      : runtime.platform === "darwin"
        ? openFolderCommandsByPlatform.darwin
        : openFolderCommandsByPlatform.linux;

  for (const candidate of candidates) {
    if (runtime.platform === "win32") {
      return {
        command: resolveExecutable(candidate.command, runtime),
        args: [...candidate.args, directoryPath]
      };
    }

    const resolvedCommand = findExecutable(candidate.command, runtime);
    if (resolvedCommand) {
      return {
        command: resolvedCommand,
        args: [...candidate.args, directoryPath]
      };
    }
  }

  throw new Error(
    `Unable to find a folder opener for platform "${runtime.platform}". Set XNPM_OPEN_FOLDER_COMMAND to override it.`
  );
};

export const resolveProcessCommand = (
  packageDetail: PackageDetail,
  action: ActionRequest,
  runtime = defaultRuntimeContext()
) => {
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

  return resolveOpenFolderCommand(packageDetail.absolutePath, runtime);
};

export const runAction = async (packageDetail: PackageDetail, action: ActionRequest): Promise<ActionResult> => {
  if (action.type === "script" && !packageDetail.scripts[action.scriptName]) {
    throw new Error(`Script "${action.scriptName}" does not exist in ${packageDetail.name}`);
  }

  const runtime = defaultRuntimeContext();
  const { command, args } = resolveProcessCommand(packageDetail, action, runtime);
  const executable = resolveExecutable(command, runtime);
  const startedAt = new Date().toISOString();

  writeLog("action", `Starting ${executable} ${args.join(" ")} in ${packageDetail.absolutePath}`);

  const result = await new Promise<ActionResult>((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams = spawn(executable, args, {
      cwd: packageDetail.absolutePath,
      env: process.env,
      stdio: "pipe",
      shell: shouldUseShell(executable, runtime)
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
