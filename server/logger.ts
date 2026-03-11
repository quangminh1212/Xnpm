import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const logDirectory = path.join(process.cwd(), "logs");
const logFilePath = path.join(logDirectory, "xnpm-dev.log");

const ensureLogFile = () => {
  if (!existsSync(logDirectory)) {
    mkdirSync(logDirectory, { recursive: true });
  }
};

export const getLogFilePath = () => {
  ensureLogFile();
  return logFilePath;
};

export const writeLog = (scope: string, message: string) => {
  ensureLogFile();
  appendFileSync(logFilePath, `[${new Date().toISOString()}] [${scope}] ${message}\n`, "utf8");
};
