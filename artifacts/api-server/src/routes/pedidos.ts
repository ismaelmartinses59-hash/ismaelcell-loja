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

const MAX_PEDIDO_QUANTIDADE = 10_000;
const AUDIO_WINDOW_MS = 60_000;
const AUDIO_MAX_REQUESTS_PER_WINDOW = 5;
const audioRequestsByIp = new Map<string, { count: number; resetAt: number }>();

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function pedidoLockKey(input: PedidoInput): string {
  return `${normalizeText(input.modelo)}|${input.setor ?? ""}|${normalizeText(input.qualidade)}`;
}

async function lockPedidoKey(tx: Tx, input: PedidoInput): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtext('pedido_item'), hashtext(${pedidoLockKey(input)}))
  `);
}

async function lockPedidoIds(tx: Tx, ids: number[]): Promise<void> {
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtext('pedido_row'), ${id})
    `);
  }
}

function parsePedidoInput(raw: unknown): PedidoInput {
  const body = (raw ?? {}) as Record<string, unknown>;
  const setorRaw = String(body.setor ?? "").trim().toLowerCase();
  const quantidade = Number(body.quantidade);
  return {
    modelo: String(body.modelo ?? "").trim().replace(/\s+/g, " "),
    quantidade,
    setor: setorRaw === "cliente" || setorRaw === "lojista" ? setorRaw : null,
    qualidade: String(body.qualidade ?? "").trim(),
    observacao: String(body.observacao ?? "").trim(),
  };
}

function validatePedido(input: PedidoInput): void {
  if (!input.modelo) throw httpError(400, "Informe o modelo ou descrição da peça.");
  if (input.modelo.length > 160) throw httpError(400, "O modelo deve ter no máximo 160 caracteres.");
  if (!Number.isSafeInteger(input.quantidade) || input.quantidade < 1 || input.quantidade > MAX_PEDIDO_QUANTIDADE) {
    throw httpError(400, `A quantidade deve ser um inteiro entre 1 e ${MAX_PEDIDO_QUANTIDADE}.`);
  }
  if (input.qualidade.length > 80) throw httpError(400, "A qualidade deve ter no máximo 80 caracteres.");
  if (input.observacao.length > 500) throw httpError(400, "A observação deve ter no máximo 500 caracteres.");
}

function isValidMoneyText(value: string): boolean {
  if (!value || value.length > 30) return false;
  const compact = value.replace(/[R$\s]/gi, "");
  const normalized =
    compact.includes(",")
      ? compact.replace(/\./g, "").replace(",", ".")
      : compact;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0;
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
  await lockPedidoKey(tx, input);

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
      await lockPedidoKey(tx, input);
      await lockPedidoIds(tx, [id]);
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
    const removed = await db.transaction(async (tx) => {
      await lockPedidoIds(tx, [id]);
      const [item] = await tx
        .delete(pedidosTable)
        .where(eq(pedidosTable.id, id))
        .returning({ id: pedidosTable.id });
      return item;
    });
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
  const updated = await db.transaction(async (tx) => {
    await lockPedidoIds(tx, [id]);
    const [item] = await tx
      .select()
      .from(pedidosTable)
      .where(eq(pedidosTable.id, id));
    if (!item) return undefined;

    if (status === "pendente" && item.status !== "pendente") {
      const input: PedidoInput = {
        modelo: item.modelo,
        quantidade: item.quantidade,
        setor: item.setor,
        qualidade: item.qualidade,
        observacao: item.observacao,
      };
      await lockPedidoKey(tx, input);
      const pendentes = await tx
        .select()
        .from(pedidosTable)
        .where(eq(pedidosTable.status, "pendente"));
      const duplicado = pendentes.find((candidate) =>
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
            quantidade: duplicado.quantidade + item.quantidade,
            observacao: item.observacao || duplicado.observacao,
            updatedAt: new Date(),
          })
          .where(eq(pedidosTable.id, duplicado.id))
          .returning();
        await tx.delete(pedidosTable).where(eq(pedidosTable.id, id));
        return merged;
      }
    }

    const [changed] = await tx
      .update(pedidosTable)
      .set({ status, updatedAt: new Date() })
      .where(eq(pedidosTable.id, id))
      .returning();
    return changed;
  });
  if (!updated) {
    res.status(404).json({ error: "Pedido não encontrado" });
    return;
  }
  res.json(updated);
});

// ── POST /pedidos/batch ────────────────────────────────────────────────────
// Salva toda a prévia do áudio de forma atômica: ou todos os itens entram, ou
// nenhum entra. Itens repetidos continuam sendo somados.
router.post("/pedidos/batch", async (req, res): Promise<void> => {
  try {
    const rawItems = Array.isArray(req.body?.itens) ? req.body.itens : [];
    if (!rawItems.length || rawItems.length > 100) {
      throw httpError(400, "Envie entre 1 e 100 itens.");
    }
    const inputs = rawItems.map(parsePedidoInput);
    inputs.forEach(validatePedido);
    const ordered = [...inputs].sort((a, b) => pedidoLockKey(a).localeCompare(pedidoLockKey(b)));
    const itens = await db.transaction(async (tx) => {
      const saved: Array<typeof pedidosTable.$inferSelect> = [];
      for (const input of ordered) {
        saved.push(await mergeOrInsertPedido(tx, input));
      }
      return saved;
    });
    res.status(201).json({ itens });
  } catch (error) {
    const err = error as HttpError;
    if (!err.status) req.log.error({ err }, "salvar pedidos em lote falhou");
    res.status(err.status ?? 500).json({ error: err.message || "Falha ao salvar pedidos" });
  }
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
  if (
    rawAudio.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(rawAudio)
  ) {
    res.status(400).json({ error: "O áudio enviado está corrompido." });
    return;
  }
  const decodedBytes = Buffer.from(rawAudio, "base64").byteLength;
  if (decodedBytes > 7.5 * 1024 * 1024) {
    res.status(413).json({ error: "Áudio muito grande. Grave um áudio mais curto." });
    return;
  }
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || "desconhecido";
  const current = audioRequestsByIp.get(ip);
  if (!current || current.resetAt <= now) {
    audioRequestsByIp.set(ip, { count: 1, resetAt: now + AUDIO_WINDOW_MS });
  } else if (current.count >= AUDIO_MAX_REQUESTS_PER_WINDOW) {
    res.setHeader("Retry-After", String(Math.ceil((current.resetAt - now) / 1000)));
    res.status(429).json({ error: "Muitos áudios em sequência. Aguarde um minuto e tente novamente." });
    return;
  } else {
    current.count += 1;
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
      await lockPedidoIds(tx, ids);
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
        if (
          !isValidMoneyText(valorCusto) ||
          !isValidMoneyText(valorCliente) ||
          !isValidMoneyText(valorLojista)
        ) {
          throw httpError(400, `Preencha custo e os dois preços válidos de ${pedido.modelo}.`);
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
      const claimed = await tx
        .update(pedidosTable)
        .set({ status: "comprado", updatedAt: new Date() })
        .where(and(inArray(pedidosTable.id, ids), eq(pedidosTable.status, "pendente")))
        .returning({ id: pedidosTable.id });
      if (claimed.length !== ids.length) {
        throw httpError(409, "Algum item foi alterado durante a conversão.");
      }
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