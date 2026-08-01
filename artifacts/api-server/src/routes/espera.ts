import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, pecasTable, pecasEsperaTable, caixaTable, vendasTable, contasReceberItensTable } from "@workspace/db";
import { LABELS, normalizeForma, taxaFor } from "../lib/formas-pagamento.js";
import { findOrCreateConta } from "./contas-receber.js";

const router: IRouter = Router();

function parseValorBR(raw: unknown): number {
  let s = String(raw ?? "").replace(/[^\d.,-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/** Lista todos os itens aguardando pagamento. */
router.get("/espera", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(pecasEsperaTable)
    .where(eq(pecasEsperaTable.status, "aguardando"))
    .orderBy(sql`${pecasEsperaTable.createdAt} desc`);
  res.json(rows);
});

/**
 * Reserva uma peça em modo espera:
 *  - Decrementa o estoque (e o gêmeo) igual a uma venda normal
 *  - Cria registro em pecas_espera com status "aguardando"
 *  - NÃO gera entrada no caixa
 */
router.post("/espera", async (req, res): Promise<void> => {
  const id = parseInt(String(req.body?.pecaId ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "pecaId obrigatório" }); return; }
  const observacao = String(req.body?.observacao ?? "").trim();

  const [atual] = await db.select().from(pecasTable).where(eq(pecasTable.id, id));
  if (!atual) { res.status(404).json({ error: "Peça não encontrada" }); return; }
  if (atual.quantidade <= 0) { res.status(400).json({ error: "Sem estoque disponível" }); return; }

  const espera = await db.transaction(async (tx) => {
    // Decrementa a peça principal
    await tx.update(pecasTable).set({ quantidade: atual.quantidade - 1 }).where(eq(pecasTable.id, id));

    // Decrementa a gêmea (twin invariant)
    const outroSetor = atual.setor === "cliente" ? "lojista" : "cliente";
    const gemeas = await tx.select().from(pecasTable).where(
      and(
        eq(pecasTable.setor, outroSetor),
        sql`LOWER(TRIM(${pecasTable.modelo})) = LOWER(TRIM(${atual.modelo}))`,
        sql`LOWER(TRIM(${pecasTable.qualidade})) = LOWER(TRIM(${atual.qualidade}))`,
      ),
    );
    for (const g of gemeas) {
      if (g.quantidade > 0) {
        await tx.update(pecasTable).set({ quantidade: g.quantidade - 1 }).where(eq(pecasTable.id, g.id));
      }
    }

    // Cria o registro de espera
    const [e] = await tx.insert(pecasEsperaTable).values({
      pecaId: id,
      modelo: atual.modelo,
      qualidade: atual.qualidade,
      valor: atual.valor,
      setor: atual.setor,
      status: "aguardando",
      observacao,
    }).returning();
    return e;
  });

  res.status(201).json(espera);
});

/**
 * Confirma o pagamento de um item em espera:
 *  - Cria venda + entrada no caixa
 *  - Marca o espera como "pago"
 */
router.post("/espera/:id/pagar", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [espera] = await db.select().from(pecasEsperaTable).where(eq(pecasEsperaTable.id, id));
  if (!espera) { res.status(404).json({ error: "Item não encontrado" }); return; }
  if (espera.status !== "aguardando") { res.status(400).json({ error: "Item já processado" }); return; }

  const fiado = req.body?.fiado === true;
  const nomeDevedor = String(req.body?.nomeDevedor ?? "").trim();
  const tipoDevedor = req.body?.tipoDevedor === "lojista" ? "lojista" : "cliente";
  const rawSplits = req.body?.splits;
  const splits: Array<{ forma: string; valor: string }> | null =
    Array.isArray(rawSplits) && rawSplits.length > 0 ? rawSplits : null;
  const forma = (fiado || splits) ? null : normalizeForma(req.body?.formaPagamento);
  if (!fiado && !splits && !forma) { res.status(400).json({ error: "formaPagamento obrigatório" }); return; }
  if (fiado && !nomeDevedor) { res.status(400).json({ error: "Nome do devedor obrigatório" }); return; }

  await db.transaction(async (tx) => {
    // Cria venda
    const [venda] = await tx.insert(vendasTable).values({
      pecaId: espera.pecaId,
      modelo: espera.modelo,
      qualidade: espera.qualidade,
      valor: espera.valor,
    }).returning();

    // Fiado: cria item na conta a receber em vez de entrada no caixa
    if (fiado) {
      const contaId = await findOrCreateConta(nomeDevedor, tipoDevedor, tx);
      const dataRecebimentoRaw = req.body?.dataRecebimento ? String(req.body.dataRecebimento) : null;
      const dataRecebimento = dataRecebimentoRaw ? new Date(dataRecebimentoRaw) : null;
      await tx.insert(contasReceberItensTable).values({
        contaId,
        vendaId: venda.id,
        modelo: espera.modelo,
        qualidade: espera.qualidade,
        valor: espera.valor,
        dataRecebimento,
      });
    }

    // Cria entrada(s) no caixa
    if (!fiado && splits && splits.length > 0) {
      for (const split of splits) {
        const splitForma = normalizeForma(split.forma);
        if (splitForma) {
          await tx.insert(caixaTable).values({
            tipo: "entrada",
            valor: split.valor,
            motivo: `Venda ${espera.modelo} (Espera · Misto · ${LABELS[splitForma]})`,
            pecaId: espera.pecaId,
            vendaId: venda.id,
            modelo: espera.modelo,
            formaPagamento: splitForma,
            taxaPercent: String(taxaFor(splitForma)),
          });
        }
      }
    } else if (forma) {
      await tx.insert(caixaTable).values({
        tipo: "entrada",
        valor: espera.valor,
        motivo: `Venda ${espera.modelo} (Espera · ${LABELS[forma]})`,
        pecaId: espera.pecaId,
        vendaId: venda.id,
        modelo: espera.modelo,
        formaPagamento: forma,
        taxaPercent: String(taxaFor(forma)),
      });
    }

    // Marca como pago
    await tx.update(pecasEsperaTable)
      .set({ status: "pago" })
      .where(eq(pecasEsperaTable.id, id));
  });

  res.json({ ok: true });
});

/**
 * Cancela um item em espera:
 *  - Devolve o estoque (e o gêmeo)
 *  - Marca o espera como "cancelado"
 */
router.delete("/espera/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [espera] = await db.select().from(pecasEsperaTable).where(eq(pecasEsperaTable.id, id));
  if (!espera) { res.status(404).json({ error: "Item não encontrado" }); return; }
  if (espera.status !== "aguardando") { res.status(400).json({ error: "Item já processado" }); return; }

  await db.transaction(async (tx) => {
    // Restaura estoque
    const [peca] = await tx.select().from(pecasTable).where(eq(pecasTable.id, espera.pecaId));
    if (peca) {
      await tx.update(pecasTable)
        .set({ quantidade: peca.quantidade + 1 })
        .where(eq(pecasTable.id, peca.id));

      const outroSetor = peca.setor === "cliente" ? "lojista" : "cliente";
      const gemeas = await tx.select().from(pecasTable).where(
        and(
          eq(pecasTable.setor, outroSetor),
          sql`LOWER(TRIM(${pecasTable.modelo})) = LOWER(TRIM(${peca.modelo}))`,
          sql`LOWER(TRIM(${pecasTable.qualidade})) = LOWER(TRIM(${peca.qualidade}))`,
        ),
      );
      for (const g of gemeas) {
        await tx.update(pecasTable).set({ quantidade: g.quantidade + 1 }).where(eq(pecasTable.id, g.id));
      }
    }
    await tx.update(pecasEsperaTable).set({ status: "cancelado" }).where(eq(pecasEsperaTable.id, id));
  });

  res.json({ ok: true });
});

export default router;
