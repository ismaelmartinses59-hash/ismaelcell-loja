import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, caixaSessoesTable, caixaTable } from "@workspace/db";
import {
  type FormaPagamento,
  LABELS,
  isCartao,
  liquido,
  normalizeForma,
  taxaFor,
} from "../lib/formas-pagamento.js";

const router: IRouter = Router();

const TZ = "America/Sao_Paulo";

/** Converte valor monetário em texto (pt-BR) para número. */
function parseValor(raw: string): number {
  let s = String(raw).replace(/[^\d.,-]/g, "");
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/** Formata número como texto pt-BR "1.234,56". */
function formatValor(n: number): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Data de "hoje" no fuso de São Paulo (YYYY-MM-DD), independente do fuso do servidor/dispositivo. */
function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
  }).format(new Date());
}

interface CartaoItem {
  forma: FormaPagamento;
  label: string;
  taxa: number;
  bruto: number;
  liquido: number;
}

interface TotaisDia {
  /** Todas as entradas (dinheiro + PIX + cartão bruto). */
  totalEntradas: number;
  /** Entradas em dinheiro vivo (o que realmente vai pra gaveta). */
  entradasDinheiro: number;
  /** Entradas em PIX (cai na conta, NÃO fica na gaveta). */
  entradasPix: number;
  totalSaidas: number;
  /** Detalhe por forma de cartão (só as que tiveram movimento). */
  cartao: CartaoItem[];
  totalCartaoBruto: number;
  totalCartaoLiquido: number;
}

/** Soma entradas e saídas do caixa para um dia (no fuso de São Paulo),
 *  separando dinheiro de cartão (e detalhando o cartão por forma). */
async function totaisDoDia(data: string): Promise<TotaisDia> {
  const rows = await db
    .select({
      tipo: caixaTable.tipo,
      valor: caixaTable.valor,
      formaPagamento: caixaTable.formaPagamento,
    })
    .from(caixaTable)
    .where(
      sql`(${caixaTable.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE ${TZ})::date = ${data}::date`,
    );

  let totalEntradas = 0;
  let entradasDinheiro = 0;
  let entradasPix = 0;
  let totalSaidas = 0;
  const cartaoMap = new Map<FormaPagamento, { bruto: number }>();

  for (const r of rows) {
    const n = parseValor(r.valor);
    if (r.tipo !== "entrada") {
      totalSaidas += n;
      continue;
    }
    totalEntradas += n;
    const forma = normalizeForma(r.formaPagamento);
    if (isCartao(forma) && forma) {
      const prev = cartaoMap.get(forma)?.bruto ?? 0;
      cartaoMap.set(forma, { bruto: prev + n });
    } else if (forma === "pix") {
      entradasPix += n;
    } else {
      // dinheiro vivo (ou legado sem forma) → vai pra gaveta
      entradasDinheiro += n;
    }
  }

  const cartao: CartaoItem[] = [];
  let totalCartaoBruto = 0;
  let totalCartaoLiquido = 0;
  for (const [forma, { bruto }] of cartaoMap) {
    const liq = liquido(bruto, forma);
    cartao.push({
      forma,
      label: LABELS[forma],
      taxa: taxaFor(forma),
      bruto,
      liquido: liq,
    });
    totalCartaoBruto += bruto;
    totalCartaoLiquido += liq;
  }
  cartao.sort((a, b) => a.forma.localeCompare(b.forma));

  return {
    totalEntradas,
    entradasDinheiro,
    entradasPix,
    totalSaidas,
    cartao,
    totalCartaoBruto,
    totalCartaoLiquido,
  };
}

/** Sessão do dia + totais ao vivo. */
router.get("/caixa-sessoes", async (req, res): Promise<void> => {
  const raw = String(req.query.data ?? "").trim();
  const data = DATA_RE.test(raw) ? raw : hojeSP();
  const [sessao] = await db
    .select()
    .from(caixaSessoesTable)
    .where(eq(caixaSessoesTable.data, data));
  const t = await totaisDoDia(data);
  res.json({
    sessao: sessao ?? null,
    totalEntradas: t.totalEntradas,
    entradasDinheiro: t.entradasDinheiro,
    entradasPix: t.entradasPix,
    totalSaidas: t.totalSaidas,
    saldo: t.totalEntradas - t.totalSaidas,
    cartao: t.cartao,
    totalCartao: t.totalCartaoBruto,
    totalCartaoLiquido: t.totalCartaoLiquido,
  });
});

/** Histórico de fechamentos (mais recentes primeiro). */
router.get("/caixa-sessoes/historico", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(caixaSessoesTable)
    .orderBy(sql`${caixaSessoesTable.data} desc`);
  res.json(rows);
});

/** Abrir o caixa do dia com o valor inicial (troco). */
router.post("/caixa-sessoes/abrir", async (req, res): Promise<void> => {
  const data = hojeSP();
  const valorInicial = String(req.body?.valorInicial ?? "").trim();
  if (!valorInicial) {
    res.status(400).json({ error: "valorInicial é obrigatório" });
    return;
  }
  const [existente] = await db
    .select()
    .from(caixaSessoesTable)
    .where(eq(caixaSessoesTable.data, data));
  if (existente) {
    res.status(409).json({ error: "O caixa de hoje já foi aberto" });
    return;
  }
  const [sessao] = await db
    .insert(caixaSessoesTable)
    .values({ data, status: "aberto", valorInicial })
    .returning();
  res.status(201).json(sessao);
});

/** Fechar o caixa do dia: calcula totais e o valor final.
 *  Opcionalmente aceita `valorContado` = quanto o funcionário realmente
 *  contou na gaveta (para corrigir entradas/saídas esquecidas). */
router.post("/caixa-sessoes/fechar", async (req, res): Promise<void> => {
  const data = hojeSP();
  const [sessao] = await db
    .select()
    .from(caixaSessoesTable)
    .where(eq(caixaSessoesTable.data, data));
  if (!sessao) {
    res.status(404).json({ error: "O caixa de hoje ainda não foi aberto" });
    return;
  }
  if (sessao.status === "fechado") {
    res.status(409).json({ error: "O caixa de hoje já foi fechado" });
    return;
  }
  const t = await totaisDoDia(data);
  const valorInicial = parseValor(sessao.valorInicial);
  // O valor esperado na GAVETA usa só o dinheiro (cartão não entra na gaveta).
  const valorFinal = valorInicial + t.entradasDinheiro - t.totalSaidas;
  const contadoRaw = String(req.body?.valorContado ?? "").trim();
  const valorContado = contadoRaw ? formatValor(parseValor(contadoRaw)) : null;
  const [atualizada] = await db
    .update(caixaSessoesTable)
    .set({
      status: "fechado",
      fechamentoAt: new Date(),
      totalEntradas: formatValor(t.totalEntradas),
      totalSaidas: formatValor(t.totalSaidas),
      totalCartao: formatValor(t.totalCartaoBruto),
      totalCartaoLiquido: formatValor(t.totalCartaoLiquido),
      valorFinal: formatValor(valorFinal),
      valorContado,
    })
    .where(eq(caixaSessoesTable.id, sessao.id))
    .returning();
  res.json({ ...atualizada, cartao: t.cartao });
});

export default router;
