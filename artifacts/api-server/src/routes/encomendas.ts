import { Router, type IRouter } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  encomendasTable,
  encomendaItensTable,
  pecasTable,
  caixaTable,
} from "@workspace/db";

const router: IRouter = Router();

/** Converte texto monetário pt-BR ("400,00", "1.234,56", "75") em número. */
function parseValorBR(raw: unknown): number {
  let s = String(raw ?? "").replace(/[^\d.,-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
/** Número -> texto monetário pt-BR ("400,00"). */
function valorParaTexto(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

function formaInvest(raw: unknown): "dinheiro" | "pix" {
  return String(raw ?? "").toLowerCase() === "pix" ? "pix" : "dinheiro";
}

interface HttpError extends Error {
  status?: number;
}
function httpError(status: number, message: string): HttpError {
  const e = new Error(message) as HttpError;
  e.status = status;
  return e;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockEncomenda(tx: Tx, id: number): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtext('encomenda_row'), ${id})
  `);
}

// Soma `qtd` no estoque de um setor (cliente/lojista). Se já existir a peça
// (mesmo modelo ignorando maiúsc./espaços + qualidade + setor), incrementa; se
// não, cria. Mesma regra do cadastro/importação de peças (par cliente+lojista).
async function upsertEstoque(
  tx: Tx,
  setor: "cliente" | "lojista",
  modelo: string,
  qualidade: string,
  valor: string,
  valorCusto: string,
  qtd: number,
): Promise<void> {
  if (qtd <= 0) return;
  const estoqueKey = [
    setor,
    modelo.trim().toLowerCase().replace(/\s+/g, " "),
    qualidade.trim().toLowerCase().replace(/\s+/g, " "),
  ].join("|");
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtext('estoque_item'), hashtext(${estoqueKey}))
  `);
  const [existente] = await tx
    .select()
    .from(pecasTable)
    .where(
      and(
        sql`lower(trim(${pecasTable.modelo})) = ${modelo.toLowerCase().trim()}`,
        eq(pecasTable.qualidade, qualidade),
        eq(pecasTable.setor, setor),
      ),
    )
    .orderBy(pecasTable.id)
    .limit(1);
  if (existente) {
    await tx
      .update(pecasTable)
      .set({ quantidade: sql`${pecasTable.quantidade} + ${qtd}` })
      .where(eq(pecasTable.id, existente.id));
    return;
  }
  await tx.insert(pecasTable).values({
    modelo,
    qualidade,
    valor,
    valorCusto,
    quantidade: qtd,
    setor,
  });
}

// Deriva o status de um item a partir da quantidade recebida.
function statusItem(item: {
  quantidade: number;
  qtdRecebida: number;
  status: string;
}): string {
  if (item.status === "cancelado") return "cancelado";
  return item.qtdRecebida >= item.quantidade ? "recebido" : "aguardando";
}

// Recalcula (e persiste) o status da encomenda a partir dos itens.
async function recalcEncomenda(tx: Tx, encomendaId: number): Promise<string> {
  const itens = await tx
    .select()
    .from(encomendaItensTable)
    .where(eq(encomendaItensTable.encomendaId, encomendaId));
  const todosResolvidos =
    itens.length > 0 &&
    itens.every((i) => i.status === "recebido" || i.status === "cancelado");
  const status = todosResolvidos ? "recebida" : "aguardando";
  await tx
    .update(encomendasTable)
    .set({ status })
    .where(eq(encomendasTable.id, encomendaId));
  return status;
}

// ── GET /encomendas ────────────────────────────────────────────────────────
// Por padrão devolve as encomendas aguardando (as acionáveis). ?status=todas
// devolve o histórico completo. Sempre inclui o saldo "na mão do fornecedor".
router.get("/encomendas", async (req, res): Promise<void> => {
  const status = req.query.status as string | undefined;
  const cond =
    status === "todas" ? undefined : eq(encomendasTable.status, "aguardando");
  const encomendas = await db
    .select()
    .from(encomendasTable)
    .where(cond)
    .orderBy(sql`${encomendasTable.createdAt} desc`);

  const ids = encomendas.map((e) => e.id);
  const itens = ids.length
    ? await db
        .select()
        .from(encomendaItensTable)
        .where(inArray(encomendaItensTable.encomendaId, ids))
        .orderBy(encomendaItensTable.id)
    : [];

  const comItens = encomendas.map((e) => ({
    ...e,
    itens: itens.filter((i) => i.encomendaId === e.id),
  }));

  // Saldo "na mão do fornecedor": valor dos itens ainda NÃO recebidos (e não
  // cancelados) das encomendas aguardando — o que ele já pagou/pediu e ainda
  // vai receber em peças.
  const pendentes = await db
    .select({
      fornecedor: encomendasTable.fornecedor,
      quantidade: encomendaItensTable.quantidade,
      qtdRecebida: encomendaItensTable.qtdRecebida,
      valorCusto: encomendaItensTable.valorCusto,
    })
    .from(encomendaItensTable)
    .innerJoin(
      encomendasTable,
      eq(encomendaItensTable.encomendaId, encomendasTable.id),
    )
    .where(
      and(
        eq(encomendasTable.status, "aguardando"),
        eq(encomendaItensTable.status, "aguardando"),
      ),
    );

  const mapa = new Map<string, number>();
  for (const p of pendentes) {
    const falta = Math.max(0, p.quantidade - p.qtdRecebida);
    if (falta <= 0) continue;
    const v = parseValorBR(p.valorCusto) * falta;
    mapa.set(p.fornecedor, (mapa.get(p.fornecedor) ?? 0) + v);
  }
  const saldosPorFornecedor = [...mapa.entries()]
    .map(([fornecedor, total]) => ({ fornecedor, total }))
    .sort((a, b) => b.total - a.total);
  const saldoTotal = saldosPorFornecedor.reduce((s, x) => s + x.total, 0);

  res.json({ encomendas: comItens, saldosPorFornecedor, saldoTotal });
});

// ── POST /encomendas ───────────────────────────────────────────────────────
// Cria uma encomenda aguardando. NÃO mexe em estoque nem caixa (só quando a
// chegada for confirmada).
router.post("/encomendas", async (req, res): Promise<void> => {
  const fornecedor = String(req.body?.fornecedor ?? "").trim();
  const forma = formaInvest(req.body?.formaInvestimento);
  const itensRaw = (req.body?.itens ?? []) as unknown[];
  if (!fornecedor) {
    res.status(400).json({ error: "Fornecedor é obrigatório" });
    return;
  }
  if (!Array.isArray(itensRaw) || itensRaw.length === 0) {
    res.status(400).json({ error: "Nenhum item na encomenda" });
    return;
  }
  const itens = itensRaw.map((it) => {
    const o = (it ?? {}) as Record<string, unknown>;
    return {
      modelo: String(o.modelo ?? "").trim(),
      qualidade: String(o.qualidade ?? "").trim(),
      quantidade: parseInt(String(o.quantidade ?? "0"), 10) || 0,
      valorCusto: String(o.valorCusto ?? "").trim(),
      valorCliente: String(o.valorCliente ?? "").trim(),
      valorLojista: String(o.valorLojista ?? "").trim(),
    };
  });
  const invalido = itens.find(
    (n) =>
      !n.modelo ||
      !n.qualidade ||
      !n.valorCliente ||
      !n.valorLojista ||
      n.quantidade < 1,
  );
  if (invalido) {
    res.status(400).json({
      error:
        "Todos os itens precisam de modelo, qualidade, quantidade (mín. 1) e os dois preços",
    });
    return;
  }
  try {
    const enc = await db.transaction(async (tx) => {
      const [e] = await tx
        .insert(encomendasTable)
        .values({ fornecedor, formaInvestimento: forma })
        .returning();
      await tx.insert(encomendaItensTable).values(
        itens.map((n) => ({
          encomendaId: e.id,
          modelo: n.modelo,
          qualidade: n.qualidade,
          quantidade: n.quantidade,
          valorCusto: n.valorCusto,
          valorCliente: n.valorCliente,
          valorLojista: n.valorLojista,
        })),
      );
      return e;
    });
    res.status(201).json(enc);
  } catch (err) {
    req.log.error({ err }, "criar encomenda falhou");
    res.status(500).json({ error: "Falha ao criar encomenda (nada foi salvo)" });
  }
});

// ── POST /encomendas/:id/receber ───────────────────────────────────────────
// Confirma a chegada de (parte de) uma encomenda. Para cada item recebe uma
// quantidade `qtd` que entra no estoque (par cliente+lojista). Na PRIMEIRA
// confirmação lança a SAÍDA cheia no caixa (soma custo × qtd de todos os itens
// não-cancelados), datada no dia da compra (created_at da encomenda).
router.post("/encomendas/:id/receber", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const recebimentosRaw = (req.body?.recebimentos ?? []) as unknown[];
  const requestId = String(req.body?.requestId ?? "").trim();
  if (!Array.isArray(recebimentosRaw)) {
    res.status(400).json({ error: "recebimentos inválido" });
    return;
  }
  if (!requestId || requestId.length > 100 || !/^[A-Za-z0-9_-]+$/.test(requestId)) {
    res.status(400).json({ error: "Identificador da confirmação inválido" });
    return;
  }
  const recebimentos = recebimentosRaw.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      itemId: parseInt(String(o.itemId ?? "0"), 10) || 0,
      qtd: parseInt(String(o.qtd ?? "0"), 10) || 0,
    };
  });

  try {
    const processed = await db.transaction(async (tx) => {
      await lockEncomenda(tx, id);
      const [enc] = await tx
        .select()
        .from(encomendasTable)
        .where(eq(encomendasTable.id, id));
      if (!enc) throw httpError(404, "Encomenda não encontrada");
      if (enc.status === "cancelada")
        throw httpError(400, "Encomenda cancelada");

      const claim = await tx.execute(sql`
        INSERT INTO encomenda_recebimentos (encomenda_id, request_id)
        VALUES (${id}, ${requestId})
        ON CONFLICT (encomenda_id, request_id) DO NOTHING
        RETURNING id
      `);
      const claimed =
        ((claim as { rowCount?: number }).rowCount ?? 0) > 0 ||
        ((claim as { rows?: unknown[] }).rows?.length ?? 0) > 0;
      if (!claimed) return false;

      let recebeuAlgo = false;
      for (const rec of recebimentos) {
        if (rec.qtd <= 0) continue;
        const [item] = await tx
          .select()
          .from(encomendaItensTable)
          .where(
            and(
              eq(encomendaItensTable.id, rec.itemId),
              eq(encomendaItensTable.encomendaId, id),
            ),
          );
        if (!item || item.status === "cancelado") continue;
        const falta = item.quantidade - item.qtdRecebida;
        const add = Math.min(rec.qtd, Math.max(0, falta));
        if (add <= 0) continue;
        const novaQtd = item.qtdRecebida + add;
        await tx
          .update(encomendaItensTable)
          .set({
            qtdRecebida: novaQtd,
            status: statusItem({
              quantidade: item.quantidade,
              qtdRecebida: novaQtd,
              status: item.status,
            }),
          })
          .where(eq(encomendaItensTable.id, item.id));
        await upsertEstoque(
          tx,
          "cliente",
          item.modelo,
          item.qualidade,
          item.valorCliente,
          item.valorCusto,
          add,
        );
        await upsertEstoque(
          tx,
          "lojista",
          item.modelo,
          item.qualidade,
          item.valorLojista,
          item.valorCusto,
          add,
        );
        recebeuAlgo = true;
      }

      if (!recebeuAlgo)
        throw httpError(400, "Informe ao menos uma peça que chegou");

      // 1ª confirmação → lança a saída cheia no caixa (uma vez só).
      if (enc.saidaCaixaId == null) {
        const itensAtuais = await tx
          .select()
          .from(encomendaItensTable)
          .where(eq(encomendaItensTable.encomendaId, id));
        const totalCusto = itensAtuais
          .filter((i) => i.status !== "cancelado")
          .reduce(
            (s, i) => s + parseValorBR(i.valorCusto) * i.quantidade,
            0,
          );
        if (totalCusto > 0) {
          const [mov] = await tx
            .insert(caixaTable)
            .values({
              tipo: "saida",
              valor: valorParaTexto(totalCusto),
              motivo: `Compra de peças — ${enc.fornecedor}`,
              formaPagamento: enc.formaInvestimento,
              taxaPercent: "0",
              createdAt: enc.createdAt,
            })
            .returning();
          await tx
            .update(encomendasTable)
            .set({ saidaCaixaId: mov.id })
            .where(eq(encomendasTable.id, id));
        }
      }

      await recalcEncomenda(tx, id);
      return true;
    });
    res.status(200).json({ ok: true, duplicado: !processed });
  } catch (err) {
    const e = err as HttpError;
    if (!e.status) req.log.error({ err }, "receber encomenda falhou");
    res
      .status(e.status ?? 500)
      .json({ error: e.message || "Falha ao confirmar chegada" });
  }
});

// ── POST /encomendas/:id/itens/:itemId/cancelar ────────────────────────────
// Cancela a parte que FALTA de um item (quantidade - qtdRecebida). Se a saída
// já foi lançada (encomenda paga), gera uma ENTRADA de reembolso no caixa com
// a forma escolhida (dinheiro/pix). O que já chegou continua no estoque.
router.post(
  "/encomendas/:id/itens/:itemId/cancelar",
  async (req, res): Promise<void> => {
    const id = parseInt(req.params.id, 10);
    const itemId = parseInt(req.params.itemId, 10);
    if (isNaN(id) || isNaN(itemId)) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }
    const reembolsoForma = formaInvest(req.body?.reembolsoForma);
    try {
      await db.transaction(async (tx) => {
        await lockEncomenda(tx, id);
        const [enc] = await tx
          .select()
          .from(encomendasTable)
          .where(eq(encomendasTable.id, id));
        if (!enc) throw httpError(404, "Encomenda não encontrada");
        const [item] = await tx
          .select()
          .from(encomendaItensTable)
          .where(
            and(
              eq(encomendaItensTable.id, itemId),
              eq(encomendaItensTable.encomendaId, id),
            ),
          );
        if (!item) throw httpError(404, "Item não encontrado");
        if (item.status === "cancelado")
          throw httpError(400, "Item já cancelado");
        const falta = item.quantidade - item.qtdRecebida;
        if (falta <= 0)
          throw httpError(400, "Item já recebido por completo");

        await tx
          .update(encomendaItensTable)
          .set({ status: "cancelado", reembolsoForma })
          .where(eq(encomendaItensTable.id, item.id));

        // Reembolso só entra no caixa se a saída já tinha sido lançada (dinheiro
        // já tinha saído). Se nada chegou ainda, não houve saída → sem entrada.
        if (enc.saidaCaixaId != null) {
          const reembolso = parseValorBR(item.valorCusto) * falta;
          if (reembolso > 0) {
            await tx.insert(caixaTable).values({
              tipo: "entrada",
              valor: valorParaTexto(reembolso),
              motivo: `Reembolso ${enc.fornecedor}: ${item.modelo} (${falta}x)`,
              formaPagamento: reembolsoForma,
              taxaPercent: "0",
              modelo: item.modelo,
            });
          }
        }

        await recalcEncomenda(tx, id);
      });
      res.status(200).json({ ok: true });
    } catch (err) {
      const e = err as HttpError;
      if (!e.status) req.log.error({ err }, "cancelar item encomenda falhou");
      res
        .status(e.status ?? 500)
        .json({ error: e.message || "Falha ao cancelar item" });
    }
  },
);

// ── DELETE /encomendas/:id ─────────────────────────────────────────────────
// Só permite excluir uma encomenda que ainda NÃO teve nada confirmado (sem
// saída lançada). Depois disso, o caminho é cancelar os itens (com reembolso).
router.delete("/encomendas/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  try {
    await db.transaction(async (tx) => {
      await lockEncomenda(tx, id);
      const [enc] = await tx
        .select()
        .from(encomendasTable)
        .where(eq(encomendasTable.id, id));
      if (!enc) throw httpError(404, "Encomenda não encontrada");
      if (enc.saidaCaixaId != null) {
        throw httpError(
          400,
          "Encomenda já tem chegada confirmada. Cancele os itens que faltam em vez de excluir.",
        );
      }
      await tx
        .delete(encomendaItensTable)
        .where(eq(encomendaItensTable.encomendaId, id));
      await tx.execute(sql`
        DELETE FROM encomenda_recebimentos WHERE encomenda_id = ${id}
      `);
      await tx.delete(encomendasTable).where(eq(encomendasTable.id, id));
    });
    res.status(204).send();
  } catch (err) {
    const e = err as HttpError;
    if (!e.status) req.log.error({ err }, "excluir encomenda falhou");
    res.status(e.status ?? 500).json({ error: e.message || "Falha ao excluir encomenda" });
  }
});

export default router;
