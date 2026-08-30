import { Router, type IRouter } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  encomendasTable,
  encomendaItensTable,
  pedidosTable,
} from "@workspace/db";
import { ai } from "@workspace/integrations-gemini-ai";
import { batchProcess } from "@workspace/integrations-gemini-ai/batch";

const router: IRouter = Router();

type HttpError = Error & { status?: number };
function httpError(status: number, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.status = status;
  return error;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type PedidoInput = {
  modelo: string;
  quantidade: number;
  setor: string | null;
  qualidade: string;
  observacao: string;
};

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function parsePedidoInput(raw: unknown): PedidoInput {
  const body = (raw ?? {}) as Record<string, unknown>;
  const setorRaw = String(body.setor ?? "").trim().toLowerCase();
  return {
    modelo: String(body.modelo ?? "").trim().replace(/\s+/g, " "),
    quantidade: parseInt(String(body.quantidade ?? "0"), 10) || 0,
    setor: setorRaw === "cliente" || setorRaw === "lojista" ? setorRaw : null,
    qualidade: String(body.qualidade ?? "").trim(),
    observacao: String(body.observacao ?? "").trim(),
  };
}

function validatePedido(input: PedidoInput): void {
  if (!input.modelo) throw httpError(400, "Informe o modelo ou descrição da peça.");
  if (input.quantidade < 1) throw httpError(400, "A quantidade deve ser maior que zero.");
}

function samePedido(a: PedidoInput, b: PedidoInput): boolean {
  return (
    normalizeText(a.modelo) === normalizeText(b.modelo) &&
    (a.setor ?? "") === (b.setor ?? "") &&
    normalizeText(a.qualidade) === normalizeText(b.qualidade)
  );
}

async function mergeOrInsertPedido(
  tx: Tx,
  input: PedidoInput,
  excludeId?: number,
): Promise<typeof pedidosTable.$inferSelect> {
  // Serializa apenas a mesma chave para que dois registros iguais não sejam
  // criados por cliques/áudios simultâneos.
  const lockKey = `${normalizeText(input.modelo)}|${input.setor ?? ""}|${normalizeText(input.qualidade)}`;
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtext('pedido_item'), hashtext(${lockKey}))
  `);

  const pendentes = await tx
    .select()
    .from(pedidosTable)
    .where(eq(pedidosTable.status, "pendente"));
  const existente = pendentes.find(
    (item) =>
      item.id !== excludeId &&
      samePedido(input, {
        modelo: item.modelo,
        quantidade: item.quantidade,
        setor: item.setor,
        qualidade: item.qualidade,
        observacao: item.observacao,
      }),
  );

  if (existente) {
    const [atualizado] = await tx
      .update(pedidosTable)
      .set({
        quantidade: existente.quantidade + input.quantidade,
        observacao: input.observacao || existente.observacao,
        updatedAt: new Date(),
      })
      .where(eq(pedidosTable.id, existente.id))
      .returning();
    return atualizado;
  }

  const [criado] = await tx
    .insert(pedidosTable)
    .values({
      modelo: input.modelo,
      quantidade: input.quantidade,
      setor: input.setor,
      qualidade: input.qualidade,
      observacao: input.observacao,
      status: "pendente",
    })
    .returning();
  return criado;
}

// ── GET /pedidos ───────────────────────────────────────────────────────────
router.get("/pedidos", async (req, res): Promise<void> => {
  const status = String(req.query.status ?? "pendente");
  const where =
    status === "todos"
      ? undefined
      : eq(pedidosTable.status, status === "comprado" ? "comprado" : "pendente");
  const itens = await db
    .select()
    .from(pedidosTable)
    .where(where)
    .orderBy(sql`${pedidosTable.status} asc, ${pedidosTable.createdAt} desc`);
  res.json({ itens });
});

// ── POST /pedidos ──────────────────────────────────────────────────────────
router.post("/pedidos", async (req, res): Promise<void> => {
  try {
    const input = parsePedidoInput(req.body);
    validatePedido(input);
    const item = await db.transaction((tx) => mergeOrInsertPedido(tx, input));
    res.status(201).json(item);
  } catch (error) {
    const err = error as HttpError;
    if (!err.status) req.log.error({ err }, "criar pedido falhou");
    res.status(err.status ?? 500).json({ error: err.message || "Falha ao criar pedido" });
  }
});

// ── PATCH /pedidos/:id ─────────────────────────────────────────────────────
router.patch("/pedidos/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  try {
    const input = parsePedidoInput(req.body);
    validatePedido(input);
    const item = await db.transaction(async (tx) => {
      const [atual] = await tx
        .select()
        .from(pedidosTable)
        .where(eq(pedidosTable.id, id));
      if (!atual) throw httpError(404, "Pedido não encontrado");
      if (atual.status !== "pendente") {
        throw httpError(409, "Itens já marcados como comprados não podem ser editados.");
      }

      const pendentes = await tx
        .select()
        .from(pedidosTable)
        .where(eq(pedidosTable.status, "pendente"));
      const duplicado = pendentes.find(
        (candidate) =>
          candidate.id !== id &&
          samePedido(input, {
            modelo: candidate.modelo,
            quantidade: candidate.quantidade,
            setor: candidate.setor,
            qualidade: candidate.qualidade,
            observacao: candidate.observacao,
          }),
      );
      if (duplicado) {
        const [merged] = await tx
          .update(pedidosTable)
          .set({
            quantidade: duplicado.quantidade + input.quantidade,
            observacao: input.observacao || duplicado.observacao,
            updatedAt: new Date(),
          })
          .where(eq(pedidosTable.id, duplicado.id))
          .returning();
        await tx.delete(pedidosTable).where(eq(pedidosTable.id, id));
        return merged;
      }

      const [updated] = await tx
        .update(pedidosTable)
        .set({
          modelo: input.modelo,
          quantidade: input.quantidade,
          setor: input.setor,
          qualidade: input.qualidade,
          observacao: input.observacao,
          updatedAt: new Date(),
        })
        .where(eq(pedidosTable.id, id))
        .returning();
      return updated;
    });
    res.json(item);
  } catch (error) {
    const err = error as HttpError;
    if (!err.status) req.log.error({ err }, "editar pedido falhou");
    res.status(err.status ?? 500).json({ error: err.message || "Falha ao editar pedido" });
  }
});

// ── DELETE /pedidos/:id ────────────────────────────────────────────────────
router.delete("/pedidos/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  try {
    const [removed] = await db
      .delete(pedidosTable)
      .where(eq(pedidosTable.id, id))
      .returning({ id: pedidosTable.id });
    if (!removed) {
      res.status(404).json({ error: "Pedido não encontrado" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    req.log.error({ err: error }, "excluir pedido falhou");
    res.status(500).json({ error: "Falha ao excluir pedido" });
  }
});

// ── POST /pedidos/:id/status ───────────────────────────────────────────────
router.post("/pedidos/:id/status", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const status = String(req.body?.status ?? "").trim();
  if (!Number.isInteger(id) || id <= 0 || !["pendente", "comprado"].includes(status)) {
    res.status(400).json({ error: "Status ou ID inválido" });
    return;
  }
  const [updated] = await db
    .update(pedidosTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(pedidosTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Pedido não encontrado" });
    return;
  }
  res.json(updated);
});

// ── POST /pedidos/audio ────────────────────────────────────────────────────
// Interpreta o áudio, mas não grava nada. A tela confirma os itens chamando
// POST /pedidos depois de permitir a correção da prévia.
router.post("/pedidos/audio", async (req, res): Promise<void> => {
  const rawAudio = String(req.body?.audioBase64 ?? "").replace(/^data:[^;]+;base64,/, "");
  const mimeType = String(req.body?.mimeType ?? "audio/webm").split(";")[0];
  const allowed = ["audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/ogg"];
  if (!rawAudio) {
    res.status(400).json({ error: "Envie um áudio para interpretar." });
    return;
  }
  if (!allowed.includes(mimeType)) {
    res.status(400).json({ error: "Formato de áudio não suportado neste dispositivo." });
    return;
  }
  const approxBytes = Math.floor((rawAudio.length * 3) / 4);
  if (approxBytes > 7.5 * 1024 * 1024) {
    res.status(413).json({ error: "Áudio muito grande. Grave um áudio mais curto." });
    return;
  }

  const prompt = [
    "Você é um assistente de estoque de uma assistência técnica de celulares no Brasil.",
    "Ouça o áudio e extraia somente as peças que a pessoa quer colocar em uma lista de compras.",
    "Entenda frases como: 'Adicionado 2 telas do A15, 2 telas do A16, 3 telas do G24 e 1 plaquinha de carga do M23 5G'.",
    "Para cada item, retorne um modelo/descrição curto e limpo, começando pelo tipo da peça em MAIÚSCULAS quando ele for falado.",
    "Converta números por extenso para números inteiros. Não invente modelos, qualidades ou quantidades.",
    "Se setor ou qualidade não forem falados, deixe como string vazia.",
    "Retorne APENAS JSON válido, sem markdown, no formato:",
    '{ "transcricao": "resumo do que foi entendido", "itens": [ { "modelo": "TELA A15", "quantidade": 2, "setor": "", "qualidade": "", "observacao": "" } ] }',
  ].join("\n");

  try {
    const [response] = await batchProcess(
      [rawAudio],
      (audioChunk) =>
        ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{
            role: "user",
            parts: [
              { inlineData: { mimeType, data: audioChunk } },
              { text: prompt },
            ],
          }],
          config: { responseMimeType: "application/json", maxOutputTokens: 8192 },
        }),
      { concurrency: 1, retries: 3, minTimeout: 1000, maxTimeout: 8000 },
    );
    const text = response.text ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      res.status(502).json({ error: "Não consegui entender o áudio. Tente falar mais devagar." });
      return;
    }
    const body = (parsed ?? {}) as Record<string, unknown>;
    const rawItems = Array.isArray(body.itens) ? body.itens : [];
    const itens = rawItems
      .map((item) => parsePedidoInput(item))
      .filter((item) => item.modelo && item.quantidade > 0);
    res.json({ transcricao: String(body.transcricao ?? "").trim(), itens });
  } catch (error) {
    req.log.error({ err: error }, "interpretar áudio dos pedidos falhou");
    res.status(500).json({ error: "Não consegui interpretar o áudio agora. Tente novamente." });
  }
});

// ── POST /pedidos/convert-encomenda ────────────────────────────────────────
router.post("/pedidos/convert-encomenda", async (req, res): Promise<void> => {
  const fornecedor = String(req.body?.fornecedor ?? "").trim();
  const formaInvestimento =
    String(req.body?.formaInvestimento ?? "").toLowerCase() === "pix" ? "pix" : "dinheiro";
  const rawItems = Array.isArray(req.body?.itens) ? req.body.itens : [];
  const ids = rawItems.map((item: unknown) => parseInt(String((item as Record<string, unknown>)?.id ?? "0"), 10)).filter((id: number) => id > 0);
  if (!fornecedor) {
    res.status(400).json({ error: "Fornecedor é obrigatório." });
    return;
  }
  if (!ids.length || new Set(ids).size !== ids.length) {
    res.status(400).json({ error: "Selecione ao menos um item único." });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const pedidos = await tx
        .select()
        .from(pedidosTable)
        .where(and(inArray(pedidosTable.id, ids), eq(pedidosTable.status, "pendente")));
      if (pedidos.length !== ids.length) {
        throw httpError(409, "Algum item não está mais pendente.");
      }
      const byId = new Map(pedidos.map((item) => [item.id, item]));
      const itens = rawItems.map((raw: unknown) => {
        const body = (raw ?? {}) as Record<string, unknown>;
        const pedido = byId.get(Number(body.id));
        if (!pedido) throw httpError(409, "Item de pedido inválido.");
        const valorCusto = String(body.valorCusto ?? "").trim();
        const valorCliente = String(body.valorCliente ?? "").trim();
        const valorLojista = String(body.valorLojista ?? "").trim();
        if (!valorCliente || !valorLojista) {
          throw httpError(400, `Preencha os dois preços de ${pedido.modelo}.`);
        }
        return {
          pedidoId: pedido.id,
          modelo: pedido.modelo,
          qualidade: pedido.qualidade || "Não informada",
          quantidade: pedido.quantidade,
          valorCusto,
          valorCliente,
          valorLojista,
        };
      });
      const [encomenda] = await tx
        .insert(encomendasTable)
        .values({ fornecedor, formaInvestimento })
        .returning();
      await tx.insert(encomendaItensTable).values(
        itens.map((item) => ({
          encomendaId: encomenda.id,
          modelo: item.modelo,
          qualidade: item.qualidade,
          quantidade: item.quantidade,
          valorCusto: item.valorCusto,
          valorCliente: item.valorCliente,
          valorLojista: item.valorLojista,
        })),
      );
      await tx
        .update(pedidosTable)
        .set({ status: "comprado", updatedAt: new Date() })
        .where(inArray(pedidosTable.id, ids));
      return { encomenda, itens };
    });
    res.status(201).json(result);
  } catch (error) {
    const err = error as HttpError;
    if (!err.status) req.log.error({ err }, "converter pedidos em encomenda falhou");
    res.status(err.status ?? 500).json({ error: err.message || "Falha ao criar encomenda" });
  }
});

export default router;