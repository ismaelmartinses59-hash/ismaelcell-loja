import { Router, type IRouter, type Response } from "express";
import { eq, ilike, or, sql, and, isNotNull, ne } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import {
  ListOrdersQueryParams,
  ListOrdersResponse,
  CreateOrderBody,
  GetOrderParams,
  GetOrderResponse,
  UpdateOrderStatusParams,
  UpdateOrderStatusBody,
  UpdateOrderStatusResponse,
  GetOrderStatsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const BLOQUEIO_GARANTIA_MS = 60 * 60 * 1000;

/** Reduz variações como "Redmi A5", "redmi a5" e "Redmi a 5" à mesma chave. */
function chaveModeloGarantia(modelo: string): string {
  return modelo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function temGarantiaAtiva(garantia: string | null | undefined): boolean {
  return !!garantia && garantia !== "Sem garantia" && garantia !== "0 dias";
}

/** Busca uma garantia ativa recém-criada para o mesmo aparelho. */
async function buscarGarantiaRecente(modelo: string, ignorarId?: number) {
  const candidatas = await db
    .select()
    .from(ordersTable)
    .where(and(
      sql`${ordersTable.createdAt} >= now() - INTERVAL '60 minutes'`,
      isNotNull(ordersTable.garantia),
      ne(ordersTable.garantia, ""),
      ne(ordersTable.garantia, "Sem garantia"),
      ne(ordersTable.garantia, "0 dias"),
    ));

  const chave = chaveModeloGarantia(modelo);
  return candidatas.find((ordem) =>
    ordem.id !== ignorarId && chaveModeloGarantia(ordem.modelo) === chave,
  ) ?? null;
}

function erroGarantiaDuplicada(
  res: Response,
  ordem: { modelo: string; createdAt: Date },
): void {
  const expiraEm = new Date(ordem.createdAt.getTime() + BLOQUEIO_GARANTIA_MS);
  const minutosRestantes = Math.max(1, Math.ceil((expiraEm.getTime() - Date.now()) / 60_000));
  res.status(409).json({
    error: `Já existe uma garantia para ${ordem.modelo} criada há menos de 60 minutos. Tente novamente em ${minutosRestantes} min.`,
    retryAt: expiraEm.toISOString(),
  });
}

router.get("/orders/stats", async (req, res): Promise<void> => {
  const tipo = req.query.tipo as string | undefined;

  let statsQuery = db
    .select({
      status: ordersTable.status,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(ordersTable)
    .$dynamic();

  if (tipo === "cliente" || tipo === "lojista") {
    statsQuery = statsQuery.where(eq(ordersTable.tipo, tipo));
  }

  const rows = await statsQuery.groupBy(ordersTable.status);

  const stats = {
    total: 0,
    aguardando: 0,
    emAndamento: 0,
    concluido: 0,
    problema: 0,
    encerrado: 0,
    comGarantia: 0,
  };

  for (const row of rows) {
    if (row.status === "encerrado") {
      stats.encerrado = row.count;
    } else {
      stats.total += row.count;
      if (row.status === "aguardando") stats.aguardando = row.count;
      else if (row.status === "em andamento") stats.emAndamento = row.count;
      else if (row.status === "concluido") stats.concluido = row.count;
      else if (row.status === "problema") stats.problema = row.count;
    }
  }

  // Count orders with an active warranty (non-null, non-empty, not "Sem garantia")
  let garantiaQuery = db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(ordersTable)
    .where(and(
      isNotNull(ordersTable.garantia),
      ne(ordersTable.garantia, ""),
      ne(ordersTable.garantia, "Sem garantia"),
    ))
    .$dynamic();

  if (tipo === "cliente" || tipo === "lojista") {
    garantiaQuery = garantiaQuery.where(and(
      eq(ordersTable.tipo, tipo),
      isNotNull(ordersTable.garantia),
      ne(ordersTable.garantia, ""),
      ne(ordersTable.garantia, "Sem garantia"),
    ));
  }

  const [garantiaRow] = await garantiaQuery;
  stats.comGarantia = garantiaRow?.count ?? 0;

  res.json(GetOrderStatsResponse.parse(stats));
});

router.get("/orders", async (req, res): Promise<void> => {
  const query = ListOrdersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { search, status } = query.data;

  let dbQuery = db.select().from(ordersTable).$dynamic();

  const conditions = [];

  if (search) {
    conditions.push(
      or(
        ilike(ordersTable.modelo, `%${search}%`),
        ilike(ordersTable.servico, `%${search}%`),
        ilike(ordersTable.linha, `%${search}%`),
        ilike(ordersTable.codigo, `%${search}%`),
        ilike(ordersTable.nomeCliente, `%${search}%`),
      ),
    );
  }

  if (status) {
    conditions.push(eq(ordersTable.status, status));
  }

  if (query.data.tipo) {
    conditions.push(eq(ordersTable.tipo, query.data.tipo));
  }

  if (conditions.length > 0) {
    dbQuery = dbQuery.where(and(...conditions));
  }

  const orders = await dbQuery.orderBy(sql`${ordersTable.createdAt} desc`);
  res.json(ListOrdersResponse.parse(orders));
});

router.post("/orders", async (req, res): Promise<void> => {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (temGarantiaAtiva(parsed.data.garantia)) {
    const garantiaRecente = await buscarGarantiaRecente(parsed.data.modelo);
    if (garantiaRecente) {
      erroGarantiaDuplicada(res, garantiaRecente);
      return;
    }
  }

  const codigo = "OS-" + Date.now();

  const [order] = await db
    .insert(ordersTable)
    .values({
      ...parsed.data,
      codigo,
      status: "aguardando",
      tipo: parsed.data.tipo ?? "lojista",
      nomeCliente: parsed.data.nomeCliente ?? null,
      senhaDispo: parsed.data.senhaDispo ?? null,
      garantia: parsed.data.garantia ?? null,
      dataServico: parsed.data.dataServico ?? null,
    })
    .returning();

  res.status(201).json(GetOrderResponse.parse(order));
});

router.get("/orders/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const params = GetOrderParams.safeParse({ id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, params.data.id));

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  res.json(GetOrderResponse.parse(order));
});

router.patch("/orders/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const params = UpdateOrderStatusParams.safeParse({ id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateOrderStatusBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const hoje = new Date().toISOString().split("T")[0];

  const [order] = await db
    .update(ordersTable)
    .set({
      status: body.data.status,
      dataConclusao: body.data.status === "concluido" ? new Date() : null,
      ...(body.data.status === "em andamento" ? { dataServico: hoje } : {}),
    })
    .where(eq(ordersTable.id, params.data.id))
    .returning();

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  res.json(UpdateOrderStatusResponse.parse(order));
});

router.put("/orders/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const body = CreateOrderBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [ordemAtual] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, id));

  if (!ordemAtual) {
    res.status(404).json({ error: "Ordem não encontrada" });
    return;
  }

  // Só bloqueia quando esta ação está criando uma garantia nova. Alterar o
  // período de uma garantia já existente continua permitido.
  const criandoGarantia = !temGarantiaAtiva(ordemAtual.garantia)
    && temGarantiaAtiva(body.data.garantia);
  if (criandoGarantia) {
    const garantiaRecente = await buscarGarantiaRecente(body.data.modelo, id);
    if (garantiaRecente) {
      erroGarantiaDuplicada(res, garantiaRecente);
      return;
    }
  }

  const [order] = await db
    .update(ordersTable)
    .set({
      modelo: body.data.modelo,
      linha: body.data.linha,
      servico: body.data.servico,
      valor: body.data.valor,
      tempo: body.data.tempo,
      nomeCliente: body.data.nomeCliente ?? null,
      senhaDispo: body.data.senhaDispo ?? null,
      garantia: body.data.garantia ?? null,
      dataServico: body.data.dataServico ?? null,
    })
    .where(eq(ordersTable.id, id))
    .returning();

  if (!order) {
    res.status(404).json({ error: "Ordem não encontrada" });
    return;
  }

  res.json(GetOrderResponse.parse(order));
});

router.post("/orders/:id/reactivate", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const novoCodigo = "OS-" + Date.now();

  const [order] = await db
    .update(ordersTable)
    .set({ status: "aguardando", codigo: novoCodigo })
    .where(eq(ordersTable.id, id))
    .returning();

  if (!order) {
    res.status(404).json({ error: "Ordem não encontrada" });
    return;
  }

  res.json(order);
});

router.delete("/orders/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [deleted] = await db
    .delete(ordersTable)
    .where(eq(ordersTable.id, id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Ordem não encontrada" });
    return;
  }

  res.status(204).send();
});

export default router;
