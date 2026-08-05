import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TrendingUp, TrendingDown, Wallet, CreditCard, Calendar, ChevronDown, ChevronRight } from "lucide-react";
import { format, subDays, subMonths, startOfMonth, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function fmt(val: string | number | null | undefined): number {
  if (val == null) return 0;
  const s = String(val).replace(/[^\d,\.]/g, "").replace(",", ".");
  return parseFloat(s) || 0;
}
function brl(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type Periodo = "mes" | "30d" | "90d" | "tudo";

interface Sessao {
  id: number;
  data: string; // "YYYY-MM-DD"
  status: string;
  totalEntradas: string | null;
  totalSaidas: string | null;
  totalCartao: string | null;
  totalCartaoLiquido: string | null;
  valorFinal: string | null;
  aberturaAt: string | null;
  fechamentoAt: string | null;
}

interface FaturamentoModalProps {
  open: boolean;
  onClose: () => void;
  tipo?: "cliente" | "lojista";
}

export function FaturamentoModal({ open, onClose }: FaturamentoModalProps) {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  const { data: sessoes = [], isLoading } = useQuery<Sessao[]>({
    queryKey: ["caixa-sessoes-historico"],
    queryFn: () => fetch(`${BASE}/api/caixa-sessoes/historico`).then((r) => r.json()),
    enabled: open,
  });

  // ── Filtro por período ───────────────────────────────────────────────────
  const filtradas = useMemo(() => {
    const hoje = new Date();
    let desde: Date;
    if (periodo === "mes") desde = startOfMonth(hoje);
    else if (periodo === "30d") desde = subDays(hoje, 30);
    else if (periodo === "90d") desde = subMonths(hoje, 3);
    else desde = new Date(0);

    return sessoes.filter((s) => {
      const d = parseISO(s.data);
      return d >= desde;
    });
  }, [sessoes, periodo]);

  // ── Totais gerais do período ─────────────────────────────────────────────
  const totais = useMemo(() => {
    let entradas = 0, saidas = 0, cartao = 0, cartaoLiq = 0;
    for (const s of filtradas) {
      entradas += fmt(s.totalEntradas);
      saidas += fmt(s.totalSaidas);
      cartao += fmt(s.totalCartao);
      cartaoLiq += fmt(s.totalCartaoLiquido);
    }
    const lucro = entradas - saidas;
    const dinheiroPix = entradas - cartaoLiq;
    return { entradas, saidas, lucro, cartao, cartaoLiq, dinheiroPix };
  }, [filtradas]);

  // ── Por mês ─────────────────────────────────────────────────────────────
  const porMes = useMemo(() => {
    const map: Record<string, { entradas: number; saidas: number; cartao: number; dias: Sessao[] }> = {};
    for (const s of filtradas) {
      const mes = format(parseISO(s.data), "MMMM yyyy", { locale: ptBR });
      if (!map[mes]) map[mes] = { entradas: 0, saidas: 0, cartao: 0, dias: [] };
      map[mes].entradas += fmt(s.totalEntradas);
      map[mes].saidas += fmt(s.totalSaidas);
      map[mes].cartao += fmt(s.totalCartao);
      map[mes].dias.push(s);
    }
    return Object.entries(map).sort((a, b) =>
      parseISO(b[1].dias[0].data).getTime() - parseISO(a[1].dias[0].data).getTime()
    );
  }, [filtradas]);

  const toggleMes = (mes: string) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      next.has(mes) ? next.delete(mes) : next.add(mes);
      return next;
    });
  };

  const PERIODOS: { key: Periodo; label: string }[] = [
    { key: "mes", label: "Este mês" },
    { key: "30d", label: "30 dias" },
    { key: "90d", label: "3 meses" },
    { key: "tudo", label: "Tudo" },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto p-0">
        {/* ── Header ───────────────────────────────────────────────────── */}
        <DialogHeader className="px-4 pt-4 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <TrendingUp className="w-4 h-4 text-green-600" />
            Faturamento — Caixa
          </DialogTitle>
        </DialogHeader>

        <div className="px-4 pt-3 pb-5 space-y-4">
          {/* ── Filtro de período ─────────────────────────────────────── */}
          <div className="flex gap-1.5 flex-wrap">
            {PERIODOS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setPeriodo(key)}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  periodo === key
                    ? "bg-green-600 text-white border-green-600"
                    : "bg-muted text-muted-foreground border-transparent hover:border-green-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="text-center py-10 text-muted-foreground text-sm">Carregando...</div>
          ) : filtradas.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              Nenhum caixa registrado neste período.
            </div>
          ) : (
            <>
              {/* ── Cards de totais ───────────────────────────────────── */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <TrendingUp className="w-3.5 h-3.5 text-green-600" />
                    <span className="text-[10px] text-green-700 font-semibold uppercase tracking-wide">Entradas</span>
                  </div>
                  <p className="text-lg font-bold text-green-700">{brl(totais.entradas)}</p>
                </div>
                <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <TrendingDown className="w-3.5 h-3.5 text-red-600" />
                    <span className="text-[10px] text-red-700 font-semibold uppercase tracking-wide">Saídas</span>
                  </div>
                  <p className="text-lg font-bold text-red-700">{brl(totais.saidas)}</p>
                </div>
                <div className={`rounded-xl border p-3 text-center col-span-2 ${totais.lucro >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-orange-50 border-orange-200"}`}>
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Wallet className={`w-3.5 h-3.5 ${totais.lucro >= 0 ? "text-emerald-600" : "text-orange-600"}`} />
                    <span className={`text-[10px] font-semibold uppercase tracking-wide ${totais.lucro >= 0 ? "text-emerald-700" : "text-orange-700"}`}>
                      Lucro Bruto
                    </span>
                  </div>
                  <p className={`text-2xl font-bold ${totais.lucro >= 0 ? "text-emerald-700" : "text-orange-700"}`}>
                    {brl(totais.lucro)}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {filtradas.length} dia{filtradas.length !== 1 ? "s" : ""} de caixa
                  </p>
                </div>
              </div>

              {/* ── Forma de pagamento ────────────────────────────────── */}
              {(totais.cartao > 0 || totais.dinheiroPix > 0) && (
                <div className="rounded-xl border bg-muted/40 p-3 space-y-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Por forma de pagamento</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground text-xs">💵 Dinheiro + PIX</span>
                    <span className="font-semibold">{brl(totais.dinheiroPix)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground text-xs">💳 Cartão (bruto)</span>
                    <span className="font-semibold">{brl(totais.cartao)}</span>
                  </div>
                  {totais.cartao > totais.cartaoLiq && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground text-xs">💳 Cartão (líquido)</span>
                      <span className="font-semibold text-amber-700">{brl(totais.cartaoLiq)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* ── Por mês ───────────────────────────────────────────── */}
              {porMes.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Por mês</span>
                  </div>
                  {porMes.map(([mes, dados]) => {
                    const expanded = expandedMonths.has(mes);
                    const lucroMes = dados.entradas - dados.saidas;
                    return (
                      <div key={mes} className="rounded-xl border overflow-hidden">
                        {/* Cabeçalho do mês */}
                        <button
                          type="button"
                          onClick={() => toggleMes(mes)}
                          className="w-full flex items-center justify-between px-3 py-2.5 bg-muted/50 hover:bg-muted/80 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            {expanded
                              ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                              : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                            }
                            <span className="text-sm font-semibold capitalize">{mes}</span>
                            <span className="text-[10px] text-muted-foreground">{dados.dias.length}d</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-green-700 font-semibold">{brl(dados.entradas)}</span>
                            <span className={`font-bold ${lucroMes >= 0 ? "text-emerald-600" : "text-orange-600"}`}>
                              = {brl(lucroMes)}
                            </span>
                          </div>
                        </button>

                        {/* Detalhes diários */}
                        {expanded && (
                          <div className="divide-y">
                            {dados.dias
                              .sort((a, b) => b.data.localeCompare(a.data))
                              .map((s) => {
                                const ent = fmt(s.totalEntradas);
                                const sai = fmt(s.totalSaidas);
                                const luc = ent - sai;
                                const dateLabel = format(parseISO(s.data), "dd/MM (EEE)", { locale: ptBR });
                                return (
                                  <div key={s.id} className="px-4 py-2 flex items-center justify-between bg-white">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-muted-foreground capitalize">{dateLabel}</span>
                                      {s.status === "aberto" && (
                                        <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">aberto</span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-3 text-xs">
                                      <span className="text-green-700">{brl(ent)}</span>
                                      {sai > 0 && <span className="text-red-600">-{brl(sai)}</span>}
                                      <span className={`font-bold ${luc >= 0 ? "text-emerald-600" : "text-orange-600"}`}>
                                        {brl(luc)}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            {/* Resumo do mês */}
                            <div className="px-4 py-2 bg-muted/30 flex items-center justify-between">
                              <span className="text-[10px] text-muted-foreground font-semibold">Total saídas</span>
                              <span className="text-xs text-red-600 font-semibold">{brl(dados.saidas)}</span>
                            </div>
                            {dados.cartao > 0 && (
                              <div className="px-4 py-2 bg-muted/20 flex items-center justify-between">
                                <span className="text-[10px] text-muted-foreground font-semibold">Cartão (bruto)</span>
                                <span className="text-xs font-semibold">{brl(dados.cartao)}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
