import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, garantiasPecaTable, pecasTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/garantias-peca", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(garantiasPecaTable)
    .orderBy(sql`${garantiasPecaTable.createdAt} desc`);
  res.json(rows);
});

router.post("/garantias-peca", async (req, res): Promise<void> => {
  const { modelo, qualidade, lojista, motivo, pecaId: rawPecaId, valor } = req.body;
  if (!modelo || !qualidade || !lojista || !motivo) {
    res.status(400).json({ error: "Todos os campos são obrigatórios" });
    return;
  }
  const pecaId = rawPecaId ? parseInt(String(rawPecaId), 10) : null;

  const row = await db.transaction(async (tx) => {
    // Se veio pecaId, decrementa o estoque (e o gêmeo)
    if (pecaId && !isNaN(pecaId)) {
      const [peca] = await tx.select().from(pecasTable).where(eq(pecasTable.id, pecaId));
      if (!peca) { throw new Error("Peça não encontrada"); }
      if (peca.quantidade <= 0) { throw new Error("Sem estoque disponível"); }

      await tx.update(pecasTable)
        .set({ quantidade: peca.quantidade - 1 })
        .where(eq(pecasTable.id, pecaId));

      // Twin invariant
      const outroSetor = peca.setor === "cliente" ? "lojista" : "cliente";
      const gemeas = await tx.select().from(pecasTable).where(
        and(
          eq(pecasTable.setor, outroSetor),
          sql`LOWER(TRIM(${pecasTable.modelo})) = LOWER(TRIM(${peca.modelo}))`,
          sql`LOWER(TRIM(${pecasTable.qualidade})) = LOWER(TRIM(${peca.qualidade}))`,
        ),
      );
      for (const g of gemeas) {
        if (g.quantidade > 0) {
          await tx.update(pecasTable)
            .set({ quantidade: g.quantidade - 1 })
            .where(eq(pecasTable.id, g.id));
        }
      }
    }

    const [r] = await tx.insert(garantiasPecaTable).values({
      pecaId: pecaId ?? undefined,
      modelo: String(modelo),
      qualidade: String(qualidade),
      valor: valor ? String(valor) : null,
      lojista: String(lojista),
      motivo: String(motivo),
      status: "pendente",
    }).returning();
    return r;
  });

  res.status(201).json(row);
});

router.patch("/garantias-peca/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const { status, devolverEstoque } = req.body;
  if (!["pendente", "trocado", "recusado"].includes(status)) {
    res.status(400).json({ error: "Status inválido" }); return;
  }

  const [garantia] = await db.select().from(garantiasPecaTable).where(eq(garantiasPecaTable.id, id));
  if (!garantia) { res.status(404).json({ error: "Garantia não encontrada" }); return; }

  // Quando "trocado" e devolverEstoque=true, restaura o estoque da peça original
  if (status === "trocado" && devolverEstoque && garantia.pecaId) {
    await db.transaction(async (tx) => {
      const [peca] = await tx.select().from(pecasTable).where(eq(pecasTable.id, garantia.pecaId!));
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
          await tx.update(pecasTable)
            .set({ quantidade: g.quantidade + 1 })
            .where(eq(pecasTable.id, g.id));
        }
      }
      await tx.update(garantiasPecaTable)
        .set({ status: String(status) })
        .where(eq(garantiasPecaTable.id, id));
    });
  } else {
    await db.update(garantiasPecaTable)
      .set({ status: String(status) })
      .where(eq(garantiasPecaTable.id, id));
  }

  const [row] = await db.select().from(garantiasPecaTable).where(eq(garantiasPecaTable.id, id));
  res.json(row);
});

router.delete("/garantias-peca/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const [deleted] = await db
    .delete(garantiasPecaTable)
    .where(eq(garantiasPecaTable.id, id))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Garantia não encontrada" }); return; }
  res.status(204).send();
});

export default router;
