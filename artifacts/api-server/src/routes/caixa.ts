import { Router, type IRouter } from "express";
import { and, eq, gt, gte, lt, sql } from "drizzle-orm";
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
    const inicioDate = new Date(`${inicio}T00:00:00`);
    const fimDate = new Date(`${fim}T00:00:00`);
    fimDate.setDate(fimDate.getDate() + 1);
    if (!isNaN(inicioDate.getTime()) && !isNaN(fimDate.getTime())) {
      conditions.push(gte(caixaTable.createdAt, inicioDate));
      conditions.push(lt(caixaTable.createdAt, fimDate));
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

  let totalEntradas = 0;
  let totalSaidas = 0;
  for (const m of rows) {
    const n = parseValor(m.valor);
    if (m.tipo === "entrada") totalEntradas += n;
    else totalSaidas += n;
  }

  res.json({
    movimentos: rows,
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

router.delete("/caixa/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [mov] = await db.select().from(caixaTable).where(eq(caixaTable.id, id));
  if (!mov) {
    res.status(404).json({ error: "Movimento não encontrado" });
    return;
  }

  await db.transaction(async (tx) => {
    // Reverte venda + estoque (peça e gêmea) se a movimentação estava vinculada.
    if (mov.vendaId) {
      const [venda] = await tx
        .select()
        .from(vendasTable)
        .where(eq(vendasTable.id, mov.vendaId));
      if (venda) {
        await tx.delete(vendasTable).where(eq(vendasTable.id, venda.id));
        if (venda.pecaId) {
          const [p] = await tx
            .select()
            .from(pecasTable)
            .where(eq(pecasTable.id, venda.pecaId));
          if (p) {
            await tx
              .update(pecasTable)
              .set({ quantidade: sql`${pecasTable.quantidade} + 1` })
              .where(eq(pecasTable.id, p.id));
            const outroSetor = p.setor === "cliente" ? "lojista" : "cliente";
            await tx
              .update(pecasTable)
              .set({ quantidade: sql`${pecasTable.quantidade} + 1` })
              .where(
                and(
                  eq(pecasTable.setor, outroSetor),
                  sql`LOWER(TRIM(${pecasTable.modelo})) = LOWER(TRIM(${p.modelo}))`,
                  sql`LOWER(TRIM(${pecasTable.qualidade})) = LOWER(TRIM(${p.qualidade}))`,
                ),
              );
          }
        }
      }
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
});

export default router;
