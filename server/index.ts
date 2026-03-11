import { createServer } from "./app.js";
import { writeLog } from "./logger.js";

const bootstrap = async () => {
  const server = await createServer();
  const port = Number(process.env.PORT ?? 4173);
  const host = process.env.HOST ?? "127.0.0.1";

  try {
    await server.listen({ port, host });
    writeLog("server", `Listening on http://${host}:${port}`);
  } catch (error) {
    writeLog("server", `Fatal startup error: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
    throw error;
  }
};

void bootstrap();
