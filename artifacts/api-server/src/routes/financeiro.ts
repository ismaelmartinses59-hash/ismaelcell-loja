import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  appConfigTable,
  caixaTable,
  caixaSessoesTable,
  pecasTable,
} from "@workspace/db";

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

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Data de "hoje" no fuso de São Paulo (YYYY-MM-DD). */
function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

/**
 * Chaves da configuração financeira (guardadas em app_config) + valores padrão.
 * Os padrões são os valores que o dono informou; ele pode editar a qualquer hora.
 */
const CHAVES = {
  percentualSalario: { key: "fin_percentual_salario", def: "30" },
  diasTrabalhados: { key: "fin_dias_trabalhados", def: "24" },
  custoAluguel: { key: "fin_custo_aluguel", def: "400" },
  custoEnergia: { key: "fin_custo_energia", def: "50" },
  custoInternet: { key: "fin_custo_internet", def: "85" },
  custoAgua: { key: "fin_custo_agua", def: "0" },
  // Dia do mês em que cada conta vence (1-28)
  diaAluguel: { key: "fin_dia_aluguel", def: "7" },
  diaEnergia: { key: "fin_dia_energia", def: "7" },
  diaInternet: { key: "fin_dia_internet", def: "7" },
  diaAgua: { key: "fin_dia_agua", def: "7" },
} as const;

/** Conta personalizada criada pelo usuário (além das 4 fixas). */
export interface ContaExtra {
  id: string;
  nome: string;
  valor: string;        // texto pt-BR, ex: "1.133,33"
  pagoEm: string | null; // "YYYY-MM-DD" ou null
  diaVencimento: number | null; // dia do mês (1-28) em que a conta vence
}

const EXTRAS_KEY = "fin_contas_extras";

async function lerExtras(): Promise<ContaExtra[]> {
  const [row] = await db.select().from(appConfigTable).where(eq(appConfigTable.key, EXTRAS_KEY));
  if (!row?.value) return [];
  try { return JSON.parse(row.value) as ContaExtra[]; } catch { return []; }
}

async function salvarExtras(tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0], extras: ContaExtra[]) {
  const value = JSON.stringify(extras);
  await (tx as typeof db).insert(appConfigTable)
    .values({ key: EXTRAS_KEY, value })
    .onConflictDoUpdate({ target: appConfigTable.key, set: { value, updatedAt: new Date() } });
}

type ConfigCampo = keyof typeof CHAVES;

async function lerConfig(): Promise<Record<ConfigCampo, string>> {
  const rows = await db.select().from(appConfigTable);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<ConfigCampo, string>;
  for (const campo of Object.keys(CHAVES) as ConfigCampo[]) {
    out[campo] = map.get(CHAVES[campo].key) ?? CHAVES[campo].def;
  }
  return out;
}

/** As quatro contas fixas que têm botão "já paguei" + acúmulo próprio. */
const CONTAS = ["aluguel", "energia", "internet", "agua"] as const;
type Conta = (typeof CONTAS)[number];

/** Chave em app_config que guarda a data do último pagamento de cada conta. */
const PAGO_KEYS: Record<Conta, string> = {
  aluguel: "fin_pago_aluguel",
  energia: "fin_pago_energia",
  internet: "fin_pago_internet",
  agua: "fin_pago_agua",
};

/** Dia do mês padrão para o ciclo de contas (quando o usuário não configurou). */
const DIA_CICLO = 7;

/** Lê a data do último pagamento de cada conta (ou null se nunca pago). */
async function lerPagos(): Promise<Record<Conta, string | null>> {
  const rows = await db.select().from(appConfigTable);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<Conta, string | null>;
  for (const c of CONTAS) {
    const v = map.get(PAGO_KEYS[c]);
    out[c] = v && DATA_RE.test(v) ? v : null;
  }
  return out;
}

/**
 * Data-âncora a partir da qual contamos os dias trabalhados de uma conta:
 *  - Já paga → conta os dias trabalhados DEPOIS do pagamento (reinicia do zero).
 *  - Nunca paga → conta a partir do dia de vencimento configurado (padrão: dia 7).
 */
function ancoraDaConta(pagoEm: string | null, diaCiclo: number = DIA_CICLO): {
  anchor: string;
  exclusive: boolean;
} {
  if (pagoEm && DATA_RE.test(pagoEm)) return { anchor: pagoEm, exclusive: true };
  const dia = Math.min(28, Math.max(1, Math.round(diaCiclo)));
  const [y, m, d] = hojeSP().split("-").map(Number);
  let ay = y;
  let am = m;
  if (d < dia) {
    am -= 1;
    if (am === 0) {
      am = 12;
      ay -= 1;
    }
  }
  const anchor = `${ay}-${String(am).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  return { anchor, exclusive: false };
}

/** Conta quantos dias o caixa foi aberto desde a âncora (dias trabalhados no ciclo). */
async function contarDiasDesde(
  anchor: string,
  exclusive: boolean,
): Promise<number> {
  const cond = exclusive
    ? sql`${caixaSessoesTable.data} > ${anchor}`
    : sql`${caixaSessoesTable.data} >= ${anchor}`;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(caixaSessoesTable)
    .where(cond);
  return row?.n ?? 0;
}

/** Mapa: conta fixa → campo de dia configurado. */
const DIA_KEY: Record<Conta, keyof typeof CHAVES> = {
  aluguel: "diaAluguel",
  energia: "diaEnergia",
  internet: "diaInternet",
  agua: "diaAgua",
};

/** Lê os valores editáveis + o status/acúmulo de cada conta fixa. */
router.get("/financeiro/config", async (_req, res): Promise<void> => {
  const cfg = await lerConfig();
  const pagos = await lerPagos();
  const contas = {} as Record<Conta, { pagoEm: string | null; diasContados: number; diaVencimento: number }>;
  for (const c of CONTAS) {
    const diaVencimento = Math.min(28, Math.max(1, parseInt(cfg[DIA_KEY[c]] as string, 10) || DIA_CICLO));
    const { anchor, exclusive } = ancoraDaConta(pagos[c], diaVencimento);
    contas[c] = { pagoEm: pagos[c], diasContados: await contarDiasDesde(anchor, exclusive), diaVencimento };
  }
  // Contas extras: enriquecer com diasContados (mesmo cálculo usando diaVencimento)
  const extras = await lerExtras();
  const extrasComDias = await Promise.all(
    extras.map(async (e) => {
      const dia = e.diaVencimento ?? DIA_CICLO;
      const { anchor, exclusive } = ancoraDaConta(e.pagoEm, dia);
      return { ...e, diasContados: await contarDiasDesde(anchor, exclusive) };
    }),
  );
  res.json({ ...cfg, contas, contasExtras: extrasComDias });
});

/** Nomes legíveis das contas fixas para o motivo da saída no caixa. */
const CONTA_LABEL: Record<Conta, string> = {
  aluguel: "Aluguel",
  energia: "Energia",
  internet: "Internet",
  agua: "Água",
};

/** Marca (ou desmarca) uma conta fixa como paga hoje.
 *  Ao marcar: reinicia o acúmulo E lança uma saída no caixa com o valor configurado.
 *  Bloqueia duplicata: se já estiver paga, retorna 409. */
router.post("/financeiro/pagar", async (req, res): Promise<void> => {
  const conta = String(req.body?.conta ?? "") as Conta;
  if (!CONTAS.includes(conta)) {
    res.status(400).json({ error: "conta inválida" });
    return;
  }
  const marcandoPago = req.body?.pago !== false;

  // Guarda anti-duplicata: se já está marcada como paga, rejeita nova marcação
  if (marcandoPago) {
    const pagos = await lerPagos();
    if (pagos[conta]) {
      res.status(409).json({
        error: "Esta conta já foi registrada como paga e a saída financeira já foi lançada.",
      });
      return;
    }
  }

  const value = marcandoPago ? hojeSP() : "";

  await db.transaction(async (tx) => {
    // 1) Atualiza a data de pagamento
    await tx
      .insert(appConfigTable)
      .values({ key: PAGO_KEYS[conta], value })
      .onConflictDoUpdate({ target: appConfigTable.key, set: { value, updatedAt: new Date() } });

    // 2) Ao marcar como pago: lança saída automática no caixa
    if (marcandoPago) {
      const cfg = await lerConfig();
      const chaveValor = `custo${conta.charAt(0).toUpperCase()}${conta.slice(1)}` as ConfigCampo;
      const valorNum = parseValor(cfg[chaveValor] ?? "0");
      if (valorNum > 0) {
        const valorFmt = valorNum.toFixed(2).replace(".", ",");
        await tx.insert(caixaTable).values({
          tipo: "saida",
          valor: valorFmt,
          motivo: CONTA_LABEL[conta],
          formaPagamento: "dinheiro",
        });
      }
    }
  });

  res.json({ ok: true });
});

/** Marca (ou desmarca) uma conta EXTRA como paga hoje.
 *  Ao marcar: lança saída automática no caixa com o valor da conta.
 *  Bloqueia duplicata: se já estiver paga, retorna 409. */
router.post("/financeiro/pagar-extra", async (req, res): Promise<void> => {
  const id = String(req.body?.id ?? "");
  const pago: boolean = req.body?.pago !== false;
  if (!id) { res.status(400).json({ error: "id obrigatório" }); return; }
  const extras = await lerExtras();
  const idx = extras.findIndex((e) => e.id === id);
  if (idx === -1) { res.status(404).json({ error: "conta não encontrada" }); return; }

  // Guarda anti-duplicata
  if (pago && extras[idx].pagoEm) {
    res.status(409).json({
      error: "Esta conta já foi registrada como paga e a saída financeira já foi lançada.",
    });
    return;
  }

  await db.transaction(async (tx) => {
    extras[idx] = { ...extras[idx], pagoEm: pago ? hojeSP() : null };
    await salvarExtras(tx, extras);

    // Ao marcar como pago: lança saída automática no caixa
    if (pago) {
      const extra = extras[idx];
      const valorNum = parseValor(extra.valor ?? "0");
      if (valorNum > 0) {
        const valorFmt = valorNum.toFixed(2).replace(".", ",");
        await tx.insert(caixaTable).values({
          tipo: "saida",
          valor: valorFmt,
          motivo: extra.nome,
          formaPagamento: "dinheiro",
        });
      }
    }
  });

  res.json({ ok: true });
});

/** Atualiza um ou mais valores editáveis (campos + contasExtras). */
router.put("/financeiro/config", async (req, res): Promise<void> => {
  const body = req.body ?? {};
  const updates: { key: string; value: string }[] = [];
  for (const campo of Object.keys(CHAVES) as ConfigCampo[]) {
    const raw = body[campo];
    if (raw === undefined || raw === null) continue;
    updates.push({ key: CHAVES[campo].key, value: String(raw).trim() });
  }
  await db.transaction(async (tx) => {
    for (const u of updates) {
      await tx
        .insert(appConfigTable)
        .values({ key: u.key, value: u.value })
        .onConflictDoUpdate({ target: appConfigTable.key, set: { value: u.value, updatedAt: new Date() } });
    }
    // Salva contas extras se enviadas
    if (Array.isArray(body.contasExtras)) {
      const extras: ContaExtra[] = (body.contasExtras as ContaExtra[]).map((e) => ({
        id: String(e.id ?? "").trim(),
        nome: String(e.nome ?? "").trim(),
        valor: String(e.valor ?? "").trim(),
        pagoEm: e.pagoEm && DATA_RE.test(e.pagoEm) ? e.pagoEm : null,
        diaVencimento: e.diaVencimento != null ? Math.min(28, Math.max(1, Math.round(Number(e.diaVencimento)))) : null,
      })).filter((e) => e.id && e.nome);
      await salvarExtras(tx, extras);
    }
  });
  res.json(await lerConfig());
});

/**
 * Lucro bruto do dia: para cada ENTRADA, (valor − custo da peça) quando há peça
 * vinculada; senão o valor cheio (serviço/mão de obra = lucro cheio).
 * As saídas do caixa NÃO entram aqui — o custo já vem do custo de cada peça.
 */
async function lucroDoDia(data: string): Promise<{
  receita: number;
  custo: number;
  lucroBruto: number;
}> {
  const rows = await db
    .select({
      valor: caixaTable.valor,
      pecaId: caixaTable.pecaId,
      custo: pecasTable.valorCusto,
    })
    .from(caixaTable)
    .leftJoin(pecasTable, eq(caixaTable.pecaId, pecasTable.id))
    .where(
      and(
        eq(caixaTable.tipo, "entrada"),
        sql`(${caixaTable.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE ${TZ})::date = ${data}::date`,
      ),
    );
  let receita = 0;
  let custo = 0;
  for (const r of rows) {
    receita += parseValor(r.valor);
    if (r.pecaId != null) custo += parseValor(r.custo ?? "");
  }
  return { receita, custo, lucroBruto: receita - custo };
}

/** Divisão do lucro de um dia (default: hoje em SP). */
router.get("/financeiro/divisao", async (req, res): Promise<void> => {
  const raw = String(req.query.dia ?? "").trim();
  const data = DATA_RE.test(raw) ? raw : hojeSP();
  const cfg = await lerConfig();

  const percentualSalario = parseValor(cfg.percentualSalario);
  const dias = Math.max(1, parseValor(cfg.diasTrabalhados));
  const aluguelMes = parseValor(cfg.custoAluguel);
  const energiaMes = parseValor(cfg.custoEnergia);
  const internetMes = parseValor(cfg.custoInternet);
  const aguaMes = parseValor(cfg.custoAgua);

  const { receita, custo, lucroBruto } = await lucroDoDia(data);

  const salario = lucroBruto * (percentualSalario / 100);
  const despAluguel = aluguelMes / dias;
  const despEnergia = energiaMes / dias;
  const despInternet = internetMes / dias;
  const despAgua = aguaMes / dias;

  // Contas extras do usuário
  const extras = await lerExtras();
  const despesasExtras = extras.map((e) => ({
    id: e.id,
    nome: e.nome,
    valor: parseValor(e.valor) / dias,
  }));
  const totalExtras = despesasExtras.reduce((s, e) => s + e.valor, 0);

  const despesasTotal = despAluguel + despEnergia + despInternet + despAgua + totalExtras;
  const reinvestimento = lucroBruto - salario - despesasTotal;

  res.json({
    dia: data,
    receita,
    custo,
    lucroBruto,
    percentualSalario,
    salario,
    diasTrabalhados: dias,
    despesas: {
      aluguel: despAluguel,
      energia: despEnergia,
      internet: despInternet,
      agua: despAgua,
      extras: despesasExtras,
      total: despesasTotal,
    },
    reinvestimento,
  });
});

export default router;
