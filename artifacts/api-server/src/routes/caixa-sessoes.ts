import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, caixaSessoesTable, caixaTable } from "@workspace/db";

const router: IRouter = Router();

const TZ = "America/Sao_Paulo";

/** Converte valor monetário em texto (pt-BR) para número. */
function parseValor(raw: string): number {
  let s = String(raw).replace(/[^\d.,-]/g, "");
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/** Formata número como texto pt-BR "1.234,56". */
function formatValor(n: number): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Data de "hoje" no fuso de São Paulo (YYYY-MM-DD), independente do fuso do servidor/dispositivo. */
function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
  }).format(new Date());
}

/** Soma entradas e saídas do caixa para um dia (no fuso de São Paulo). */
async function totaisDoDia(
  data: string,
): Promise<{ totalEntradas: number; totalSaidas: number }> {
  const rows = await db
    .select({ tipo: caixaTable.tipo, valor: caixaTable.valor })
    .from(caixaTable)
    .where(
      sql`(${caixaTable.createdAt} AT TIME ZONE ${TZ})::date = ${data}::date`,
    );
  let totalEntradas = 0;
  let totalSaidas = 0;
  for (const r of rows) {
    const n = parseValor(r.valor);
    if (r.tipo === "entrada") totalEntradas += n;
    else totalSaidas += n;
  }
  return { totalEntradas, totalSaidas };
}

/** Sessão do dia + totais ao vivo. */
router.get("/caixa-sessoes", async (req, res): Promise<void> => {
  const raw = String(req.query.data ?? "").trim();
  const data = DATA_RE.test(raw) ? raw : hojeSP();
  const [sessao] = await db
    .select()
    .from(caixaSessoesTable)
    .where(eq(caixaSessoesTable.data, data));
  const { totalEntradas, totalSaidas } = await totaisDoDia(data);
  res.json({
    sessao: sessao ?? null,
    totalEntradas,
    totalSaidas,
    saldo: totalEntradas - totalSaidas,
  });
});

/** Histórico de fechamentos (mais recentes primeiro). */
router.get("/caixa-sessoes/historico", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(caixaSessoesTable)
    .orderBy(sql`${caixaSessoesTable.data} desc`);
  res.json(rows);
});

/** Abrir o caixa do dia com o valor inicial (troco). */
router.post("/caixa-sessoes/abrir", async (req, res): Promise<void> => {
  const data = hojeSP();
  const valorInicial = String(req.body?.valorInicial ?? "").trim();
  if (!valorInicial) {
    res.status(400).json({ error: "valorInicial é obrigatório" });
    return;
  }
  const [existente] = await db
    .select()
    .from(caixaSessoesTable)
    .where(eq(caixaSessoesTable.data, data));
  if (existente) {
    res.status(409).json({ error: "O caixa de hoje já foi aberto" });
    return;
  }
  const [sessao] = await db
    .insert(caixaSessoesTable)
    .values({ data, status: "aberto", valorInicial })
    .returning();
  res.status(201).json(sessao);
});

/** Fechar o caixa do dia: calcula totais e o valor final. */
router.post("/caixa-sessoes/fechar", async (_req, res): Promise<void> => {
  const data = hojeSP();
  const [sessao] = await db
    .select()
    .from(caixaSessoesTable)
    .where(eq(caixaSessoesTable.data, data));
  if (!sessao) {
    res.status(404).json({ error: "O caixa de hoje ainda não foi aberto" });
    return;
  }
  if (sessao.status === "fechado") {
    res.status(409).json({ error: "O caixa de hoje já foi fechado" });
    return;
  }
  const { totalEntradas, totalSaidas } = await totaisDoDia(data);
  const valorInicial = parseValor(sessao.valorInicial);
  const valorFinal = valorInicial + totalEntradas - totalSaidas;
  const [atualizada] = await db
    .update(caixaSessoesTable)
    .set({
      status: "fechado",
      fechamentoAt: new Date(),
      totalEntradas: formatValor(totalEntradas),
      totalSaidas: formatValor(totalSaidas),
      valorFinal: formatValor(valorFinal),
    })
    .where(eq(caixaSessoesTable.id, sessao.id))
    .returning();
  res.json(atualizada);
});

export default router;
