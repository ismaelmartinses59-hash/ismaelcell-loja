import { Router, type IRouter } from "express";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { db, pecasTable, vendasTable, contasReceberItensTable, contasReceberPagamentosTable, caixaTable, devolucoesTable } from "@workspace/db";
import { findOrCreateConta } from "./contas-receber";
import { LABELS, normalizeForma, taxaFor, type FormaPagamento } from "../lib/formas-pagamento.js";
import { ai } from "@workspace/integrations-gemini-ai";

const router: IRouter = Router();

const QUALIDADES_TELA = ["Diamond", "Gold Pro", "NN", "WEFIX", "INCELL", "ORI CHINA"];
const PALAVRAS_GENERICAS_PECA = new Set([
  "TELA", "DISPLAY", "LCD", "TOUCH", "FRONTAL", "MODULO", "PECA",
  "BATERIA", "PLACA", "CONECTOR", "FLEX", "ARO",
]);

function tokensModelo(modelo: string): string[] {
  return modelo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((parte) => parte && !PALAVRAS_GENERICAS_PECA.has(parte));
}

function expansaoModeloSegura(modeloAntigo: string, modeloNovo: string): boolean {
  const antigo = tokensModelo(modeloAntigo);
  const novo = tokensModelo(modeloNovo);
  const chaveAntiga = antigo.join("");
  const chaveNova = novo.join("");
  const sequenciaExata = novo.some((_, inicio) =>
    antigo.every((token, deslocamento) => novo[inicio + deslocamento] === token),
  );
  return (
    chaveAntiga.length >= 3 &&
    chaveAntiga !== chaveNova &&
    /[A-Z]/.test(chaveAntiga) &&
    /\d/.test(chaveAntiga) &&
    sequenciaExata
  );
}

class ImportacaoInvalida extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

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
    '- "modelo": o nome COMPLETO da peça como está escrito. Preserve todos os aparelhos compatíveis e os separadores (ex: "TELA REALME C63/C61/NARZO N63/NOTE 60/NOTE 60X"). Não reduza uma lista de compatibilidade a um único modelo.',
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

/**
 * Normaliza o nome de uma peça usando IA e sugere modelos compatíveis.
 * Também encontra a peça existente mais similar no estoque.
 */
router.post("/pecas/normalizar-modelo", async (req, res): Promise<void> => {
  const modeloRaw = String(req.body?.modelo ?? "").trim();
  if (!modeloRaw) {
    res.status(400).json({ error: "modelo é obrigatório" });
    return;
  }
  const existentesRaw = Array.isArray(req.body?.existentes) ? req.body.existentes : [];
  const existentes = existentesRaw
    .map((e: unknown) => {
      const o = (e ?? {}) as Record<string, unknown>;
      return { id: Number(o.id), modelo: String(o.modelo ?? "").trim() };
    })
    .filter((e) => e.id && e.modelo);

  const prompt = [
    "Você é especialista em peças de celular (Samsung, Motorola, Xiaomi, iPhone etc.).",
    "",
    "TAREFA: O lojista digitou o nome de uma peça que veio do seu fornecedor.",
    "Normalize esse nome e identifique TODOS os modelos compatíveis com essa peça.",
    "",
    "Regras de normalização:",
    "1. Comece SEMPRE com o tipo de peça em maiúsculas (TELA, BATERIA, CÂMERA, etc.)",
    "2. Depois coloque a marca (Samsung, Motorola, etc.) se conhecida",
    "3. Liste TODOS os modelos compatíveis separados por espaço, usando nomenclatura oficial",
    "   (ex: A02S A03S A04I A03 — use S/I/E maiúsculo conforme o modelo oficial)",
    "4. Exemplo bom: 'Tela Samsung A02S A03S A04I A03'",
    "",
    `INPUT DO LOJISTA: "${modeloRaw}"`,
    "",
    "PEÇAS JÁ CADASTRADAS NO SISTEMA (use para encontrar a mais similar e os modelos que faltam):",
    JSON.stringify(existentes.map((e) => ({ id: e.id, modelo: e.modelo }))),
    "",
    "RETORNE APENAS JSON válido (sem markdown, sem explicações):",
    "{",
    '  "normalizado": "nome completo normalizado (ex: Tela Samsung A02S A03S A04I A03)",',
    '  "modelosCompativeis": ["A02S", "A03S", "A04I", "A03"],',
    '  "matchId": <número do id da peça existente mais similar, ou null se nenhuma for similar>,',
    '  "modelosFaltando": ["modelos", "que", "estão", "no", "normalizado", "mas", "faltam", "na", "peça", "existente"]',
    "}",
    "Se não encontrar nenhuma peça existente suficientemente similar, matchId deve ser null e modelosFaltando deve ser [].",
  ].join("\n");

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json", maxOutputTokens: 8192 },
    });
    const raw = response.text ?? "";
    let parsed: {
      normalizado: string;
      modelosCompativeis: string[];
      matchId: number | null;
      modelosFaltando: string[];
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      res.status(502).json({ error: "IA retornou resposta inválida. Tente novamente." });
      return;
    }
    res.json({
      normalizado: String(parsed.normalizado ?? "").trim(),
      modelosCompativeis: Array.isArray(parsed.modelosCompativeis) ? parsed.modelosCompativeis : [],
      matchId: typeof parsed.matchId === "number" ? parsed.matchId : null,
      modelosFaltando: Array.isArray(parsed.modelosFaltando) ? parsed.modelosFaltando : [],
    });
  } catch (err) {
    req.log.error({ err }, "normalizar-modelo falhou");
    res.status(500).json({ error: "Falha ao consultar a IA. Tente novamente." });
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
      correcaoPecaId: Number.isInteger(Number(o.correcaoPecaId)) && Number(o.correcaoPecaId) > 0
        ? Number(o.correcaoPecaId)
        : null,
      correcaoGemeaId: Number.isInteger(Number(o.correcaoGemeaId)) && Number(o.correcaoGemeaId) > 0
        ? Number(o.correcaoGemeaId)
        : null,
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
      let corrigidos = 0;
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
              sql`lower(trim(${pecasTable.qualidade})) = ${n.qualidade.toLowerCase().trim()}`,
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
        if (n.correcaoPecaId) {
          if (!n.correcaoGemeaId || n.correcaoGemeaId === n.correcaoPecaId) {
            throw new ImportacaoInvalida("O par Cliente/Lojista da correção é inválido.", 409);
          }
          // O lock serializa correções da mesma peça. A validação é repetida no
          // servidor: a sugestão visual nunca é aceita como fonte de verdade.
          for (const lockId of [n.correcaoPecaId, n.correcaoGemeaId].sort((a, b) => a - b)) {
            await tx.execute(sql`
              SELECT pg_advisory_xact_lock(hashtext('corrigir_modelo_peca'), ${lockId})
            `);
          }
          const [alvo] = await tx
            .select()
            .from(pecasTable)
            .where(eq(pecasTable.id, n.correcaoPecaId))
            .limit(1);
          if (!alvo) {
            throw new ImportacaoInvalida("A peça sugerida para correção não existe mais.", 409);
          }
          const modeloOriginal = alvo.modelo.trim();
          const qualidadeOriginal = alvo.qualidade.trim();
          await tx.execute(sql`
            SELECT pg_advisory_xact_lock(
              hashtext('corrigir_modelo_par'),
              hashtext(${`${modeloOriginal.toLowerCase()}|${qualidadeOriginal.toLowerCase()}`})
            )
          `);
          if (alvo.qualidade.trim().toLowerCase() !== n.qualidade.trim().toLowerCase()) {
            throw new ImportacaoInvalida("A correção sugerida tem qualidade diferente da peça existente.", 409);
          }

          const jaCorrigida = alvo.modelo.trim().toLowerCase() === n.modelo.trim().toLowerCase();
          if (!jaCorrigida && !expansaoModeloSegura(alvo.modelo, n.modelo)) {
            throw new ImportacaoInvalida("A correção de nome não passou pela validação de segurança.", 409);
          }

          if (!jaCorrigida) {
            const outroSetor = alvo.setor === "cliente" ? "lojista" : "cliente";
            const [gemea] = await tx
              .select()
              .from(pecasTable)
              .where(eq(pecasTable.id, n.correcaoGemeaId))
              .limit(1);
            if (
              !gemea ||
              gemea.setor !== outroSetor ||
              gemea.modelo.trim().toLowerCase() !== modeloOriginal.toLowerCase() ||
              gemea.qualidade.trim().toLowerCase() !== qualidadeOriginal.toLowerCase()
            ) {
              throw new ImportacaoInvalida(
                "A peça correspondente no outro setor não confere com a correção selecionada.",
                409,
              );
            }

            const alvos = [alvo, gemea];
            for (const item of alvos) {
              const [conflito] = await tx
                .select({ id: pecasTable.id })
                .from(pecasTable)
                .where(
                  and(
                    sql`lower(trim(${pecasTable.modelo})) = ${n.modelo.toLowerCase()}`,
                    sql`lower(trim(${pecasTable.qualidade})) = ${n.qualidade.toLowerCase()}`,
                    eq(pecasTable.setor, item.setor),
                    sql`${pecasTable.id} <> ${item.id}`,
                  ),
                )
                .limit(1);
              if (conflito) {
                throw new ImportacaoInvalida(
                  `O nome corrigido já pertence a outra peça no setor ${item.setor}. Revise a sugestão.`,
                  409,
                );
              }
            }

            await tx.update(pecasTable).set({ modelo: n.modelo }).where(eq(pecasTable.id, alvo.id));
            await tx.update(pecasTable).set({ modelo: n.modelo }).where(eq(pecasTable.id, gemea.id));
            corrigidos++;
          }
        }

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
      return { criados, somados, corrigidos };
    });
    res.status(201).json({
      cadastrados: resultado.criados + resultado.somados,
      criados: resultado.criados,
      somados: resultado.somados,
      corrigidos: resultado.corrigidos,
    });
  } catch (err) {
    if (err instanceof ImportacaoInvalida) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
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
  const parcial = req.body?.parcial === true;
  const nomeDevedor = String(req.body?.nomeDevedor ?? "").trim();
  const tipoDevedor = req.body?.tipoDevedor === "lojista" ? "lojista" : "cliente";
  // Forma de pagamento da venda à vista (dinheiro, PIX ou cartão). Só vale quando NÃO é fiado.
  const forma = (fiado || parcial) ? null : normalizeForma(req.body?.formaPagamento);
  // Splits de pagamento misto: [{ forma, valor }]
  const rawSplits = req.body?.splits;
  const splits: Array<{ forma: string; valor: string }> | null =
    Array.isArray(rawSplits) && rawSplits.length > 0 ? rawSplits : null;
  // Preço negociado (desconto/acréscimo) — usa o valor da peça se não informado.
  const valorCustomRaw = String(req.body?.valorCustom ?? "").trim();
  const valorVenda = valorCustomRaw || atual.valor;
  const valorVendaFinal = parseValorBR(valorVenda);
  const valorVendaCanonico = valorVendaFinal > 0 ? valorParaTexto(valorVendaFinal) : "";
  const valorPagoFinal = parseValorBR(req.body?.valorPago);
  const valorPagoCanonico = valorPagoFinal > 0 ? valorParaTexto(valorPagoFinal) : "";
  const dataPrevistaRaw = String(req.body?.dataPrevista ?? "").trim();
  const dataPrevistaCandidata = /^\d{4}-\d{2}-\d{2}$/.test(dataPrevistaRaw)
    ? new Date(`${dataPrevistaRaw}T12:00:00-03:00`)
    : null;
  const dataPrevista = dataPrevistaCandidata && !Number.isNaN(dataPrevistaCandidata.getTime())
    ? dataPrevistaCandidata
    : null;
  if (fiado && !nomeDevedor) {
    res.status(400).json({ error: "Nome do devedor obrigatório no fiado" });
    return;
  }
  if (!valorVendaCanonico || valorVendaFinal <= 0) {
    res.status(400).json({ error: "Valor total inválido" });
    return;
  }
  if (parcial && dataPrevistaRaw && !dataPrevista) {
    res.status(400).json({ error: "Data prevista inválida" });
    return;
  }
  const pagamentosParciais: Array<{ forma: FormaPagamento; valor: string }> = [];
  if (parcial) {
    if (!nomeDevedor) {
      res.status(400).json({ error: "Nome obrigatório na venda parcial" });
      return;
    }
    if (!valorPagoCanonico || valorPagoFinal <= 0) {
      res.status(400).json({ error: "Informe um valor pago maior que zero; para zero use A Receber manual" });
      return;
    }
    if (valorPagoFinal >= valorVendaFinal - 0.00001) {
      res.status(400).json({ error: "Para pagar o total, use a venda normal" });
      return;
    }
    if (req.body?.pagamentoMisto === true && !splits) {
      res.status(400).json({ error: "Adicione ao menos um split no pagamento misto" });
      return;
    }
    if (splits) {
      for (const split of splits) {
        const splitForma = normalizeForma(split?.forma);
        const splitValor = parseValorBR(split?.valor);
        if (!splitForma || splitValor <= 0) {
          res.status(400).json({ error: "Forma ou valor inválido no pagamento misto" });
          return;
        }
        pagamentosParciais.push({ forma: splitForma, valor: valorParaTexto(splitValor) });
      }
      const soma = pagamentosParciais.reduce((total, pagamento) => total + parseValorBR(pagamento.valor), 0);
      if (Math.abs(soma - valorPagoFinal) > 0.01) {
        res.status(400).json({ error: "A soma dos pagamentos deve ser igual ao valor pago" });
        return;
      }
    } else {
      const formaParcial = normalizeForma(req.body?.formaPagamento);
      if (!formaParcial) {
        res.status(400).json({ error: "Forma de pagamento inválida" });
        return;
      }
      pagamentosParciais.push({ forma: formaParcial, valor: valorPagoCanonico });
    }
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
        valor: valorVendaCanonico,
        tipo: parcial ? "fiado" : undefined,
      })
      .returning();
    if (fiado || parcial) {
      const contaId = await findOrCreateConta(nomeDevedor, tipoDevedor, tx);
      await tx.insert(contasReceberItensTable).values({
        contaId,
        vendaId: venda.id,
        modelo: atual.modelo,
        qualidade: atual.qualidade,
        valor: valorVendaCanonico,
        dataRecebimento: parcial ? dataPrevista : null,
      });
      if (parcial) {
        for (const pagamento of pagamentosParciais) {
          const [pagamentoCriado] = await tx.insert(contasReceberPagamentosTable).values({
            contaId,
            vendaId: venda.id,
            valor: pagamento.valor,
            formaPagamento: pagamento.forma,
          }).returning();
          await tx.insert(caixaTable).values({
            tipo: "entrada",
            valor: pagamento.valor,
            motivo: `Venda parcial ${atual.modelo} (${LABELS[pagamento.forma]})`,
            pecaId: id,
            vendaId: venda.id,
            pagamentoId: pagamentoCriado.id,
            modelo: atual.modelo,
            formaPagamento: pagamento.forma,
            taxaPercent: String(taxaFor(pagamento.forma)),
          });
        }
      }
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
    if (!fiado && !parcial) {
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
          valor: valorVenda,
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

router.post("/pecas/:id/uso-proprio", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const [atual] = await db.select().from(pecasTable).where(eq(pecasTable.id, id));
  if (!atual) { res.status(404).json({ error: "Peça não encontrada" }); return; }
  if (atual.quantidade <= 0) { res.status(400).json({ error: "Sem estoque disponível" }); return; }
  const custo = parseValorBR(atual.valorCusto);
  if (custo <= 0) {
    res.status(400).json({ error: "Cadastre o valor de custo da peça antes de registrar uso próprio" });
    return;
  }
  const formaRaw = normalizeForma(req.body?.formaPagamento);
  const forma = formaRaw === "pix" ? "pix" : formaRaw === "dinheiro" ? "dinheiro" : null;
  if (!forma) {
    res.status(400).json({ error: "Escolha dinheiro ou PIX para a saída" });
    return;
  }

  try {
    const peca = await db.transaction(async (tx) => {
      const [atualizada] = await tx
        .update(pecasTable)
        .set({ quantidade: sql`${pecasTable.quantidade} - 1` })
        .where(and(eq(pecasTable.id, id), sql`${pecasTable.quantidade} > 0`))
        .returning();
      if (!atualizada) throw new Error("Sem estoque disponível");

      const outroSetor = atual.setor === "cliente" ? "lojista" : "cliente";
      const gemeas = await tx.select().from(pecasTable).where(
        and(
          eq(pecasTable.setor, outroSetor),
          sql`LOWER(TRIM(${pecasTable.modelo})) = LOWER(TRIM(${atual.modelo}))`,
          sql`LOWER(TRIM(${pecasTable.qualidade})) = LOWER(TRIM(${atual.qualidade}))`,
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

      const valorCusto = valorParaTexto(custo);
      const [registro] = await tx.insert(vendasTable).values({
        pecaId: id,
        modelo: atual.modelo,
        qualidade: atual.qualidade,
        valor: valorCusto,
        tipo: "uso_proprio",
      }).returning();

      await tx.insert(caixaTable).values({
        tipo: "saida",
        valor: valorCusto,
        motivo: `Uso próprio: ${atual.modelo}`,
        pecaId: id,
        vendaId: registro.id,
        modelo: atual.modelo,
        formaPagamento: forma,
        taxaPercent: "0",
      });

      return atualizada;
    });
    res.json(peca);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Não foi possível registrar o uso próprio";
    res.status(409).json({ error: message });
  }
});

router.post("/pecas/:id/devolver", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const { fornecedor } = req.body;
  if (!fornecedor || !String(fornecedor).trim()) {
    res.status(400).json({ error: "Nome do fornecedor é obrigatório" }); return;
  }
  const [atual] = await db.select().from(pecasTable).where(eq(pecasTable.id, id));
  if (!atual) { res.status(404).json({ error: "Peça não encontrada" }); return; }
  if (atual.quantidade <= 0) { res.status(400).json({ error: "Sem estoque para devolver" }); return; }

  const result = await db.transaction(async (tx) => {
    const [peca] = await tx
      .update(pecasTable)
      .set({ quantidade: atual.quantidade - 1 })
      .where(eq(pecasTable.id, id))
      .returning();

    // Estoque compartilhado: decrementa também a gêmea no outro setor
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

    // Registra a devolução no histórico
    await tx.insert(devolucoesTable).values({
      pecaId: id,
      modelo: atual.modelo,
      qualidade: atual.qualidade,
      valor: atual.valor || null,
      valorCusto: atual.valorCusto || null,
      fornecedor: String(fornecedor).trim(),
    });

    return peca;
  });

  res.json(result);
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
