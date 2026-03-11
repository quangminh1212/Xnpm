import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeLog } from "./logger.js";

type DependencyMap = Record<string, string>;

export type PackageStatus = "healthy" | "attention" | "minimal";

export type PackageSummary = {
  id: string;
  name: string;
  version: string;
  packageManager: string;
  relativePath: string;
  absolutePath: string;
  rootPath: string;
  private: boolean;
  dependencyCount: number;
  devDependencyCount: number;
  scriptCount: number;
  workspaceCount: number;
  lastModified: string;
  status: PackageStatus;
  statusReason: string;
  scriptNames: string[];
};

export type PackageDetail = PackageSummary & {
  scripts: Record<string, string>;
  dependencies: DependencyMap;
  devDependencies: DependencyMap;
  peerDependencies: DependencyMap;
  optionalDependencies: DependencyMap;
  engines: Record<string, string>;
  keywords: string[];
  workspaces: string[];
  description: string;
};

type CatalogCache = {
  packages: PackageDetail[];
  roots: string[];
  cachedAt: number;
};

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  ".yarn",
  "coverage",
  "dist",
  "build",
  "node_modules",
  ".cache",
  "out"
]);

const packageManagerByLockfile = [
  { file: "pnpm-lock.yaml", name: "pnpm" },
  { file: "yarn.lock", name: "yarn" },
  { file: "bun.lockb", name: "bun" },
  { file: "package-lock.json", name: "npm" }
];

let cache: CatalogCache | null = null;

const encodeId = (value: string) => Buffer.from(value, "utf8").toString("base64url");

const decodeId = (value: string) => Buffer.from(value, "base64url").toString("utf8");

const normalizeDirectory = (targetPath: string) =>
  path.resolve(targetPath.trim()).replace(/[\\/]+$/, "");

const unique = <T>(items: T[]) => [...new Set(items)];

const toRecord = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, string>>((accumulator, [key, item]) => {
    if (typeof item === "string") {
      accumulator[key] = item;
    }

    return accumulator;
  }, {});
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
};

const inferPackageManager = async (
  packageManagerField: unknown,
  packageDirectory: string
) => {
  if (typeof packageManagerField === "string" && packageManagerField.trim().length > 0) {
    return packageManagerField.split("@")[0];
  }

  for (const entry of packageManagerByLockfile) {
    try {
      await fs.access(path.join(packageDirectory, entry.file));
      return entry.name;
    } catch {
      continue;
    }
  }

  return "npm";
};

const analyzeStatus = (packageName: string, scripts: Record<string, string>, workspaceCount: number) => {
  const hasValidationPipeline = ["lint", "test", "build"].every((scriptName) => scripts[scriptName]);
  const scriptCount = Object.keys(scripts).length;

  if (hasValidationPipeline) {
    return {
      status: "healthy" as const,
      statusReason: "Ready for day-to-day development"
    };
  }

  if (scriptCount >= 2 || workspaceCount > 0) {
    return {
      status: "attention" as const,
      statusReason: `${packageName} is missing at least one core workflow script`
    };
  }

  return {
    status: "minimal" as const,
    statusReason: "Package is lightweight and needs setup before active work"
  };
};

const createDetail = async (packageFilePath: string, rootPath: string) => {
  const absolutePath = path.dirname(packageFilePath);
  const packageJsonRaw = await fs.readFile(packageFilePath, "utf8");
  const packageJson = JSON.parse(packageJsonRaw) as Record<string, unknown>;
  const packageStats = await fs.stat(packageFilePath);

  const scripts = toRecord(packageJson.scripts);
  const dependencies = toRecord(packageJson.dependencies);
  const devDependencies = toRecord(packageJson.devDependencies);
  const peerDependencies = toRecord(packageJson.peerDependencies);
  const optionalDependencies = toRecord(packageJson.optionalDependencies);
  const engines = toRecord(packageJson.engines);
  const workspaces = toStringArray(packageJson.workspaces);
  const packageManager = await inferPackageManager(packageJson.packageManager, absolutePath);
  const status = analyzeStatus(String(packageJson.name ?? path.basename(absolutePath)), scripts, workspaces.length);
  const id = encodeId(absolutePath);

  const summary: PackageSummary = {
    id,
    name: String(packageJson.name ?? path.basename(absolutePath)),
    version: String(packageJson.version ?? "0.0.0"),
    packageManager,
    relativePath: path.relative(rootPath, absolutePath) || ".",
    absolutePath,
    rootPath,
    private: Boolean(packageJson.private),
    dependencyCount: Object.keys(dependencies).length,
    devDependencyCount: Object.keys(devDependencies).length,
    scriptCount: Object.keys(scripts).length,
    workspaceCount: workspaces.length,
    lastModified: packageStats.mtime.toISOString(),
    status: status.status,
    statusReason: status.statusReason,
    scriptNames: Object.keys(scripts).sort((left, right) => left.localeCompare(right))
  };

  return {
    ...summary,
    scripts,
    dependencies,
    devDependencies,
    peerDependencies,
    optionalDependencies,
    engines,
    keywords: toStringArray(packageJson.keywords),
    workspaces,
    description: typeof packageJson.description === "string" ? packageJson.description : ""
  } satisfies PackageDetail;
};

const scanDirectory = async (currentPath: string, discoveredFiles: string[]) => {
  let entries;

  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch (error) {
    writeLog("scan", `Skipping ${currentPath}: ${error instanceof Error ? error.message : "unknown error"}`);
    return;
  }

  if (entries.some((entry) => entry.isFile() && entry.name === "package.json")) {
    discoveredFiles.push(path.join(currentPath, "package.json"));
  }

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory() || entry.isSymbolicLink() || ignoredDirectories.has(entry.name)) {
        return;
      }

      await scanDirectory(path.join(currentPath, entry.name), discoveredFiles);
    })
  );
};

const scanRoots = async (roots: string[]) => {
  const packageFiles: string[] = [];
  for (const rootPath of roots) {
    await scanDirectory(rootPath, packageFiles);
  }

  const packages = (
    await Promise.all(unique(packageFiles).map(async (packageFilePath) => {
      const rootPath =
        roots.find((candidate) => packageFilePath.startsWith(candidate)) ?? path.dirname(packageFilePath);

      try {
        return await createDetail(packageFilePath, rootPath);
      } catch (error) {
        writeLog(
          "scan",
          `Failed to parse ${packageFilePath}: ${error instanceof Error ? error.message : "unknown error"}`
        );
        return null;
      }
    }))
  )
    .filter((item): item is PackageDetail => item !== null)
    .sort((left, right) => left.name.localeCompare(right.name));

  writeLog("scan", `Discovered ${packages.length} package(s) across ${roots.length} root(s)`);

  return packages;
};

export const getSuggestedRoots = async () => {
  const candidates = unique(
    [
      process.cwd(),
      path.dirname(process.cwd()),
      path.join(os.homedir(), "Projects"),
      path.join(os.homedir(), "Documents"),
      path.join(os.homedir(), "source", "repos"),
      "C:\\Dev"
    ].map(normalizeDirectory)
  );

  const existing: string[] = [];
  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isDirectory()) {
        existing.push(candidate);
      }
    } catch {
      continue;
    }
  }

  return existing;
};

export const getPackageById = async (packageId: string, roots: string[]) => {
  const packages = await getCatalog(roots);
  const expectedPath = normalizeDirectory(decodeId(packageId));

  return packages.find((packageDetail) => normalizeDirectory(packageDetail.absolutePath) === expectedPath) ?? null;
};

export const getCatalog = async (roots: string[], forceRefresh = false) => {
  const normalizedRoots = unique(roots.map(normalizeDirectory)).sort((left, right) => left.localeCompare(right));

  if (
    !forceRefresh &&
    cache &&
    cache.cachedAt > Date.now() - 15_000 &&
    JSON.stringify(cache.roots) === JSON.stringify(normalizedRoots)
  ) {
    return cache.packages;
  }

  const packages = await scanRoots(normalizedRoots);
  cache = {
    packages,
    roots: normalizedRoots,
    cachedAt: Date.now()
  };

  return packages;
};
