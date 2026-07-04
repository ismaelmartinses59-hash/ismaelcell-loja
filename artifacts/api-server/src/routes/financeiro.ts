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
} as const;

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

/**
 * Conta quantos dias o caixa foi aberto no mês atual (fuso SP) = "dias
 * trabalhados até agora". Cada dia de trabalho tem uma sessão de caixa (a
 * coluna `data` é única por dia), então basta contar as sessões do mês.
 */
async function contarDiasTrabalhadosMes(): Promise<number> {
  const mes = hojeSP().slice(0, 7); // "YYYY-MM"
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(caixaSessoesTable)
    .where(sql`${caixaSessoesTable.data} like ${mes + "-%"}`);
  return row?.n ?? 0;
}

/** Lê os valores editáveis (salário %, dias, contas fixas) + dias trabalhados no mês. */
router.get("/financeiro/config", async (_req, res): Promise<void> => {
  const cfg = await lerConfig();
  const diasTrabalhadosMes = await contarDiasTrabalhadosMes();
  res.json({ ...cfg, diasTrabalhadosMes });
});

/** Atualiza um ou mais valores editáveis. */
router.put("/financeiro/config", async (req, res): Promise<void> => {
  const body = req.body ?? {};
  const updates: { key: string; value: string }[] = [];
  for (const campo of Object.keys(CHAVES) as ConfigCampo[]) {
    const raw = body[campo];
    if (raw === undefined || raw === null) continue;
    updates.push({ key: CHAVES[campo].key, value: String(raw).trim() });
  }
  if (updates.length) {
    await db.transaction(async (tx) => {
      for (const u of updates) {
        await tx
          .insert(appConfigTable)
          .values({ key: u.key, value: u.value })
          .onConflictDoUpdate({
            target: appConfigTable.key,
            set: { value: u.value, updatedAt: new Date() },
          });
      }
    });
  }
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
  const despesasTotal = despAluguel + despEnergia + despInternet + despAgua;
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
      total: despesasTotal,
    },
    reinvestimento,
  });
});

export default router;
