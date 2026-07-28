import { Router, type IRouter } from "express";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { db, pecasTable, vendasTable, contasReceberItensTable, caixaTable } from "@workspace/db";
import { findOrCreateConta } from "./contas-receber";
import { LABELS, normalizeForma, taxaFor } from "../lib/formas-pagamento.js";
import { ai } from "@workspace/integrations-gemini-ai";

const router: IRouter = Router();

const QUALIDADES_TELA = ["Diamond", "Gold Pro", "NN", "WEFIX", "INCELL", "ORI CHINA"];

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
/**
 * Só "dinheiro"/"pix" disparam a saída de investimento no caixa; qualquer outra
 * coisa (ou ausência) devolve null e NÃO lança nada. É assim que o cadastro de
 * peça vira (ou não) uma saída: o frontend manda a forma escolhida pelo usuário.
 */
function formaInvestimentoSaida(raw: unknown): "dinheiro" | "pix" | null {
  const f = normalizeForma(raw);
  return f === "pix" ? "pix" : f === "dinheiro" ? "dinheiro" : null;
}

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
    const resultado = await db.transaction(async (tx) => {
      let criados = 0;
      let somados = 0;
      // Cada item vira um par de gêmeos (cliente + lojista). Se já existir uma
      // peça com o MESMO modelo (ignorando maiúsc./espaços) + qualidade + setor,
      // apenas SOMA a quantidade no estoque existente — não cria cópia.
      const upsertSetor = async (
        setor: "cliente" | "lojista",
        valor: string,
        n: (typeof normalizados)[number],
      ) => {
        const [existente] = await tx
          .select()
          .from(pecasTable)
          .where(
            and(
              sql`lower(trim(${pecasTable.modelo})) = ${n.modelo.toLowerCase()}`,
              eq(pecasTable.qualidade, n.qualidade),
              eq(pecasTable.setor, setor),
            ),
          )
          .orderBy(pecasTable.id) // se houver duplicatas antigas, soma sempre na mais antiga (determinístico)
          .limit(1);
        if (existente) {
          // Incremento atômico (quantidade = quantidade + n) para não perder soma.
          await tx
            .update(pecasTable)
            .set({ quantidade: sql`${pecasTable.quantidade} + ${n.quantidade}` })
            .where(eq(pecasTable.id, existente.id));
          return "somado" as const;
        }
        await tx.insert(pecasTable).values({
          modelo: n.modelo, qualidade: n.qualidade, valor,
          valorCusto: n.valorCusto, quantidade: n.quantidade, setor,
        });
        return "criado" as const;
      };
      for (const n of normalizados) {
        // O status (novo vs. já existia) é decidido pelo lado CLIENTE; o gêmeo
        // lojista acompanha para manter os dois em sincronia.
        const r = await upsertSetor("cliente", n.valorCliente, n);
        await upsertSetor("lojista", n.valorLojista, n);
        if (r === "somado") somados++; else criados++;
      }
      // Investimento da nota vira UMA saída no caixa (soma do custo × qtd de
      // todos os itens). Fica DENTRO da transação: ou grava tudo, ou nada.
      const formaSaida = formaInvestimentoSaida(req.body?.formaInvestimento);
      const totalCusto = normalizados.reduce(
        (s, n) => s + parseValorBR(n.valorCusto) * n.quantidade,
        0,
      );
      if (formaSaida && totalCusto > 0) {
        await tx.insert(caixaTable).values({
          tipo: "saida",
          valor: valorParaTexto(totalCusto),
          motivo: "Compra de peças (nota do fornecedor)",
          formaPagamento: formaSaida,
          taxaPercent: "0",
        });
      }
      return { criados, somados };
    });
    res.status(201).json({ cadastrados: resultado.criados + resultado.somados, criados: resultado.criados, somados: resultado.somados });
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
  const { modelo, qualidade, valor, valorCusto, quantidade, setor, formaInvestimento } = req.body;
  if (!modelo || !qualidade || !valor) {
    res.status(400).json({ error: "modelo, qualidade e valor são obrigatórios" });
    return;
  }
  const setorFinal = setor === "cliente" ? "cliente" : "lojista";
  const qtd = parseInt(quantidade) || 0;
  const peca = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(pecasTable)
      .values({
        modelo: String(modelo),
        qualidade: String(qualidade),
        valor: String(valor),
        valorCusto: valorCusto != null ? String(valorCusto) : "",
        quantidade: qtd,
        setor: setorFinal,
      })
      .returning();
    // Investimento vira saída no caixa (só quando o frontend manda a forma).
    const forma = formaInvestimentoSaida(formaInvestimento);
    const totalCusto = parseValorBR(valorCusto) * qtd;
    if (forma && totalCusto > 0) {
      await tx.insert(caixaTable).values({
        tipo: "saida",
        valor: valorParaTexto(totalCusto),
        motivo: `Compra de estoque: ${String(modelo)}${qtd > 1 ? ` (${qtd}x)` : ""}`,
        formaPagamento: forma,
        taxaPercent: "0",
        modelo: String(modelo),
      });
    }
    return p;
  });
  res.status(201).json(peca);
});

router.post("/pecas/twin", async (req, res): Promise<void> => {
  const { modelo, qualidade, valorCliente, valorLojista, valorCusto, quantidade, formaInvestimento } = req.body;
  if (!modelo || !qualidade || !valorCliente || !valorLojista) {
    res.status(400).json({ error: "modelo, qualidade, valorCliente e valorLojista são obrigatórios" });
    return;
  }
  try {
    const qtd = parseInt(quantidade) || 0;
    const [cliente, lojista] = await db.transaction(async (tx) => {
      const [c] = await tx.insert(pecasTable).values({
        modelo: String(modelo),
        qualidade: String(qualidade),
        valor: String(valorCliente),
        valorCusto: valorCusto != null ? String(valorCusto) : "",
        quantidade: qtd,
        setor: "cliente",
      }).returning();
      const [l] = await tx.insert(pecasTable).values({
        modelo: String(modelo),
        qualidade: String(qualidade),
        valor: String(valorLojista),
        valorCusto: valorCusto != null ? String(valorCusto) : "",
        quantidade: qtd,
        setor: "lojista",
      }).returning();
      // As gêmeas representam o MESMO estoque físico (qtd), então o custo do
      // investimento é custo × qtd (uma vez só, não vezes dois).
      const forma = formaInvestimentoSaida(formaInvestimento);
      const totalCusto = parseValorBR(valorCusto) * qtd;
      if (forma && totalCusto > 0) {
        await tx.insert(caixaTable).values({
          tipo: "saida",
          valor: valorParaTexto(totalCusto),
          motivo: `Compra de estoque: ${String(modelo)}${qtd > 1 ? ` (${qtd}x)` : ""}`,
          formaPagamento: forma,
          taxaPercent: "0",
          modelo: String(modelo),
        });
      }
      return [c, l];
    });
    res.status(201).json({ cliente, lojista });
  } catch (err) {
    req.log.error({ err }, "twin create failed");
    res.status(500).json({ error: "Falha ao criar peças (nada foi salvo)" });
  }
});

// Adiciona unidades a uma peça já existente + lança saída no caixa (opcional).
router.post("/pecas/:id/adicionar-estoque", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const { quantidade, valorCusto, formaInvestimento } = req.body;
  const qtd = parseInt(quantidade) || 0;
  if (qtd < 1) { res.status(400).json({ error: "Quantidade deve ser ≥ 1" }); return; }
  try {
    const peca = await db.transaction(async (tx) => {
      const [atual] = await tx.select().from(pecasTable).where(eq(pecasTable.id, id));
      if (!atual) return null;
      const novaQtd = atual.quantidade + qtd;
      const [atualizada] = await tx
        .update(pecasTable)
        .set({ quantidade: novaQtd, ...(valorCusto != null ? { valorCusto: String(valorCusto) } : {}) })
        .where(eq(pecasTable.id, id))
        .returning();
      // Espelha na gêmea (twin invariant)
      await tx
        .update(pecasTable)
        .set({ quantidade: novaQtd })
        .where(
          and(
            eq(pecasTable.setor, atual.setor === "cliente" ? "lojista" : "cliente"),
            sql`LOWER(TRIM(${pecasTable.modelo})) = LOWER(TRIM(${atual.modelo}))`,
            sql`LOWER(TRIM(${pecasTable.qualidade})) = LOWER(TRIM(${atual.qualidade}))`,
          ),
        );
      // Saída no caixa se o usuário escolheu forma de investimento
      const forma = formaInvestimentoSaida(formaInvestimento);
      const totalCusto = parseValorBR(valorCusto) * qtd;
      if (forma && totalCusto > 0) {
        await tx.insert(caixaTable).values({
          tipo: "saida",
          valor: valorParaTexto(totalCusto),
          motivo: `Compra de estoque: ${atual.modelo}${qtd > 1 ? ` (${qtd}x)` : ""}`,
          formaPagamento: forma,
          taxaPercent: "0",
          modelo: atual.modelo,
        });
      }
      return atualizada;
    });
    if (!peca) { res.status(404).json({ error: "Peça não encontrada" }); return; }
    res.json(peca);
  } catch (err) {
    req.log.error({ err }, "adicionar-estoque failed");
    res.status(500).json({ error: "Falha ao adicionar estoque (nada foi salvo)" });
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
  // Splits de pagamento misto: [{ forma, valor }]
  const rawSplits = req.body?.splits;
  const splits: Array<{ forma: string; valor: string }> | null =
    Array.isArray(rawSplits) && rawSplits.length > 0 ? rawSplits : null;
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
    if (!fiado) {
      if (splits && splits.length > 0) {
        // Pagamento misto: uma entrada no caixa por split
        for (const split of splits) {
          const splitForma = normalizeForma(split.forma);
          if (splitForma) {
            await tx.insert(caixaTable).values({
              tipo: "entrada",
              valor: split.valor,
              motivo: `Venda ${atual.modelo} (Misto · ${LABELS[splitForma]})`,
              pecaId: id,
              vendaId: venda.id,
              modelo: atual.modelo,
              formaPagamento: splitForma,
              taxaPercent: String(taxaFor(splitForma)),
            });
          }
        }
      } else if (forma) {
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
    // Estoque compartilhado: apaga também a peça gêmea no outro setor, senão a
    // gêmea continua aparecendo na busca do caixa (que junta os dois setores).
    const outroSetor = deleted.setor === "cliente" ? "lojista" : "cliente";
    await db
      .delete(pecasTable)
      .where(
        and(
          eq(pecasTable.setor, outroSetor),
          sql`LOWER(TRIM(${pecasTable.modelo})) = LOWER(TRIM(${deleted.modelo}))`,
          sql`LOWER(TRIM(${pecasTable.qualidade})) = LOWER(TRIM(${deleted.qualidade}))`,
        ),
      );
  res.status(204).send();
});

export default router;
