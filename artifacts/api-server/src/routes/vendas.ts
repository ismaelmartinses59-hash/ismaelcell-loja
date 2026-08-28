import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, vendasTable, pecasTable, caixaTable, contasReceberItensTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/vendas", async (req, res): Promise<void> => {
  const periodo = (req.query.periodo as string) || "dia";

  let intervalo: string;
  if (periodo === "semana") intervalo = "7 days";
  else if (periodo === "mes") intervalo = "30 days";
  else intervalo = "1 day";

  const rows = await db
    .select()
    .from(vendasTable)
    .where(sql`${vendasTable.createdAt} >= now() - interval ${sql.raw(`'${intervalo}'`)}`)
    .orderBy(sql`${vendasTable.createdAt} desc`);

  const vendasReais = rows.filter((v) => v.tipo !== "uso_proprio");
  const total = vendasReais.reduce((acc, v) => {
    const n = parseFloat(v.valor.replace(",", "."));
    return acc + (isNaN(n) ? 0 : n);
  }, 0);

  res.json({ vendas: rows, total, quantidade: vendasReais.length });
});

router.delete("/vendas/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [venda] = await db.select().from(vendasTable).where(eq(vendasTable.id, id));
  if (!venda) {
    res.status(404).json({ error: "Venda não encontrada" });
    return;
  }
  const [itemReceber] = await db
    .select({ id: contasReceberItensTable.id })
    .from(contasReceberItensTable)
    .where(eq(contasReceberItensTable.vendaId, venda.id));
  if (itemReceber) {
    res.status(409).json({ error: "Esta venda está no A Receber. Remova o item pela conta do cliente." });
    return;
  }
  if (venda.tipo === "fiado_quitado") {
    res.status(409).json({ error: "Venda de fiado quitado não pode devolver a peça ao estoque." });
    return;
  }

  await db.transaction(async (tx) => {
    if (venda.tipo === "uso_proprio") {
      await tx.delete(caixaTable).where(eq(caixaTable.vendaId, venda.id));
    }
    await tx.delete(vendasTable).where(eq(vendasTable.id, id));

    if (venda.pecaId) {
      const [peca] = await tx.select().from(pecasTable).where(eq(pecasTable.id, venda.pecaId));
      if (peca) {
        await tx
          .update(pecasTable)
          .set({ quantidade: sql`${pecasTable.quantidade} + 1` })
          .where(eq(pecasTable.id, venda.pecaId));
        const outroSetor = peca.setor === "cliente" ? "lojista" : "cliente";
        await tx
          .update(pecasTable)
          .set({ quantidade: sql`${pecasTable.quantidade} + 1` })
          .where(
            and(
              eq(pecasTable.setor, outroSetor),
              sql`LOWER(TRIM(${pecasTable.modelo})) = LOWER(TRIM(${peca.modelo}))`,
              sql`LOWER(TRIM(${pecasTable.qualidade})) = LOWER(TRIM(${peca.qualidade}))`,
            ),
          );
      }
    }
  });

  res.status(204).send();
});

export default router;
