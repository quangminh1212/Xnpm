import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { writeLog } from "./logger.js";

const dataDirectory = path.resolve(process.env.XNPM_RUNTIME_DIR ?? path.join(process.cwd(), "data", "runtime"));
const rootsFilePath = path.join(dataDirectory, "roots.json");

const normalizeRoots = (roots: string[]) =>
  [...new Set(roots.map((rootPath) => path.resolve(rootPath.trim()).replace(/[\\/]+$/, "")).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );

const ensureDataDirectory = async () => {
  await fs.mkdir(dataDirectory, { recursive: true });
};

export const readRoots = async () => {
  await ensureDataDirectory();

  try {
    const fileContents = await fs.readFile(rootsFilePath, "utf8");
    const payload = JSON.parse(fileContents) as { roots?: string[] };
    const validRoots = normalizeRoots(payload.roots ?? []).filter((rootPath) => existsSync(rootPath));

    if (validRoots.length > 0) {
      return validRoots;
    }
  } catch {
    // fall through to the default path
  }

  const defaultRoots = [path.resolve(process.cwd())];
  await writeRoots(defaultRoots);
  return defaultRoots;
};

export const writeRoots = async (roots: string[]) => {
  await ensureDataDirectory();

  const normalizedRoots = normalizeRoots(roots);
  await fs.writeFile(rootsFilePath, JSON.stringify({ roots: normalizedRoots }, null, 2), "utf8");
  writeLog("store", `Saved ${normalizedRoots.length} scan root(s)`);

  return normalizedRoots;
};
