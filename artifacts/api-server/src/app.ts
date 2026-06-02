import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// In standalone/production hosting (single service) the API server also serves
// the built frontend so the whole app lives on one origin. When the static
// build is absent (e.g. local dev where Vite serves the frontend separately),
// this block is skipped automatically.
const frontendDist =
  process.env.FRONTEND_DIST ?? path.join(import.meta.dirname, "public");

if (fs.existsSync(path.join(frontendDist, "index.html"))) {
  logger.info({ frontendDist }, "Serving frontend from static build");
  app.use(express.static(frontendDist));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

export default app;
