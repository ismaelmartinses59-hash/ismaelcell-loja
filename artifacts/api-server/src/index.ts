import app from "./app";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function ensureSchema(): Promise<void> {
  try {
    await db.execute(
      sql`ALTER TABLE pecas ADD COLUMN IF NOT EXISTS valor_custo text NOT NULL DEFAULT ''`,
    );
    logger.info("Schema check ok");
  } catch (err) {
    logger.error({ err }, "Schema check failed");
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

ensureSchema().finally(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
});
