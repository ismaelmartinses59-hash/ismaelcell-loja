import cron from "node-cron";
import { eq } from "drizzle-orm";
import { db, caixaSessoesTable } from "@workspace/db";
import { logger } from "./logger.js";
import { sendToAll } from "./push.js";

const TZ = "America/Sao_Paulo";

/** Data de "hoje" no fuso de São Paulo (YYYY-MM-DD). */
function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

async function sessaoDeHoje() {
  const data = hojeSP();
  const [s] = await db
    .select()
    .from(caixaSessoesTable)
    .where(eq(caixaSessoesTable.data, data));
  return s ?? null;
}

/** Lembrete de ABRIR: pula se o caixa de hoje já foi aberto. */
async function lembrarAbrir(): Promise<void> {
  try {
    const s = await sessaoDeHoje();
    if (s) {
      logger.info("abrir reminder skipped (já aberto)");
      return;
    }
    const r = await sendToAll({
      title: "Abrir o caixa ☀️",
      body: "Bom dia! Lembre de abrir o caixa e registrar o troco inicial.",
      tag: "abrir-caixa",
      url: "/",
    });
    logger.info({ ...r }, "abrir reminder sent");
  } catch (err) {
    logger.error({ err }, "lembrarAbrir failed");
  }
}

/** Lembrete de FECHAR: pula se o caixa de hoje já foi fechado. */
async function lembrarFechar(): Promise<void> {
  try {
    const s = await sessaoDeHoje();
    if (s && s.status === "fechado") {
      logger.info("fechar reminder skipped (já fechado)");
      return;
    }
    const r = await sendToAll({
      title: "Fechar o caixa 🌙",
      body: "Hora de fechar o caixa! Confira o dinheiro na gaveta e finalize o dia.",
      tag: "fechar-caixa",
      url: "ordens?caixa=fechar",
    });
    logger.info({ ...r }, "fechar reminder sent");
  } catch (err) {
    logger.error({ err }, "lembrarFechar failed");
  }
}

/**
 * Agenda os lembretes de caixa no fuso de São Paulo, espelhando as regras do
 * overlay bloqueante:
 *  - Abrir: 8h, segunda a sábado.
 *  - Fechar: 19h de segunda a sexta; 15h no sábado.
 *  - Domingo: sem lembretes.
 */
export function agendarNotificacoesCaixa(): void {
  const opts = { timezone: TZ };
  cron.schedule("0 8 * * 1-6", lembrarAbrir, opts);
  cron.schedule("0 19 * * 1-5", lembrarFechar, opts);
  cron.schedule("0 15 * * 6", lembrarFechar, opts);
  logger.info("Caixa notification schedules registered (America/Sao_Paulo)");
}
