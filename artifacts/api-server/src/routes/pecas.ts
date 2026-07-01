import { Router, type IRouter } from "express";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { db, pecasTable, vendasTable, contasReceberItensTable, caixaTable } from "@workspace/db";
import { findOrCreateConta } from "./contas-receber";
import { LABELS, normalizeForma, taxaFor } from "../lib/formas-pagamento.js";
import { ai } from "@workspace/integrations-gemini-ai";

const router: IRouter = Router();

const QUALIDADES_TELA = ["Diamond", "Gold Pro", "NN", "WEFIX", "INCELL", "ORI CHINA"];

// Lê a foto/PDF da nota do fornecedor e devolve os itens (modelo, quantidade,
// custo unitário e qualidade quando aparecer). NÃO grava nada — só interpreta.
router.post("/pecas/importar-nota", async (req, res): Promise<void> => {
  const { fileBase64, mimeType } = req.body ?? {};
  if (!fileBase64 || typeof fileBase64 !== "string") {
    res.status(400).json({ error: "Envie a foto ou PDF da nota (fileBase64)" });
    return;
  }
  const mt = typeof mimeType === "string" && mimeType ? mimeType : "image/jpeg";
  if (!mt.startsWith("image/") && mt !== "application/pdf") {
    res.status(400).json({ error: "Envie uma imagem (foto) ou um PDF da nota." });
    return;
  }
  // Gemini inline data suporta ~8MB. base64 decodifica p/ ~3/4 do tamanho.
  const approxBytes = Math.floor((fileBase64.length * 3) / 4);
  if (approxBytes > 7.5 * 1024 * 1024) {
    res.status(413).json({ error: "Arquivo muito grande. Tire uma foto menor ou compacte o PDF (máx ~7MB)." });
    return;
  }
  const prompt = [
    "Você recebe a NOTA/PEDIDO de um fornecedor de peças de celular (telas/displays, baterias etc).",
    "Extraia CADA item da nota. Para cada item devolva:",
    '- "modelo": o modelo do aparelho/peça como está escrito (ex: "A03", "Redmi Note 11", "MOTO G35", "iPhone 11"). Mantenha o nome curto e limpo.',
    '- "quantidade": número inteiro de unidades daquele item (se não achar, use 1).',
    '- "custo": o valor UNITÁRIO em reais que aparece na nota, só números com ponto decimal (ex: "85.00"). Se não houver, use "".',
    `- "qualidade": SE a nota indicar a qualidade da tela, escolha a mais próxima desta lista: ${QUALIDADES_TELA.join(", ")}. Se não indicar, use "".`,
    'Responda APENAS um JSON no formato: { "itens": [ { "modelo": "", "quantidade": 1, "custo": "", "qualidade": "" } ] }.',
    "Não invente itens que não estão na nota. Não adicione comentários.",
  ].join("\n");
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: mt, data: fileBase64 } },
            { text: prompt },
          ],
        },
      ],
      config: { responseMimeType: "application/json", maxOutputTokens: 8192 },
    });
    const raw = response.text ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      req.log.error({ raw }, "importar-nota: JSON inválido da IA");
      res.status(502).json({ error: "Não consegui ler a nota. Tente uma foto mais nítida." });
      return;
    }
    const itensRaw = Array.isArray(parsed)
      ? parsed
      : (parsed as { itens?: unknown })?.itens;
    if (!Array.isArray(itensRaw)) {
      res.status(502).json({ error: "Não encontrei itens na nota." });
      return;
    }
    const itens = itensRaw
      .map((it) => {
        const o = (it ?? {}) as Record<string, unknown>;
        const modelo = String(o.modelo ?? "").trim();
        if (!modelo) return null;
        const qtdNum = parseInt(String(o.quantidade ?? "1"), 10);
        const custoStr = String(o.custo ?? "").replace(",", ".").replace(/[^0-9.]/g, "");
        const qualRaw = String(o.qualidade ?? "").trim();
        const qualidade = QUALIDADES_TELA.find((q) => q.toLowerCase() === qualRaw.toLowerCase()) ?? "";
        return {
          modelo,
          quantidade: Number.isFinite(qtdNum) && qtdNum > 0 ? qtdNum : 1,
          custo: custoStr,
          qualidade,
        };
      })
      .filter((x): x is { modelo: string; quantidade: number; custo: string; qualidade: string } => x !== null);
    res.json({ itens });
  } catch (err) {
    req.log.error({ err }, "importar-nota falhou");
    res.status(500).json({ error: "Falha ao ler a nota do fornecedor." });
  }
});

// Cadastra em lote os itens confirmados na prévia. Cada item vira um par de
// peças (cliente + lojista), tudo numa única transação (ou salva tudo ou nada).
router.post("/pecas/importar/confirmar", async (req, res): Promise<void> => {
  const itens = (req.body?.itens ?? []) as unknown[];
  if (!Array.isArray(itens) || itens.length === 0) {
    res.status(400).json({ error: "Nenhum item para cadastrar" });
    return;
  }
  const normalizados = itens.map((it) => {
    const o = (it ?? {}) as Record<string, unknown>;
    return {
      modelo: String(o.modelo ?? "").trim(),
      qualidade: String(o.qualidade ?? "").trim(),
      valorCusto: String(o.valorCusto ?? "").trim(),
      valorCliente: String(o.valorCliente ?? "").trim(),
      valorLojista: String(o.valorLojista ?? "").trim(),
      quantidade: parseInt(String(o.quantidade ?? "0"), 10) || 0,
    };
  });
  const invalido = normalizados.find((n) => !n.modelo || !n.qualidade || !n.valorCliente || !n.valorLojista || n.quantidade < 1);
  if (invalido) {
    res.status(400).json({ error: "Todos os itens precisam de modelo, qualidade, quantidade (mín. 1) e os dois preços" });
    return;
  }
  try {
    const total = await db.transaction(async (tx) => {
      let count = 0;
      for (const n of normalizados) {
        await tx.insert(pecasTable).values({
          modelo: n.modelo, qualidade: n.qualidade, valor: n.valorCliente,
          valorCusto: n.valorCusto, quantidade: n.quantidade, setor: "cliente",
        });
        await tx.insert(pecasTable).values({
          modelo: n.modelo, qualidade: n.qualidade, valor: n.valorLojista,
          valorCusto: n.valorCusto, quantidade: n.quantidade, setor: "lojista",
        });
        count++;
      }
      return count;
    });
    res.status(201).json({ cadastrados: total });
  } catch (err) {
    req.log.error({ err }, "importar/confirmar falhou");
    res.status(500).json({ error: "Falha ao cadastrar as peças (nada foi salvo)" });
  }
});

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
  // Forma de pagamento da venda à vista (dinheiro, PIX ou cartão). Só vale quando NÃO é fiado.
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
    // Toda venda à vista (dinheiro, PIX ou cartão) entra automaticamente no
    // caixa, vinculada à venda+peça, para que excluir a movimentação reverta
    // estoque e venda. Dinheiro e PIX têm taxa 0; cartão carrega a taxa.
    // Só o fiado NÃO gera entrada (vira conta a receber).
    if (!fiado && forma) {
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
