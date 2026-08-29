import { Router, type IRouter } from "express";
import { and, eq, gt, gte, inArray, lt, sql } from "drizzle-orm";
import {
  db,
  caixaTable,
  pecasTable,
  vendasTable,
  contasReceberPagamentosTable,
  contasReceberTable,
} from "@workspace/db";
import {
  normalizeForma,
  taxaFor,
  isCartao,
  type FormaPagamento,
} from "../lib/formas-pagamento.js";

const router: IRouter = Router();

/**
 * Converte um valor monetário em texto (formato pt-BR) para número.
 * Aceita "220,00", "1.234,56", "75", "75.50".
 */
function parseValor(raw: string): number {
  let s = String(raw).replace(/[^\d.,-]/g, "");
  if (s.includes(",")) {
    // vírgula é decimal; pontos são separadores de milhar
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

const TZ = "America/Sao_Paulo";

/**
 * Instante (Date) do início da semana atual — segunda-feira 00:00 no fuso de
 * São Paulo. Brasil não tem mais horário de verão, então o offset é fixo -03:00.
 */
function inicioSemanaSP(): Date {
  const agoraSP = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
  const dow = agoraSP.getDay(); // 0=domingo .. 6=sábado
  const diff = (dow + 6) % 7; // quantos dias desde a última segunda
  agoraSP.setDate(agoraSP.getDate() - diff);
  const y = agoraSP.getFullYear();
  const m = String(agoraSP.getMonth() + 1).padStart(2, "0");
  const d = String(agoraSP.getDate()).padStart(2, "0");
  return new Date(`${y}-${m}-${d}T00:00:00-03:00`);
}

interface HttpError extends Error {
  status?: number;
}

function httpError(status: number, message: string): HttpError {
  const e = new Error(message) as HttpError;
  e.status = status;
  return e;
}

router.get("/caixa", async (req, res): Promise<void> => {
  const periodo = req.query.periodo as string | undefined;
  const inicio = req.query.inicio as string | undefined;
  const fim = req.query.fim as string | undefined;
  const dia = req.query.dia as string | undefined;

  const conditions = [];
  if (dia && /^\d{4}-\d{2}-\d{2}$/.test(dia)) {
    // Um único dia no fuso de São Paulo (converte o timestamp UTC pra SP
    // antes de comparar a data, pra não vazar movimentos do dia vizinho).
    conditions.push(
      sql`(${caixaTable.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date = ${dia}::date`,
    );
  } else if (inicio && fim) {
    // Filtra pelo dia SP (mesmo padrão do filtro ?dia=), para não
    // capturar registros do dia vizinho por causa do offset UTC-3.
    if (/^\d{4}-\d{2}-\d{2}$/.test(inicio) && /^\d{4}-\d{2}-\d{2}$/.test(fim)) {
      conditions.push(
        sql`(${caixaTable.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date >= ${inicio}::date`,
      );
      conditions.push(
        sql`(${caixaTable.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date <= ${fim}::date`,
      );
    }
  } else if (periodo === "semana") {
    conditions.push(gte(caixaTable.createdAt, inicioSemanaSP()));
  } else {
    const dias =
      periodo === "7" ? 7 : periodo === "15" ? 15 : periodo === "365" ? 365 : 30;
    conditions.push(
      sql`${caixaTable.createdAt} >= now() - interval ${sql.raw(`'${dias} days'`)}`,
    );
  }

  const rows = await db
    .select()
    .from(caixaTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(sql`${caixaTable.createdAt} desc`);

  const vendaIds = [...new Set(rows.flatMap((m) => (m.vendaId ? [m.vendaId] : [])))];
  const vendaTipos = new Map<number, string>();
  const vendaReembolsoAt = new Map<number, Date>();
  if (vendaIds.length > 0) {
    const vendas = await db
      .select({ id: vendasTable.id, tipo: vendasTable.tipo })
      .from(vendasTable)
      .where(inArray(vendasTable.id, vendaIds));
    for (const venda of vendas) vendaTipos.set(venda.id, venda.tipo);

    const reembolsos = await db
      .select({ vendaId: caixaTable.vendaId, createdAt: caixaTable.createdAt })
      .from(caixaTable)
      .where(
        and(
          inArray(caixaTable.vendaId, vendaIds),
          eq(caixaTable.tipo, "saida"),
        ),
      );
    for (const reembolso of reembolsos) {
      if (reembolso.vendaId && !vendaReembolsoAt.has(reembolso.vendaId)) {
        vendaReembolsoAt.set(reembolso.vendaId, reembolso.createdAt);
      }
    }
  }
  const movimentoIds = rows.map((m) => m.id);
  const reembolsoPorMovimento = new Map<
    number,
    { createdAt: Date; formaPagamento: string | null }
  >();
  if (movimentoIds.length > 0) {
    const reembolsosDiretos = await db
      .select({
        origemId: caixaTable.reembolsoOrigemId,
        createdAt: caixaTable.createdAt,
        formaPagamento: caixaTable.formaPagamento,
      })
      .from(caixaTable)
      .where(inArray(caixaTable.reembolsoOrigemId, movimentoIds));
    for (const reembolso of reembolsosDiretos) {
      if (reembolso.origemId) {
        reembolsoPorMovimento.set(reembolso.origemId, {
          createdAt: reembolso.createdAt,
          formaPagamento: reembolso.formaPagamento,
        });
      }
    }
  }
  const movimentos = rows.map((m) => ({
    ...m,
    vendaTipo: m.vendaId ? vendaTipos.get(m.vendaId) ?? null : null,
    vendaReembolsoAt:
      reembolsoPorMovimento.get(m.id)?.createdAt.toISOString() ??
      (m.vendaId ? vendaReembolsoAt.get(m.vendaId)?.toISOString() ?? null : null),
    reembolsoForma:
      reembolsoPorMovimento.get(m.id)?.formaPagamento ?? null,
  }));

  let totalEntradas = 0;
  let totalSaidas = 0;
  for (const m of rows) {
    const n = parseValor(m.valor);
    if (m.tipo === "entrada") totalEntradas += n;
    else totalSaidas += n;
  }

  res.json({
    movimentos,
    totalEntradas,
    totalSaidas,
    saldo: totalEntradas - totalSaidas,
  });
});

router.post("/caixa", async (req, res): Promise<void> => {
  const tipo =
    req.body?.tipo === "saida"
      ? "saida"
      : req.body?.tipo === "entrada"
        ? "entrada"
        : null;
  const valor = String(req.body?.valor ?? "").trim();
  const motivo = String(req.body?.motivo ?? "").trim();
  const pecaIdRaw = req.body?.pecaId;
  // Forma de pagamento: entrada aceita todas (dinheiro/pix/cartão); saída só
  // aceita dinheiro ou PIX (cartão não faz sentido numa saída de caixa).
  const formaRaw = normalizeForma(req.body?.formaPagamento);
  const formaPagamento: FormaPagamento | null =
    tipo === "entrada" ? formaRaw : formaRaw === "pix" ? "pix" : "dinheiro";
  const taxaPercent =
    tipo === "entrada" && formaPagamento
      ? String(taxaFor(formaPagamento))
      : null;

  if (!tipo) {
    res.status(400).json({ error: "tipo deve ser entrada ou saida" });
    return;
  }
  if (!valor) {
    res.status(400).json({ error: "valor é obrigatório" });
    return;
  }
  if (!motivo) {
    res.status(400).json({ error: "motivo é obrigatório" });
    return;
  }
  // Saída não aceita cartão (só dinheiro ou PIX). Forma ausente/inválida numa
  // saída cai em dinheiro (compatível com lançamentos antigos sem forma).
  if (tipo === "saida" && isCartao(formaRaw)) {
    res
      .status(400)
      .json({ error: "Saída só pode ser em dinheiro ou PIX (sem cartão)" });
    return;
  }

  let pid: number | null = null;
  if (tipo === "entrada" && pecaIdRaw != null && pecaIdRaw !== "") {
    pid = parseInt(String(pecaIdRaw), 10);
    if (isNaN(pid)) {
      res.status(400).json({ error: "pecaId inválido" });
      return;
    }
  }

  try {
    const mov = await db.transaction(async (tx) => {
      let pecaId: number | null = null;
      let vendaId: number | null = null;
      let modelo: string | null = null;

      if (pid != null) {
        const [atual] = await tx
          .select()
          .from(pecasTable)
          .where(eq(pecasTable.id, pid));
        if (!atual) throw httpError(404, "Peça não encontrada");

        // Decremento atômico com proteção contra estoque negativo.
        const decremented = await tx
          .update(pecasTable)
          .set({ quantidade: sql`${pecasTable.quantidade} - 1` })
          .where(and(eq(pecasTable.id, pid), gt(pecasTable.quantidade, 0)))
          .returning();
        if (decremented.length === 0)
          throw httpError(400, "Sem estoque disponível");

        const [venda] = await tx
          .insert(vendasTable)
          .values({
            pecaId: pid,
            modelo: atual.modelo,
            qualidade: atual.qualidade,
            valor,
          })
          .returning();

        // Estoque compartilhado: decrementa também a peça gêmea no outro setor.
        const outroSetor = atual.setor === "cliente" ? "lojista" : "cliente";
        await tx
          .update(pecasTable)
          .set({ quantidade: sql`${pecasTable.quantidade} - 1` })
          .where(
            and(
              eq(pecasTable.setor, outroSetor),
              sql`LOWER(TRIM(${pecasTable.modelo})) = LOWER(TRIM(${atual.modelo}))`,
              sql`LOWER(TRIM(${pecasTable.qualidade})) = LOWER(TRIM(${atual.qualidade}))`,
              gt(pecasTable.quantidade, 0),
            ),
          );

        pecaId = pid;
        vendaId = venda.id;
        modelo = atual.modelo;
      }

      const [m] = await tx
        .insert(caixaTable)
        .values({
          tipo,
          valor,
          motivo,
          pecaId,
          vendaId,
          modelo,
          formaPagamento,
          taxaPercent,
        })
        .returning();
      return m;
    });

    res.status(201).json(mov);
  } catch (err) {
    const e = err as HttpError;
    res.status(e.status ?? 500).json({ error: e.message || "Erro ao registrar" });
  }
});

router.post("/caixa/:id/reembolsar", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const formaRaw = String(req.body?.formaPagamento ?? "").trim();
  const forma =
    formaRaw === "dinheiro" || formaRaw === "pix" || formaRaw === "cartao"
      ? formaRaw
      : null;
  if (!forma) {
    res.status(400).json({ error: "Escolha Dinheiro, PIX ou Cartão." });
    return;
  }

  try {
    const resultado = await db.transaction(async (tx) => {
      const [origemInicial] = await tx
        .select({
          id: caixaTable.id,
          vendaId: caixaTable.vendaId,
        })
        .from(caixaTable)
        .where(eq(caixaTable.id, id));
      if (!origemInicial) throw httpError(404, "Lançamento não encontrado");
      const lockId = origemInicial.vendaId ?? -origemInicial.id;
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtext('caixa_reembolso'), ${lockId})
      `);
      await tx.execute(
        sql`SELECT id FROM caixa WHERE id = ${id} FOR UPDATE`,
      );
      const [origem] = await tx
        .select()
        .from(caixaTable)
        .where(eq(caixaTable.id, id));
      if (!origem) throw httpError(404, "Lançamento não encontrado");
      if (origem.tipo !== "entrada") {
        throw httpError(409, "Somente entradas de venda podem ser reembolsadas.");
      }
      if (origem.pagamentoId) {
        throw httpError(
          409,
          "Recebimentos do A Receber devem ser corrigidos pela conta do cliente.",
        );
      }

      const [jaReembolsado] = await tx
        .select({ id: caixaTable.id })
        .from(caixaTable)
        .where(eq(caixaTable.reembolsoOrigemId, origem.id));
      if (jaReembolsado) {
        throw httpError(409, "Este lançamento já foi reembolsado.");
      }

      let venda: typeof vendasTable.$inferSelect | null = null;
      let valorReembolso = origem.valor;
      if (origem.vendaId) {
        [venda] = await tx
          .select()
          .from(vendasTable)
          .where(eq(vendasTable.id, origem.vendaId));
        if (!venda) throw httpError(404, "A venda vinculada não foi encontrada.");
        if (venda.tipo === "reembolsada") {
          throw httpError(409, "Esta venda já foi reembolsada.");
        }
        if (venda.tipo !== "venda") {
          throw httpError(409, "Este registro não é uma venda reembolsável.");
        }

        await tx.execute(sql`
          SELECT id FROM caixa
          WHERE venda_id = ${venda.id} AND tipo = 'entrada'
          FOR UPDATE
        `);
        const entradasVenda = await tx
          .select({
            id: caixaTable.id,
            valor: caixaTable.valor,
          })
          .from(caixaTable)
          .where(
            and(
              eq(caixaTable.vendaId, venda.id),
              eq(caixaTable.tipo, "entrada"),
            ),
          );
        if (entradasVenda.length === 0) {
          throw httpError(409, "Não encontrei o recebimento desta venda no Caixa.");
        }
        const totalRecebido = entradasVenda.reduce(
          (total, entrada) => total + parseValor(entrada.valor),
          0,
        );
        if (totalRecebido <= 0) {
          throw httpError(409, "O valor recebido desta venda é inválido.");
        }
        valorReembolso = totalRecebido.toFixed(2).replace(".", ",");

        const [marcada] = await tx
          .update(vendasTable)
          .set({ tipo: "reembolsada" })
          .where(and(eq(vendasTable.id, venda.id), eq(vendasTable.tipo, "venda")))
          .returning();
        if (!marcada) throw httpError(409, "Esta venda já foi reembolsada.");

        const [peca] = await tx
          .select()
          .from(pecasTable)
          .where(eq(pecasTable.id, venda.pecaId));
        if (!peca) {
          throw httpError(
            404,
            "A peça desta venda não existe mais no estoque.",
          );
        }
        const outroSetor = peca.setor === "cliente" ? "lojista" : "cliente";
        const gemeas = await tx
          .select()
          .from(pecasTable)
          .where(
            and(
              eq(pecasTable.setor, outroSetor),
              sql`LOWER(TRIM(${pecasTable.modelo})) = LOWER(TRIM(${peca.modelo}))`,
              sql`LOWER(TRIM(${pecasTable.qualidade})) = LOWER(TRIM(${peca.qualidade}))`,
            ),
          );
        if (gemeas.length === 0) {
          throw httpError(
            409,
            "Não encontrei a peça gêmea no outro setor para devolver o estoque.",
          );
        }
        await tx
          .update(pecasTable)
          .set({ quantidade: sql`${pecasTable.quantidade} + 1` })
          .where(eq(pecasTable.id, peca.id));
        for (const gemea of gemeas) {
          await tx
            .update(pecasTable)
            .set({ quantidade: sql`${pecasTable.quantidade} + 1` })
            .where(eq(pecasTable.id, gemea.id));
        }
      }

      const [saida] = await tx
        .insert(caixaTable)
        .values({
          tipo: "saida",
          valor: valorReembolso,
          motivo: `Reembolso: ${origem.motivo}`,
          pecaId: origem.pecaId,
          vendaId: origem.vendaId,
          reembolsoOrigemId: origem.id,
          modelo: origem.modelo,
          formaPagamento: forma,
          taxaPercent: "0",
        })
        .returning();

      return { origem, saida };
    });
    res.json(resultado);
  } catch (err) {
    const e = err as HttpError & { code?: string };
    if (e.code === "23505") {
      res.status(409).json({ error: "Este lançamento já foi reembolsado." });
      return;
    }
    res.status(e.status ?? 500).json({ error: e.message || "Erro ao reembolsar" });
  }
});

router.delete("/caixa/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM caixa WHERE id = ${id} FOR UPDATE`,
      );
      const [mov] = await tx
        .select()
        .from(caixaTable)
        .where(eq(caixaTable.id, id));
      if (!mov) throw httpError(404, "Movimento não encontrado");
      if (mov.reembolsoOrigemId) {
        throw httpError(409, "O lançamento de um reembolso não pode ser apagado.");
      }
      const [reembolsoVinculado] = await tx
        .select({ id: caixaTable.id })
        .from(caixaTable)
        .where(eq(caixaTable.reembolsoOrigemId, mov.id));
      if (reembolsoVinculado) {
        throw httpError(409, "Um lançamento reembolsado não pode ser apagado.");
      }
      if (mov.vendaId) {
        const [vendaVinculada] = await tx
          .select({ tipo: vendasTable.tipo })
          .from(vendasTable)
          .where(eq(vendasTable.id, mov.vendaId));
        if (vendaVinculada?.tipo === "reembolsada") {
          throw httpError(
            409,
            "Lançamentos de uma venda reembolsada não podem ser apagados pelo Caixa.",
          );
        }
        throw httpError(
          409,
          "Vendas vinculadas não podem ser apagadas pelo Caixa. Use Reembolsar.",
        );
      }

    // Se for uma entrada de AV (pagamento de fiado), apaga o pagamento
    // vinculado e reabre a conta a receber.
    if (mov.pagamentoId) {
      const [pag] = await tx
        .select()
        .from(contasReceberPagamentosTable)
        .where(eq(contasReceberPagamentosTable.id, mov.pagamentoId));
      if (pag) {
        await tx
          .delete(contasReceberPagamentosTable)
          .where(eq(contasReceberPagamentosTable.id, pag.id));
        await tx
          .update(contasReceberTable)
          .set({ closedAt: null })
          .where(eq(contasReceberTable.id, pag.contaId));
      }
    }

    await tx.delete(caixaTable).where(eq(caixaTable.id, id));
    });
    res.status(204).send();
  } catch (err) {
    const e = err as HttpError;
    res.status(e.status ?? 500).json({ error: e.message || "Erro ao excluir" });
  }
});

export default router;
