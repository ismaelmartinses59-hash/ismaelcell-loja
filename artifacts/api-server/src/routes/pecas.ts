import { Router, type IRouter } from "express";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { db, pecasTable, vendasTable, contasReceberItensTable, caixaTable } from "@workspace/db";
import { findOrCreateConta } from "./contas-receber";
import { LABELS, isCartao, normalizeForma, taxaFor } from "../lib/formas-pagamento.js";

const router: IRouter = Router();

router.get("/pecas", async (req, res): Promise<void> => {
  const search = req.query.search as string | undefined;
  const setor = (req.query.setor as string) || "lojista";
  const conditions = [eq(pecasTable.setor, setor)];
  if (search) {
    const s = or(
      ilike(pecasTable.modelo, `%${search}%`),
      ilike(pecasTable.qualidade, `%${search}%`),
    );
    if (s) conditions.push(s);
  }
  const rows = await db
    .select()
    .from(pecasTable)
    .where(and(...conditions))
    .orderBy(sql`${pecasTable.modelo} asc`);
  res.json(rows);
});

router.post("/pecas", async (req, res): Promise<void> => {
  const { modelo, qualidade, valor, valorCusto, quantidade, setor } = req.body;
  if (!modelo || !qualidade || !valor) {
    res.status(400).json({ error: "modelo, qualidade e valor são obrigatórios" });
    return;
  }
  const setorFinal = setor === "cliente" ? "cliente" : "lojista";
  const [peca] = await db
    .insert(pecasTable)
    .values({
      modelo: String(modelo),
      qualidade: String(qualidade),
      valor: String(valor),
      valorCusto: valorCusto != null ? String(valorCusto) : "",
      quantidade: parseInt(quantidade) || 0,
      setor: setorFinal,
    })
    .returning();
  res.status(201).json(peca);
});

router.post("/pecas/twin", async (req, res): Promise<void> => {
  const { modelo, qualidade, valorCliente, valorLojista, valorCusto, quantidade } = req.body;
  if (!modelo || !qualidade || !valorCliente || !valorLojista) {
    res.status(400).json({ error: "modelo, qualidade, valorCliente e valorLojista são obrigatórios" });
    return;
  }
  try {
    const [cliente, lojista] = await db.transaction(async (tx) => {
      const [c] = await tx.insert(pecasTable).values({
        modelo: String(modelo),
        qualidade: String(qualidade),
        valor: String(valorCliente),
        valorCusto: valorCusto != null ? String(valorCusto) : "",
        quantidade: parseInt(quantidade) || 0,
        setor: "cliente",
      }).returning();
      const [l] = await tx.insert(pecasTable).values({
        modelo: String(modelo),
        qualidade: String(qualidade),
        valor: String(valorLojista),
        valorCusto: valorCusto != null ? String(valorCusto) : "",
        quantidade: parseInt(quantidade) || 0,
        setor: "lojista",
      }).returning();
      return [c, l];
    });
    res.status(201).json({ cliente, lojista });
  } catch (err) {
    req.log.error({ err }, "twin create failed");
    res.status(500).json({ error: "Falha ao criar peças (nada foi salvo)" });
  }
});

router.put("/pecas/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const { modelo, qualidade, valor, valorCusto, quantidade } = req.body;
  if (!modelo || !qualidade || !valor) {
    res.status(400).json({ error: "modelo, qualidade e valor são obrigatórios" });
    return;
  }
  const novaQuantidade = parseInt(quantidade) || 0;
  const updates: Record<string, unknown> = {
    modelo: String(modelo),
    qualidade: String(qualidade),
    valor: String(valor),
    quantidade: novaQuantidade,
  };
  if (valorCusto !== undefined) updates.valorCusto = String(valorCusto);
  try {
    const peca = await db.transaction(async (tx) => {
      const [atual] = await tx.select().from(pecasTable).where(eq(pecasTable.id, id));
      if (!atual) return null;
      const [atualizada] = await tx
        .update(pecasTable)
        .set(updates)
        .where(eq(pecasTable.id, id))
        .returning();
      // Estoque compartilhado: espelha quantidade + modelo/qualidade na peça gêmea
      // do outro setor (encontrada pelo modelo+qualidade ORIGINAIS), mantendo o par
      // sincronizado e preservando o valor próprio de cada setor.
      const outroSetor = atual.setor === "cliente" ? "lojista" : "cliente";
      await tx
        .update(pecasTable)
        .set({
          quantidade: novaQuantidade,
          modelo: String(modelo),
          qualidade: String(qualidade),
        })
        .where(
          and(
            eq(pecasTable.setor, outroSetor),
            sql`LOWER(TRIM(${pecasTable.modelo})) = LOWER(TRIM(${atual.modelo}))`,
            sql`LOWER(TRIM(${pecasTable.qualidade})) = LOWER(TRIM(${atual.qualidade}))`,
          ),
        );
      return atualizada;
    });
    if (!peca) { res.status(404).json({ error: "Peça não encontrada" }); return; }
    res.json(peca);
  } catch (err) {
    req.log.error({ err }, "peca update failed");
    res.status(500).json({ error: "Falha ao atualizar peça (nada foi salvo)" });
  }
});

router.post("/pecas/:id/vender", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const [atual] = await db.select().from(pecasTable).where(eq(pecasTable.id, id));
  if (!atual) { res.status(404).json({ error: "Peça não encontrada" }); return; }
  if (atual.quantidade <= 0) { res.status(400).json({ error: "Sem estoque disponível" }); return; }
  const fiado = req.body?.fiado === true;
  const nomeDevedor = String(req.body?.nomeDevedor ?? "").trim();
  const tipoDevedor = req.body?.tipoDevedor === "lojista" ? "lojista" : "cliente";
  // Forma de pagamento da venda à vista (dinheiro ou cartão). Só vale quando NÃO é fiado.
  const forma = fiado ? null : normalizeForma(req.body?.formaPagamento);
  if (fiado && !nomeDevedor) {
    res.status(400).json({ error: "Nome do devedor obrigatório no fiado" });
    return;
  }
  // Todas as escritas da venda (estoque, venda, item fiado, gêmea e entrada
  // de cartão no caixa) acontecem numa única transação, para que a entrada de
  // cartão fique sempre atômica com a venda/estoque (sem venda "solta").
  const peca = await db.transaction(async (tx) => {
    const [p] = await tx
      .update(pecasTable)
      .set({ quantidade: atual.quantidade - 1 })
      .where(eq(pecasTable.id, id))
      .returning();
    const [venda] = await tx
      .insert(vendasTable)
      .values({
        pecaId: id,
        modelo: atual.modelo,
        qualidade: atual.qualidade,
        valor: atual.valor,
      })
      .returning();
    if (fiado) {
      const contaId = await findOrCreateConta(nomeDevedor, tipoDevedor, tx);
      await tx.insert(contasReceberItensTable).values({
        contaId,
        vendaId: venda.id,
        modelo: atual.modelo,
        qualidade: atual.qualidade,
        valor: atual.valor,
      });
    }
    // Estoque compartilhado: decrementa também a peça gêmea no outro setor
    const outroSetor = atual.setor === "cliente" ? "lojista" : "cliente";
    const gemeas = await tx
      .select()
      .from(pecasTable)
      .where(
        and(
          eq(pecasTable.setor, outroSetor),
          sql`LOWER(TRIM(${pecasTable.modelo})) = LOWER(TRIM(${atual.modelo}))`,
          sql`LOWER(TRIM(${pecasTable.qualidade})) = LOWER(TRIM(${atual.qualidade}))`,
        ),
      );
    for (const g of gemeas) {
      if (g.quantidade > 0) {
        await tx
          .update(pecasTable)
          .set({ quantidade: g.quantidade - 1 })
          .where(eq(pecasTable.id, g.id));
      }
    }
    // Venda no cartão entra automaticamente no caixa (vinculada à venda+peça,
    // para que excluir a movimentação reverta estoque e venda). Dinheiro e
    // fiado seguem o fluxo atual (sem entrada automática no caixa).
    if (!fiado && isCartao(forma) && forma) {
      await tx.insert(caixaTable).values({
        tipo: "entrada",
        valor: atual.valor,
        motivo: `Venda ${atual.modelo} (${LABELS[forma]})`,
        pecaId: id,
        vendaId: venda.id,
        modelo: atual.modelo,
        formaPagamento: forma,
        taxaPercent: String(taxaFor(forma)),
      });
    }
    return p;
  });
  res.json(peca);
});

router.post("/pecas/:id/devolver", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const [atual] = await db.select().from(pecasTable).where(eq(pecasTable.id, id));
  if (!atual) { res.status(404).json({ error: "Peça não encontrada" }); return; }
  if (atual.quantidade <= 0) { res.status(400).json({ error: "Sem estoque para devolver" }); return; }
  const [peca] = await db
    .update(pecasTable)
    .set({ quantidade: atual.quantidade - 1 })
    .where(eq(pecasTable.id, id))
    .returning();
  // Estoque compartilhado: decrementa também a gêmea no outro setor
  const outroSetor = atual.setor === "cliente" ? "lojista" : "cliente";
  const gemeas = await db
    .select()
    .from(pecasTable)
    .where(
      and(
        eq(pecasTable.setor, outroSetor),
        sql`LOWER(TRIM(${pecasTable.modelo})) = LOWER(TRIM(${atual.modelo}))`,
        sql`LOWER(TRIM(${pecasTable.qualidade})) = LOWER(TRIM(${atual.qualidade}))`,
      ),
    );
  for (const g of gemeas) {
    if (g.quantidade > 0) {
      await db
        .update(pecasTable)
        .set({ quantidade: g.quantidade - 1 })
        .where(eq(pecasTable.id, g.id));
    }
  }
  res.json(peca);
});

router.delete("/pecas/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const [deleted] = await db.delete(pecasTable).where(eq(pecasTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Peça não encontrada" }); return; }
  res.status(204).send();
});

export default router;
