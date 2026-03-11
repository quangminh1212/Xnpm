import { existsSync } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { getCatalog, getPackageById, getSuggestedRoots } from "./catalog.js";
import { getLogFilePath, writeLog } from "./logger.js";
import { runAction } from "./process-runner.js";
import { readRoots, writeRoots } from "./store.js";

const rootSchema = z.object({
  roots: z.array(z.string().min(1)).min(1)
});

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("install") }),
  z.object({ type: z.literal("open-folder") }),
  z.object({ type: z.literal("script"), scriptName: z.string().min(1) })
]);

export const createServer = async () => {
  const server = Fastify({
    logger: false,
    routerOptions: {
      // Package IDs are base64url-encoded absolute paths and can easily exceed
      // the default router param limit on Windows when workspaces are nested deeply.
      maxParamLength: 512
    }
  });

  await server.register(cors, { origin: true });

  server.get("/api/roots", async () => {
    const roots = await readRoots();
    const suggestions = await getSuggestedRoots();

    return {
      roots,
      suggestions
    };
  });

  server.post("/api/roots", async (request, reply) => {
    const payload = rootSchema.parse(request.body);
    const verifiedRoots = payload.roots.filter((rootPath) => existsSync(rootPath));

    if (verifiedRoots.length === 0) {
      return reply.code(400).send({ message: "No valid directories were provided." });
    }

    const savedRoots = await writeRoots(verifiedRoots);
    return { roots: savedRoots };
  });

  server.get("/api/packages", async (request) => {
    const roots = await readRoots();
    const forceRefresh = String((request.query as { refresh?: string }).refresh ?? "") === "1";
    const packages = await getCatalog(roots, forceRefresh);

    return {
      roots,
      packages
    };
  });

  server.get("/api/packages/:packageId", async (request, reply) => {
    const roots = await readRoots();
    const packageDetail = await getPackageById((request.params as { packageId: string }).packageId, roots);

    if (!packageDetail) {
      return reply.code(404).send({ message: "Package not found." });
    }

    return {
      package: packageDetail
    };
  });

  server.post("/api/packages/:packageId/actions", async (request, reply) => {
    const payload = actionSchema.parse(request.body);
    const roots = await readRoots();
    const packageDetail = await getPackageById((request.params as { packageId: string }).packageId, roots);

    if (!packageDetail) {
      return reply.code(404).send({ message: "Package not found." });
    }

    const result = await runAction(packageDetail, payload);

    return {
      packageId: packageDetail.id,
      packageName: packageDetail.name,
      result
    };
  });

  server.get("/api/meta", async () => {
    const roots = await readRoots();
    const packages = await getCatalog(roots);

    return {
      application: "Xnpm",
      logFilePath: getLogFilePath(),
      stats: {
        packageCount: packages.length,
        healthyCount: packages.filter((entry) => entry.status === "healthy").length,
        attentionCount: packages.filter((entry) => entry.status === "attention").length,
        minimalCount: packages.filter((entry) => entry.status === "minimal").length
      }
    };
  });

  const clientPath = path.join(process.cwd(), "dist", "client");
  if (existsSync(clientPath)) {
    await server.register(fastifyStatic, {
      root: clientPath
    });

    server.setNotFoundHandler((_, reply) => {
      reply.sendFile("index.html");
    });
  }

  writeLog("server", "Fastify application created");

  return server;
};
