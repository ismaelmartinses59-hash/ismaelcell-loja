import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  PiggyBank,
  ChevronDown,
  ChevronUp,
  Settings2,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function fmt(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Converte um valor digitado em pt-BR ("1.234,56" ou "400") para número. */
function parseNum(raw: string): number {
  let s = String(raw).replace(/[^\d.,-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function nanoid() {
  return Math.random().toString(36).slice(2, 10);
}

interface ContaExtra {
  id: string;
  nome: string;
  valor: string;
  pagoEm: string | null;
  diasContados?: number;
  diaVencimento: number | null;
}

interface Divisao {
  dia: string;
  receita: number;
  custo: number;
  lucroBruto: number;
  percentualSalario: number;
  salario: number;
  diasTrabalhados: number;
  despesas: {
    aluguel: number;
    energia: number;
    internet: number;
    agua: number;
    extras: { id: string; nome: string; valor: number }[];
    total: number;
  };
  reinvestimento: number;
}

/** Painel pequeno com a divisão do lucro de um dia. */
export function DivisaoLucro({ dia, enabled = true }: { dia: string; enabled?: boolean }) {
  const { data, isLoading, isError } = useQuery<Divisao>({
    queryKey: ["financeiro-divisao", dia],
    enabled: enabled && !!dia,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/financeiro/divisao?dia=${dia}`);
      if (!r.ok) throw new Error("erro ao carregar divisão");
      return r.json();
    },
  });

  if (isError) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-red-200 bg-red-50/50 p-3 text-center text-[11px] text-red-500">
        Não deu pra calcular a divisão do lucro agora. Tente reabrir o caixa.
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-emerald-200 bg-emerald-50/40 p-3 text-center text-[11px] text-slate-400">
        Calculando divisão do lucro...
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-800">
        <PiggyBank className="h-3.5 w-3.5" />
        Divisão do lucro do dia
      </div>

      <div className="mt-2 space-y-1 text-[11px]">
        <Linha label="Entrou (vendas + serviços)" valor={fmt(data.receita)} />
        <Linha label="Custo das peças" valor={`− ${fmt(data.custo)}`} cor="text-red-600" />
        <div className="flex justify-between border-t border-emerald-200 pt-1 font-bold text-slate-800">
          <span>Lucro do dia</span>
          <span>{fmt(data.lucroBruto)}</span>
        </div>
      </div>

      <div className="mt-2 space-y-1 text-[11px]">
        <div className="flex items-center justify-between rounded-md bg-amber-50 px-2 py-1">
          <span className="font-semibold text-amber-800">
            Seu salário ({data.percentualSalario.toLocaleString("pt-BR")}%)
          </span>
          <span className="font-bold text-amber-700">{fmt(data.salario)}</span>
        </div>
        <p className="px-2 text-[10px] leading-tight text-amber-600">
          Esse é o dinheiro pra transferir pra você.
        </p>

        <div className="flex justify-between px-2 pt-1">
          <span className="text-slate-600">
            Despesas do dia (÷ {data.diasTrabalhados} dias)
          </span>
          <span className="font-semibold text-red-600">− {fmt(data.despesas.total)}</span>
        </div>
        <div className="space-y-0.5 px-2 text-[10px] text-slate-400">
          <Mini label="Aluguel" valor={data.despesas.aluguel} />
          <Mini label="Energia" valor={data.despesas.energia} />
          <Mini label="Internet" valor={data.despesas.internet} />
          <Mini label="Água" valor={data.despesas.agua} />
          {data.despesas.extras?.map((e) => (
            <Mini key={e.id} label={e.nome} valor={e.valor} />
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between rounded-md bg-emerald-600 px-2 py-1.5 text-white">
        <span className="text-[11px] font-semibold">Reinvestir na loja</span>
        <span className="text-sm font-bold">{fmt(data.reinvestimento)}</span>
      </div>
      <p className="mt-1 text-[10px] leading-tight text-slate-500">
        Esse fica na loja pra repor estoque — não é pra mexer.
      </p>
    </div>
  );
}

function Linha({ label, valor, cor }: { label: string; valor: string; cor?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={cor ?? "font-medium text-slate-700"}>{valor}</span>
    </div>
  );
}

function Mini({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span>− {fmt(valor)}</span>
    </div>
  );
}

interface ConfigFin {
  percentualSalario: string;
  diasTrabalhados: string;
  custoAluguel: string;
  custoEnergia: string;
  custoInternet: string;
  custoAgua: string;
  diaAluguel: string;
  diaEnergia: string;
  diaInternet: string;
  diaAgua: string;
}

type ContaFixa = "aluguel" | "energia" | "internet" | "agua";
interface ContaStatus {
  pagoEm: string | null;
  diasContados: number;
  diaVencimento: number;
}

type ConfigFinResp = ConfigFin & {
  contas: Record<ContaFixa, ContaStatus>;
  contasExtras: (ContaExtra & { diasContados: number })[];
};

const CONTA_DE: Partial<Record<keyof ConfigFin, ContaFixa>> = {
  custoAluguel: "aluguel",
  custoEnergia: "energia",
  custoInternet: "internet",
  custoAgua: "agua",
};

/** Mapeia o campo custo → campo dia correspondente. */
const DIA_DE: Partial<Record<keyof ConfigFin, keyof ConfigFin>> = {
  custoAluguel: "diaAluguel",
  custoEnergia: "diaEnergia",
  custoInternet: "diaInternet",
  custoAgua: "diaAgua",
};

function fmtDia(d: string): string {
  const [, m, dd] = d.split("-");
  return `${dd}/${m}`;
}

const CAMPOS: { campo: keyof ConfigFin; label: string; conta?: boolean }[] = [
  { campo: "percentualSalario", label: "Seu salário (%)" },
  { campo: "diasTrabalhados", label: "Dias trabalhados no mês" },
  { campo: "custoAluguel", label: "Aluguel (valor do mês)", conta: true },
  { campo: "custoEnergia", label: "Energia (valor do mês)", conta: true },
  { campo: "custoInternet", label: "Internet (valor do mês)", conta: true },
  { campo: "custoAgua", label: "Água (valor do mês)", conta: true },
];

/** Editor retrátil dos valores (salário %, dias, contas fixas + personalizadas). */
export function ConfigFinanceiro({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [aberto, setAberto] = useState(defaultOpen);
  const [form, setForm] = useState<ConfigFin | null>(null);
  const [extras, setExtras] = useState<ContaExtra[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [pagandoConta, setPagandoConta] = useState<string | null>(null);
  // track if user edited extras so we know to save them
  const extrasEditados = useRef(false);

  const { data } = useQuery<ConfigFinResp>({
    queryKey: ["financeiro-config"],
    enabled: aberto,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/financeiro/config`);
      if (!r.ok) throw new Error("erro ao carregar config");
      return r.json();
    },
  });

  const divisorDias = Math.max(1, parseNum(form?.diasTrabalhados ?? "0"));

  // Sync form when data loads (first time only)
  useEffect(() => {
    if (data && !form) {
      setForm(data);
      setExtras(data.contasExtras ?? []);
    }
  }, [data, form]);

  // ── Pagar conta fixa ──────────────────────────────────────────────────────
  const pagarFixa = async (conta: ContaFixa, pago: boolean) => {
    setPagandoConta(conta);
    try {
      const r = await fetch(`${BASE}/api/financeiro/pagar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conta, pago }),
      });
      if (!r.ok) throw new Error("erro");
      await qc.invalidateQueries({ queryKey: ["financeiro-config"] });
      toast({ title: pago ? "Marcado como pago!" : "Desmarcado" });
    } catch {
      toast({ title: "Não deu pra salvar", variant: "destructive" });
    } finally {
      setPagandoConta(null);
    }
  };

  // ── Pagar conta extra ─────────────────────────────────────────────────────
  const pagarExtra = async (id: string, pago: boolean) => {
    setPagandoConta(id);
    try {
      const r = await fetch(`${BASE}/api/financeiro/pagar-extra`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, pago }),
      });
      if (!r.ok) throw new Error("erro");
      await qc.invalidateQueries({ queryKey: ["financeiro-config"] });
      // reset form so it reloads fresh data
      setForm(null);
      toast({ title: pago ? "Marcado como pago!" : "Desmarcado" });
    } catch {
      toast({ title: "Não deu pra salvar", variant: "destructive" });
    } finally {
      setPagandoConta(null);
    }
  };

  // ── Gerenciar extras ──────────────────────────────────────────────────────
  const addExtra = () => {
    extrasEditados.current = true;
    setExtras((prev) => [...prev, { id: nanoid(), nome: "", valor: "", pagoEm: null, diaVencimento: null }]);
  };

  const updateExtra = (id: string, field: "nome" | "valor", value: string) => {
    extrasEditados.current = true;
    setExtras((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)));
  };

  const updateExtraDia = (id: string, dia: number | null) => {
    extrasEditados.current = true;
    setExtras((prev) => prev.map((e) => (e.id === id ? { ...e, diaVencimento: dia } : e)));
  };

  const removeExtra = (id: string) => {
    extrasEditados.current = true;
    setExtras((prev) => prev.filter((e) => e.id !== id));
  };

  // ── Salvar ────────────────────────────────────────────────────────────────
  const salvar = async () => {
    if (!form) return;
    setSalvando(true);
    try {
      const body: Record<string, unknown> = { ...form };
      // Always send extras (even if unchanged) to avoid drift
      body.contasExtras = extras.filter((e) => e.nome.trim());
      const r = await fetch(`${BASE}/api/financeiro/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("erro ao salvar");
      extrasEditados.current = false;
      await qc.invalidateQueries({ queryKey: ["financeiro-config"] });
      await qc.invalidateQueries({ queryKey: ["financeiro-divisao"] });
      toast({ title: "Valores salvos!" });
    } catch {
      toast({ title: "Não deu pra salvar", variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="rounded-xl border bg-slate-50/60">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold text-slate-700"
      >
        <span className="flex items-center gap-1.5">
          <Settings2 className="h-4 w-4 text-slate-500" />
          Ajustar salário e contas fixas
        </span>
        {aberto ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>

      {aberto && (
        <div className="space-y-2 border-t px-3 py-3">
          {!form ? (
            <p className="text-center text-xs text-slate-400">Carregando...</p>
          ) : (
            <>
              {/* ── Campos fixos (salário + 4 contas) ──────────────────── */}
              {CAMPOS.map(({ campo, label, conta }) => {
                const contaKey = conta ? CONTA_DE[campo] : undefined;
                const status = contaKey ? data?.contas?.[contaKey] : undefined;
                const valorMes = parseNum(form[campo]);
                const diasContados = status?.diasContados ?? 0;
                const porDia = valorMes / divisorDias;
                const acum = Math.min(valorMes, porDia * diasContados);
                const pagoEm = status?.pagoEm ?? null;
                const diaCampo = conta ? DIA_DE[campo] : undefined;
                return (
                  <div key={campo} className="space-y-0.5">
                    <label className="text-[11px] font-medium text-slate-600">{label}</label>
                    <div className="flex gap-1.5">
                      <Input
                        inputMode="decimal"
                        value={form[campo]}
                        onChange={(e) => setForm((f) => f ? { ...f, [campo]: e.target.value } : f)}
                        className="h-9 text-sm flex-1"
                      />
                      {diaCampo && (
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] text-slate-400 whitespace-nowrap">Vence dia</span>
                          <Input
                            inputMode="numeric"
                            placeholder="7"
                            value={form[diaCampo]}
                            onChange={(e) => setForm((f) => f ? { ...f, [diaCampo]: e.target.value } : f)}
                            className="h-9 w-12 text-sm text-center px-1"
                          />
                        </div>
                      )}
                    </div>
                    {contaKey && (
                      <div className="flex items-start justify-between gap-2 pt-0.5">
                        <div className="min-w-0 space-y-0.5">
                          {valorMes > 0 && (
                            <p className="text-[10px] leading-tight text-emerald-700">
                              {pagoEm ? "Guardando pro próximo: " : "Já guardado: "}
                              <b>{fmt(acum)}</b> de {fmt(valorMes)}
                              <span className="text-slate-400">
                                {" "}· {fmt(porDia)}/dia × {diasContados} {diasContados === 1 ? "dia" : "dias"}
                              </span>
                            </p>
                          )}
                          {pagoEm && (
                            <p className="text-[10px] font-semibold text-green-600">
                              Pago em {fmtDia(pagoEm)}
                            </p>
                          )}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant={pagoEm ? "default" : "outline"}
                          disabled={pagandoConta === contaKey}
                          onClick={() => pagarFixa(contaKey, !pagoEm)}
                          className={
                            pagoEm
                              ? "h-7 shrink-0 bg-green-600 px-2.5 text-[11px] hover:bg-green-700"
                              : "h-7 shrink-0 border-green-300 px-2.5 text-[11px] text-green-700 hover:bg-green-50"
                          }
                        >
                          {pagandoConta === contaKey ? "..." : pagoEm ? "Pago ✓" : "Já paguei"}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* ── Contas personalizadas ───────────────────────────────── */}
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-slate-600">
                    Outras contas do mês
                  </p>
                  <button
                    type="button"
                    onClick={addExtra}
                    className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                  >
                    <Plus className="h-3 w-3" />
                    Adicionar
                  </button>
                </div>

                {extras.length === 0 && (
                  <p className="text-[10px] leading-tight text-slate-400">
                    Financiamento, gasolina, celular... adicione suas outras contas aqui.
                  </p>
                )}

                {extras.map((e) => {
                  const serverExtra = data?.contasExtras?.find((x) => x.id === e.id);
                  // Conta já salva no servidor → renderiza igual às fixas (label + valor + já guardado)
                  const jaSalva = !!serverExtra;
                  const valorMes = parseNum(e.valor);
                  const diasContados = serverExtra?.diasContados ?? 0;
                  const porDia = valorMes / divisorDias;
                  const acum = Math.min(valorMes, porDia * diasContados);
                  const pagoEm = serverExtra?.pagoEm ?? null;

                  if (jaSalva) {
                    return (
                      <div key={e.id} className="space-y-0.5">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] font-medium text-slate-600">
                            {e.nome} (valor do mês)
                          </label>
                          <button
                            type="button"
                            onClick={() => removeExtra(e.id)}
                            className="flex h-5 w-5 items-center justify-center rounded text-slate-300 hover:text-red-400"
                            title="Remover conta"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="flex gap-1.5">
                          <Input
                            inputMode="decimal"
                            value={e.valor}
                            onChange={(ev) => updateExtra(e.id, "valor", ev.target.value)}
                            className="h-9 text-sm flex-1"
                          />
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-[10px] text-slate-400 whitespace-nowrap">Vence dia</span>
                            <Input
                              inputMode="numeric"
                              placeholder="7"
                              value={e.diaVencimento ?? ""}
                              onChange={(ev) => {
                                const v = parseInt(ev.target.value, 10);
                                updateExtraDia(e.id, isNaN(v) ? null : Math.min(28, Math.max(1, v)));
                              }}
                              className="h-9 w-12 text-sm text-center px-1"
                            />
                          </div>
                        </div>
                        <div className="flex items-start justify-between gap-2 pt-0.5">
                          <div className="min-w-0 space-y-0.5">
                            {valorMes > 0 && (
                              <p className="text-[10px] leading-tight text-emerald-700">
                                {pagoEm ? "Guardando pro próximo: " : "Já guardado: "}
                                <b>{fmt(acum)}</b> de {fmt(valorMes)}
                                <span className="text-slate-400">
                                  {" "}· {fmt(porDia)}/dia × {diasContados} {diasContados === 1 ? "dia" : "dias"}
                                </span>
                              </p>
                            )}
                            {pagoEm && (
                              <p className="text-[10px] font-semibold text-green-600">
                                Pago em {fmtDia(pagoEm)}
                              </p>
                            )}
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant={pagoEm ? "default" : "outline"}
                            disabled={pagandoConta === e.id}
                            onClick={() => pagarExtra(e.id, !pagoEm)}
                            className={
                              pagoEm
                                ? "h-7 shrink-0 bg-green-600 px-2.5 text-[11px] hover:bg-green-700"
                                : "h-7 shrink-0 border-green-300 px-2.5 text-[11px] text-green-700 hover:bg-green-50"
                            }
                          >
                            {pagandoConta === e.id ? "..." : pagoEm ? "Pago ✓" : "Já paguei"}
                          </Button>
                        </div>
                      </div>
                    );
                  }

                  // Conta nova (ainda não salva) → formulário de criação
                  return (
                    <div key={e.id} className="space-y-1 rounded-lg border border-dashed border-slate-300 bg-white p-2">
                      <div className="flex gap-1.5">
                        <Input
                          placeholder="Nome da conta"
                          value={e.nome}
                          onChange={(ev) => updateExtra(e.id, "nome", ev.target.value)}
                          className="h-8 flex-1 text-sm"
                        />
                        <Input
                          inputMode="decimal"
                          placeholder="R$ valor"
                          value={e.valor}
                          onChange={(ev) => updateExtra(e.id, "valor", ev.target.value)}
                          className="h-8 w-20 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => removeExtra(e.id)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-red-100 text-red-400 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-400">Vence dia</span>
                        <Input
                          inputMode="numeric"
                          placeholder="ex: 5"
                          value={e.diaVencimento ?? ""}
                          onChange={(ev) => {
                            const v = parseInt(ev.target.value, 10);
                            updateExtraDia(e.id, isNaN(v) ? null : Math.min(28, Math.max(1, v)));
                          }}
                          className="h-7 w-16 text-sm text-center px-1"
                        />
                        <span className="text-[10px] text-slate-400">do mês</span>
                      </div>
                      <p className="text-[10px] text-slate-400">Preencha e clique em Salvar valores.</p>
                    </div>
                  );
                })}
              </div>

              <Button
                onClick={salvar}
                disabled={salvando}
                className="mt-1 w-full bg-slate-700 hover:bg-slate-800"
              >
                {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {salvando ? "Salvando..." : "Salvar valores"}
              </Button>
              <p className="text-[10px] leading-tight text-slate-400">
                Mudou o aluguel, a internet ou quer ganhar mais? Ajuste aqui que
                a divisão do lucro no fechamento já usa os valores novos.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
