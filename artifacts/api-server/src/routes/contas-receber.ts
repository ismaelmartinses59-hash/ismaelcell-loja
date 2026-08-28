import { Router, type IRouter } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  contasReceberTable,
  contasReceberItensTable,
  contasReceberPagamentosTable,
  caixaTable,
  pecasTable,
  vendasTable,
} from "@workspace/db";
import { normalizeForma, taxaFor } from "../lib/formas-pagamento.js";

const router: IRouter = Router();

function parseValor(s: string): number {
  const n = parseFloat(String(s ?? "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

async function getContaResumo(contaId: number) {
  const [conta] = await db
    .select()
    .from(contasReceberTable)
    .where(eq(contasReceberTable.id, contaId));
  if (!conta) return null;
  const itens = await db
    .select()
    .from(contasReceberItensTable)
    .where(eq(contasReceberItensTable.contaId, contaId))
    .orderBy(sql`${contasReceberItensTable.createdAt} desc`);
  const pagamentos = await db
    .select()
    .from(contasReceberPagamentosTable)
    .where(eq(contasReceberPagamentosTable.contaId, contaId))
    .orderBy(sql`${contasReceberPagamentosTable.createdAt} desc`);
  const totalItens = itens.reduce((a, i) => a + parseValor(i.valor), 0);
  const totalPago = pagamentos.reduce((a, p) => a + parseValor(p.valor), 0);
  const saldo = totalItens - totalPago;
  return { conta, itens, pagamentos, totalItens, totalPago, saldo };
}

async function restaurarEstoqueDaVenda(
  vendaId: number,
  executor: DbExecutor,
): Promise<void> {
  const [venda] = await executor
    .select()
    .from(vendasTable)
    .where(eq(vendasTable.id, vendaId));
  if (!venda) return;
  const [peca] = await executor
    .select()
    .from(pecasTable)
    .where(eq(pecasTable.id, venda.pecaId));
  if (peca) {
    await executor
      .update(pecasTable)
      .set({ quantidade: sql`${pecasTable.quantidade} + 1` })
      .where(eq(pecasTable.id, peca.id));
    const outroSetor = peca.setor === "cliente" ? "lojista" : "cliente";
    await executor
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
  await executor.delete(vendasTable).where(eq(vendasTable.id, vendaId));
}

// Lista todas as contas com resumo
router.get("/contas-receber", async (_req, res): Promise<void> => {
  const contas = await db
    .select()
    .from(contasReceberTable)
    .orderBy(sql`${contasReceberTable.closedAt} nulls first, ${contasReceberTable.createdAt} desc`);
  const result = await Promise.all(
    contas.map(async (c) => {
      const r = await getContaResumo(c.id);
      return r;
    }),
  );
  res.json(result.filter((r) => r !== null));
});

// Detalhes de uma conta
router.get("/contas-receber/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const r = await getContaResumo(id);
  if (!r) {
    res.status(404).json({ error: "Conta não encontrada" });
    return;
  }
  res.json(r);
});

// Encontra ou cria conta aberta para nome+tipo.
// Aceita um executor opcional (transação) para participar de uma venda atômica.
type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
async function findOrCreateConta(
  nome: string,
  tipo: string,
  executor: DbExecutor = db,
): Promise<number> {
  const tipoFinal = tipo === "lojista" ? "lojista" : "cliente";
  const nomeNorm = nome.trim();
  const [existente] = await executor
    .select()
    .from(contasReceberTable)
    .where(
      and(
        sql`LOWER(TRIM(${contasReceberTable.nome})) = LOWER(${nomeNorm})`,
        eq(contasReceberTable.tipo, tipoFinal),
        isNull(contasReceberTable.closedAt),
      ),
    );
  if (existente) return existente.id;
  const [novo] = await executor
    .insert(contasReceberTable)
    .values({ nome: nomeNorm, tipo: tipoFinal })
    .returning();
  return novo.id;
}

export { findOrCreateConta };

// Registrar pagamento (AV)
router.post("/contas-receber/:id/pagamento", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const valor = String(req.body?.valor ?? "").trim();
  if (!valor || parseValor(valor) <= 0) {
    res.status(400).json({ error: "Valor inválido" });
    return;
  }
  // Forma de pagamento do AV (dinheiro/pix/cartão). A taxa do cartão é prejuízo
  // da loja: o valor que abate a dívida é o cheio; a entrada no caixa guarda a
  // forma + taxa para o líquido aparecer no fechamento.
  const forma = normalizeForma(req.body?.formaPagamento) ?? "dinheiro";
  // Registra o pagamento E lança a entrada correspondente no caixa (AV),
  // ligadas por pagamentoId para manterem-se em sincronia ao apagar.
  const encontrado = await db.transaction(async (tx) => {
    const [conta] = await tx
      .select()
      .from(contasReceberTable)
      .where(eq(contasReceberTable.id, id))
      .for("update");
    if (!conta) return false;
    const [pag] = await tx
      .insert(contasReceberPagamentosTable)
      .values({ contaId: id, valor, formaPagamento: forma })
      .returning();
    await tx.insert(caixaTable).values({
      tipo: "entrada",
      valor,
      motivo: `AV — ${conta.nome}`,
      pagamentoId: pag.id,
      formaPagamento: forma,
      taxaPercent: forma ? String(taxaFor(forma)) : null,
    });
    const itens = await tx
      .select()
      .from(contasReceberItensTable)
      .where(eq(contasReceberItensTable.contaId, id));
    const pagamentos = await tx
      .select()
      .from(contasReceberPagamentosTable)
      .where(eq(contasReceberPagamentosTable.contaId, id));
    const totalItens = itens.reduce((acc, item) => acc + parseValor(item.valor), 0);
    const totalPago = pagamentos.reduce((acc, pagamento) => acc + parseValor(pagamento.valor), 0);
    if (totalItens - totalPago <= 0) {
      await tx
        .update(contasReceberTable)
        .set({ closedAt: new Date() })
        .where(eq(contasReceberTable.id, id));
    }
    return true;
  });
  if (!encontrado) {
    res.status(404).json({ error: "Conta não encontrada" });
    return;
  }
  res.json(await getContaResumo(id));
});

// Apagar pagamento
router.delete("/contas-receber/pagamentos/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const [pag] = await db
    .select()
    .from(contasReceberPagamentosTable)
    .where(eq(contasReceberPagamentosTable.id, id));
  if (!pag) {
    res.status(404).json({ error: "Pagamento não encontrado" });
    return;
  }
  await db.transaction(async (tx) => {
    // Remove também a entrada do caixa vinculada a este pagamento (AV).
    await tx.delete(caixaTable).where(eq(caixaTable.pagamentoId, id));
    await tx
      .delete(contasReceberPagamentosTable)
      .where(eq(contasReceberPagamentosTable.id, id));
    // Reabre a conta se estava fechada
    await tx
      .update(contasReceberTable)
      .set({ closedAt: null })
      .where(eq(contasReceberTable.id, pag.contaId));
  });
  res.status(204).send();
});

// Adiciona item manual (ex: serviço) a uma conta existente
router.post("/contas-receber/:id/item", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const descricao = String(req.body?.descricao ?? "").trim();
  const valor = String(req.body?.valor ?? "").trim();
  const formaPagamento = req.body?.formaPagamento ? String(req.body.formaPagamento) : null;
  const pecaIdRaw = req.body?.pecaId;
  const pecaId = pecaIdRaw == null || pecaIdRaw === "" ? null : parseInt(String(pecaIdRaw), 10);
  const dataRecebimentoRaw = req.body?.dataRecebimento ? String(req.body.dataRecebimento) : null;
  const dataRecebimento = dataRecebimentoRaw ? new Date(dataRecebimentoRaw) : null;
  if (!descricao) {
    res.status(400).json({ error: "Descrição obrigatória" });
    return;
  }
  if (!valor || parseValor(valor) <= 0) {
    res.status(400).json({ error: "Valor inválido" });
    return;
  }
  if (pecaIdRaw != null && pecaIdRaw !== "" && (!pecaId || isNaN(pecaId))) {
    res.status(400).json({ error: "Peça inválida" });
    return;
  }
  const [conta] = await db
    .select()
    .from(contasReceberTable)
    .where(eq(contasReceberTable.id, id));
  if (!conta) {
    res.status(404).json({ error: "Conta não encontrada" });
    return;
  }
  try {
    await db.transaction(async (tx) => {
      let vendaId: number | null = null;
      let modelo = descricao;
      let qualidade = "Serviço";

      if (pecaId) {
        const [peca] = await tx.select().from(pecasTable).where(eq(pecasTable.id, pecaId));
        if (!peca) throw new Error("Peça não encontrada");

        const [baixada] = await tx
          .update(pecasTable)
          .set({ quantidade: sql`${pecasTable.quantidade} - 1` })
          .where(and(eq(pecasTable.id, peca.id), sql`${pecasTable.quantidade} > 0`))
          .returning();
        if (!baixada) throw new Error("Sem estoque disponível");

        const outroSetor = peca.setor === "cliente" ? "lojista" : "cliente";
        const gemeas = await tx.select().from(pecasTable).where(
          and(
            eq(pecasTable.setor, outroSetor),
            sql`LOWER(TRIM(${pecasTable.modelo})) = LOWER(TRIM(${peca.modelo}))`,
            sql`LOWER(TRIM(${pecasTable.qualidade})) = LOWER(TRIM(${peca.qualidade}))`,
          ),
        );
        if (gemeas.length === 0) throw new Error("Peça gêmea não encontrada no outro setor");
        for (const g of gemeas) {
          const [gemeaBaixada] = await tx
            .update(pecasTable)
            .set({ quantidade: sql`${pecasTable.quantidade} - 1` })
            .where(and(eq(pecasTable.id, g.id), sql`${pecasTable.quantidade} > 0`))
            .returning();
          if (!gemeaBaixada) throw new Error("Estoque gêmeo sem unidade disponível");
        }
        const [venda] = await tx.insert(vendasTable).values({
          pecaId: peca.id,
          modelo: peca.modelo,
          qualidade: peca.qualidade,
          valor,
        }).returning();
        vendaId = venda.id;
        modelo = peca.modelo;
        qualidade = peca.qualidade;
      }

      await tx.insert(contasReceberItensTable).values({
        contaId: id,
        vendaId,
        modelo,
        qualidade,
        valor,
        formaPagamento,
        dataRecebimento,
      });
      await tx
        .update(contasReceberTable)
        .set({ closedAt: null })
        .where(eq(contasReceberTable.id, id));
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Não foi possível adicionar o item";
    res.status(409).json({ error: message });
    return;
  }
  res.json(await getContaResumo(id));
});

// Cria (ou reusa) conta por nome+tipo e adiciona um item de serviço (fiado sem peça)
router.post("/contas-receber/novo-servico", async (req, res): Promise<void> => {
  const nome = String(req.body?.nome ?? "").trim();
  const tipo = req.body?.tipo === "lojista" ? "lojista" : "cliente";
  const descricao = String(req.body?.descricao ?? "").trim();
  const valor = String(req.body?.valor ?? "").trim();
  const dataRecebimentoRaw = req.body?.dataRecebimento ? String(req.body.dataRecebimento) : null;
  const dataRecebimento = dataRecebimentoRaw ? new Date(dataRecebimentoRaw) : null;
  if (!nome) {
    res.status(400).json({ error: "Nome obrigatório" });
    return;
  }
  if (!descricao) {
    res.status(400).json({ error: "Descrição obrigatória" });
    return;
  }
  if (!valor || parseValor(valor) <= 0) {
    res.status(400).json({ error: "Valor inválido" });
    return;
  }
  const contaId = await findOrCreateConta(nome, tipo);
  await db.insert(contasReceberItensTable).values({
    contaId,
    modelo: descricao,
    qualidade: "Serviço",
    valor,
    dataRecebimento,
  });
  res.json(await getContaResumo(contaId));
});

// Apagar item da conta
router.delete("/contas-receber/itens/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const removido = await db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(contasReceberItensTable)
      .where(eq(contasReceberItensTable.id, id))
      .for("update");
    if (!item) return false;
    const [conta] = await tx
      .select()
      .from(contasReceberTable)
      .where(eq(contasReceberTable.id, item.contaId))
      .for("update");
    if (conta?.closedAt != null && item.vendaId) {
      await tx
        .update(vendasTable)
        .set({ tipo: "fiado_quitado" })
        .where(eq(vendasTable.id, item.vendaId));
    }
    await tx.delete(contasReceberItensTable).where(eq(contasReceberItensTable.id, id));
    if (conta?.closedAt == null && item.vendaId) {
      await restaurarEstoqueDaVenda(item.vendaId, tx);
    }
    return true;
  });
  if (!removido) {
    res.status(404).json({ error: "Item não encontrado" });
    return;
  }
  res.status(204).send();
});

// Apagar conta inteira
router.delete("/contas-receber/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  await db.transaction(async (tx) => {
    const [conta] = await tx
      .select()
      .from(contasReceberTable)
      .where(eq(contasReceberTable.id, id))
      .for("update");
    const itens = await tx
      .select()
      .from(contasReceberItensTable)
      .where(eq(contasReceberItensTable.contaId, id))
      .for("update");
    if (conta?.closedAt != null) {
      const vendasQuitadas = itens
        .map((item) => item.vendaId)
        .filter((vendaId): vendaId is number => vendaId != null);
      for (const vendaId of vendasQuitadas) {
        await tx
          .update(vendasTable)
          .set({ tipo: "fiado_quitado" })
          .where(eq(vendasTable.id, vendaId));
      }
    }
    // Remove as entradas de AV no caixa ligadas aos pagamentos desta conta.
    await tx.delete(caixaTable).where(
      sql`${caixaTable.pagamentoId} IN (SELECT id FROM ${contasReceberPagamentosTable} WHERE ${contasReceberPagamentosTable.contaId} = ${id})`,
    );
    await tx
      .delete(contasReceberPagamentosTable)
      .where(eq(contasReceberPagamentosTable.contaId, id));
    await tx
      .delete(contasReceberItensTable)
      .where(eq(contasReceberItensTable.contaId, id));
    if (conta?.closedAt == null) {
      for (const item of itens) {
        if (item.vendaId) await restaurarEstoqueDaVenda(item.vendaId, tx);
      }
    }
    await tx.delete(contasReceberTable).where(eq(contasReceberTable.id, id));
  });
  res.status(204).send();
});

export default router;
