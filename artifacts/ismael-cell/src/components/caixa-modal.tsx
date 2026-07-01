import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useListCaixa,
  useCreateCaixa,
  useDeleteCaixa,
  getListCaixaQueryKey,
  type CaixaMovimento,
  type ListCaixaParams,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { NotificacoesToggle } from "./notificacoes-toggle";
import {
  Wallet,
  ArrowDownCircle,
  ArrowUpCircle,
  Trash2,
  Loader2,
  Package,
  Check,
  History,
  ChevronDown,
  ChevronUp,
  Sun,
  Moon,
  CreditCard,
  Banknote,
  QrCode,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  type FormaPagamento,
  type FormaCartao,
  TAXAS_CARTAO,
  LABELS_FORMA,
  isCartaoForma,
} from "../lib/formas-pagamento";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Peca {
  id: number;
  modelo: string;
  qualidade: string;
  valor: string;
  quantidade: number;
  setor: string;
}

interface CaixaSessao {
  id: number;
  data: string;
  status: string;
  valorInicial: string;
  valorFinal: string | null;
  valorContado: string | null;
  totalEntradas: string | null;
  totalSaidas: string | null;
  totalCartao?: string | null;
  totalCartaoLiquido?: string | null;
  aberturaAt: string;
  fechamentoAt: string | null;
}

function formatMoney(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseMoney(val: string): number {
  if (!val) return 0;
  let s = val.replace(/[^\d.,-]/g, "");
  // Em pt-BR a vírgula é decimal; pontos são separadores de milhar.
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  return parseFloat(s) || 0;
}

function formatHoraSP(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface CaixaModalProps {
  open: boolean;
  onClose: () => void;
}

const PERIODOS = [
  { key: "semana", label: "Esta semana" },
  { key: "7", label: "7 dias" },
  { key: "15", label: "15 dias" },
  { key: "30", label: "30 dias" },
  { key: "custom", label: "Por data" },
] as const;

type PeriodoKey = (typeof PERIODOS)[number]["key"];

export function CaixaModal({ open, onClose }: CaixaModalProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [periodo, setPeriodo] = useState<PeriodoKey>("semana");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [showHistorico, setShowHistorico] = useState(false);

  const { data: fechamentos = [] } = useQuery<CaixaSessao[]>({
    queryKey: ["caixa-historico"],
    enabled: open && showHistorico,
    queryFn: () =>
      fetch(`${BASE}/api/caixa-sessoes/historico`).then((r) =>
        r.ok ? r.json() : [],
      ),
  });

  const { data: hoje } = useQuery<{
    sessao: CaixaSessao | null;
    totalEntradas: number;
    totalSaidas: number;
    saldo: number;
    entradasDinheiro?: number;
    totalCartao?: number;
    totalCartaoLiquido?: number;
    cartao?: { forma: string; label: string; taxa: number; bruto: number; liquido: number }[];
  }>({
    queryKey: ["caixa-sessao-hoje"],
    enabled: open,
    refetchInterval: 30000,
    retry: 3,
    // Se falhar, mantém o último estado bom (não finge "sem sessão").
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/caixa-sessoes`);
      if (!r.ok) throw new Error("status do caixa indisponível");
      return r.json();
    },
  });

  const params: ListCaixaParams =
    periodo === "custom" && inicio && fim ? { inicio, fim } : { periodo: periodo === "custom" ? "30" : periodo };

  const { data, isLoading } = useListCaixa(params, {
    query: { queryKey: getListCaixaQueryKey(params), enabled: open },
  });

  const [tipo, setTipo] = useState<"entrada" | "saida">("entrada");
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [formaPagto, setFormaPagto] = useState<FormaPagamento>("dinheiro");
  const [vincularPeca, setVincularPeca] = useState(false);
  const [modeloBusca, setModeloBusca] = useState("");
  const [pecaSel, setPecaSel] = useState<Peca | null>(null);

  const { data: pecas = [] } = useQuery<Peca[]>({
    queryKey: ["caixa-pecas"],
    enabled: open && tipo === "entrada" && vincularPeca,
    queryFn: async () => {
      const [loj, cli] = await Promise.all([
        fetch(`${BASE}/api/pecas?setor=lojista`).then((r) => (r.ok ? r.json() : [])),
        fetch(`${BASE}/api/pecas?setor=cliente`).then((r) => (r.ok ? r.json() : [])),
      ]);
      const merged: Peca[] = [...loj, ...cli];
      const seen = new Set<string>();
      const dedup: Peca[] = [];
      for (const p of merged) {
        const key = `${p.modelo.trim().toLowerCase()}|${p.qualidade.trim().toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dedup.push(p);
      }
      return dedup;
    },
  });

  const sugestoes = useMemo(() => {
    const q = modeloBusca.trim().toLowerCase();
    if (!q) return [];
    return pecas
      .filter(
        (p) =>
          p.modelo.toLowerCase().includes(q) ||
          p.qualidade.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [modeloBusca, pecas]);

  const [abrirValor, setAbrirValor] = useState("");
  const [sessaoBusy, setSessaoBusy] = useState(false);
  const [fecharAberto, setFecharAberto] = useState(false);
  const [contadoValor, setContadoValor] = useState("");

  useEffect(() => {
    if (!open) {
      setFecharAberto(false);
      setContadoValor("");
    }
  }, [open]);

  const abrirCaixa = async () => {
    if (!abrirValor.trim()) {
      toast({
        title: "Informe o valor inicial (troco)",
        variant: "destructive",
      });
      return;
    }
    setSessaoBusy(true);
    try {
      const r = await fetch(`${BASE}/api/caixa-sessoes/abrir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valorInicial: abrirValor.trim() }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Erro ao abrir");
      }
      toast({ title: "Caixa aberto!" });
      setAbrirValor("");
      qc.invalidateQueries({ queryKey: ["caixa-sessao-hoje"] });
      qc.invalidateQueries({ queryKey: ["caixa-sessao"] });
      qc.invalidateQueries({ queryKey: ["caixa-historico"] });
    } catch (e) {
      toast({
        title: "Erro ao abrir",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSessaoBusy(false);
    }
  };

  const fecharCaixa = async () => {
    setSessaoBusy(true);
    try {
      const r = await fetch(`${BASE}/api/caixa-sessoes/fechar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valorContado: contadoValor.trim() }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Erro ao fechar");
      }
      toast({ title: "Caixa fechado!" });
      setFecharAberto(false);
      setContadoValor("");
      qc.invalidateQueries({ queryKey: ["caixa-sessao-hoje"] });
      qc.invalidateQueries({ queryKey: ["caixa-sessao"] });
      qc.invalidateQueries({ queryKey: ["caixa-historico"] });
    } catch (e) {
      toast({
        title: "Erro ao fechar",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSessaoBusy(false);
    }
  };

  const createCaixa = useCreateCaixa();
  const deleteCaixa = useDeleteCaixa();

  const resetForm = () => {
    setValor("");
    setMotivo("");
    setFormaPagto("dinheiro");
    setVincularPeca(false);
    setModeloBusca("");
    setPecaSel(null);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/caixa"] });
    qc.invalidateQueries({ queryKey: ["caixa-sessao-hoje"] });
    qc.invalidateQueries({ queryKey: ["caixa-historico"] });
    qc.invalidateQueries({ queryKey: ["caixa-pecas"] });
    qc.invalidateQueries({ queryKey: ["pecas"] });
    qc.invalidateQueries({ queryKey: ["vendas"] });
    qc.invalidateQueries({ queryKey: ["contas-receber"] });
  };

  const selecionarPeca = (p: Peca) => {
    setPecaSel(p);
    setModeloBusca(`${p.modelo} — ${p.qualidade}`);
    if (!valor) setValor(p.valor);
    if (!motivo) setMotivo(`Troca de tela (${p.modelo})`);
  };

  const onSubmit = () => {
    if (!valor.trim()) {
      toast({ title: "Informe o valor", variant: "destructive" });
      return;
    }
    if (!motivo.trim()) {
      toast({ title: "Motivo é obrigatório", variant: "destructive" });
      return;
    }
    if (tipo === "entrada" && vincularPeca && !pecaSel) {
      toast({ title: "Selecione a peça na lista", variant: "destructive" });
      return;
    }
    createCaixa.mutate(
      {
        data: {
          tipo,
          valor: valor.trim(),
          motivo: motivo.trim(),
          formaPagamento: tipo === "entrada" ? formaPagto : "dinheiro",
          pecaId:
            tipo === "entrada" && vincularPeca && pecaSel ? pecaSel.id : null,
        },
      },
      {
        onSuccess: () => {
          toast({
            title:
              tipo === "entrada" ? "Entrada registrada!" : "Saída registrada!",
          });
          resetForm();
          invalidate();
        },
        onError: (e) => {
          toast({
            title: "Erro ao registrar",
            description: e instanceof Error ? e.message : undefined,
            variant: "destructive",
          });
        },
      },
    );
  };

  const onDelete = (m: CaixaMovimento) => {
    const msg = `Excluir esta ${m.tipo === "entrada" ? "entrada" : "saída"} de ${formatMoney(parseMoney(m.valor))}?${m.vendaId ? "\n\nO estoque da peça será devolvido e a venda removida." : ""}`;
    if (!window.confirm(msg)) return;
    deleteCaixa.mutate(
      { id: m.id },
      {
        onSuccess: () => {
          toast({ title: "Movimento excluído" });
          invalidate();
        },
        onError: () => toast({ title: "Erro ao excluir", variant: "destructive" }),
      },
    );
  };

  const totalEntradas = data?.totalEntradas ?? 0;
  const totalSaidas = data?.totalSaidas ?? 0;
  const saldo = data?.saldo ?? 0;
  const movimentos = data?.movimentos ?? [];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Wallet className="w-5 h-5 text-emerald-600" />
            Caixa
          </DialogTitle>
        </DialogHeader>

        <NotificacoesToggle />

        {/* Caixa de hoje */}
        {hoje?.sessao ? (
          <div className="rounded-xl border bg-emerald-50/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm font-bold text-emerald-800">
                {hoje.sessao.status === "fechado" ? (
                  <Moon className="h-4 w-4 text-indigo-500" />
                ) : (
                  <Sun className="h-4 w-4 text-amber-500" />
                )}
                {hoje.sessao.status === "fechado"
                  ? "Caixa fechado hoje"
                  : "Caixa aberto hoje"}
              </span>
              <span className="text-right text-[11px] font-medium text-slate-600">
                Abriu {formatHoraSP(hoje.sessao.aberturaAt)}
                {hoje.sessao.fechamentoAt
                  ? ` · Fechou ${formatHoraSP(hoje.sessao.fechamentoAt)}`
                  : ""}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Troco inicial</span>
                <span className="font-medium text-slate-700">
                  {formatMoney(parseMoney(hoje.sessao.valorInicial))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-green-600">Entrou (dinheiro)</span>
                <span className="font-semibold text-green-700">
                  {formatMoney(hoje.entradasDinheiro ?? hoje.totalEntradas)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-red-600">Saiu hoje</span>
                <span className="font-semibold text-red-700">
                  {formatMoney(hoje.totalSaidas)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-slate-600">
                  Em caixa agora
                </span>
                <span className="font-bold text-emerald-600">
                  {formatMoney(
                    parseMoney(hoje.sessao.valorInicial) +
                      (hoje.entradasDinheiro ?? hoje.totalEntradas) -
                      hoje.totalSaidas,
                  )}
                </span>
              </div>
            </div>
            {hoje.cartao && hoje.cartao.length > 0 && (
              <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/70 p-2">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-blue-800">
                  <CreditCard className="h-3.5 w-3.5" />
                  Cartão hoje (não está na gaveta)
                </div>
                <div className="mt-1 space-y-0.5">
                  {hoje.cartao.map((c) => (
                    <div key={c.forma} className="flex justify-between text-[11px] text-blue-900">
                      <span>
                        {c.label}{" "}
                        <span className="text-blue-500">(−{c.taxa.toLocaleString("pt-BR")}%)</span>
                      </span>
                      <span className="font-medium">
                        {formatMoney(c.bruto)} → {formatMoney(c.liquido)}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-blue-200 pt-0.5 text-[11px] font-bold text-blue-900">
                    <span>Você recebe (cartão)</span>
                    <span>{formatMoney(hoje.totalCartaoLiquido ?? 0)}</span>
                  </div>
                </div>
              </div>
            )}
            {hoje.sessao.status === "fechado" && hoje.sessao.valorContado && (
              <div className="mt-2 flex justify-between border-t pt-2 text-xs">
                <span className="font-semibold text-slate-600">
                  Conferido na gaveta
                </span>
                <span className="font-bold text-indigo-600">
                  {formatMoney(parseMoney(hoje.sessao.valorContado))}
                </span>
              </div>
            )}
            {hoje.sessao.status !== "fechado" &&
              (fecharAberto ? (
                <div className="mt-3 space-y-2">
                  <label className="text-xs font-semibold text-slate-700">
                    Quanto tem na gaveta agora? (confira e ajuste)
                  </label>
                  <Input
                    inputMode="decimal"
                    placeholder="Ex: 150,00"
                    value={contadoValor}
                    onChange={(e) => setContadoValor(e.target.value)}
                    className="h-11 text-base"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setFecharAberto(false)}
                      disabled={sessaoBusy}
                      className="flex-1"
                    >
                      Cancelar
                    </Button>
                    <Button
                      onClick={fecharCaixa}
                      disabled={sessaoBusy}
                      className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                    >
                      {sessaoBusy ? "Fechando..." : "Confirmar"}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  onClick={() => {
                    const ini = hoje.sessao
                      ? parseMoney(hoje.sessao.valorInicial)
                      : 0;
                    setContadoValor(
                      (
                        ini +
                        (hoje.entradasDinheiro ?? hoje.totalEntradas) -
                        hoje.totalSaidas
                      )
                        .toFixed(2)
                        .replace(".", ","),
                    );
                    setFecharAberto(true);
                  }}
                  disabled={sessaoBusy}
                  className="mt-3 w-full bg-indigo-600 hover:bg-indigo-700"
                >
                  <Moon className="mr-2 h-4 w-4" />
                  Fechar caixa agora
                </Button>
              ))}
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-800">
              Caixa ainda não foi aberto hoje.
            </p>
            <p className="mt-0.5 text-xs text-amber-700">
              Informe o valor inicial (troco) para abrir o caixa.
            </p>
            <div className="mt-2 flex gap-2">
              <Input
                inputMode="decimal"
                placeholder="Ex: 100,00"
                value={abrirValor}
                onChange={(e) => setAbrirValor(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") abrirCaixa();
                }}
                className="bg-white"
              />
              <Button
                onClick={abrirCaixa}
                disabled={sessaoBusy}
                className="shrink-0 bg-emerald-600 hover:bg-emerald-700"
              >
                <Sun className="mr-2 h-4 w-4" />
                {sessaoBusy ? "Abrindo..." : "Abrir"}
              </Button>
            </div>
          </div>
        )}

        {/* Saldo + totais */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-center">
            <p className="text-[10px] text-green-700 uppercase tracking-wider font-medium">
              Entradas
            </p>
            <p className="text-sm font-bold text-green-700">
              {formatMoney(totalEntradas)}
            </p>
          </div>
          <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-center">
            <p className="text-[10px] text-red-700 uppercase tracking-wider font-medium">
              Saídas
            </p>
            <p className="text-sm font-bold text-red-700">
              {formatMoney(totalSaidas)}
            </p>
          </div>
          <div
            className={`rounded-xl border p-3 text-center ${saldo >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}
          >
            <p
              className={`text-[10px] uppercase tracking-wider font-medium ${saldo >= 0 ? "text-emerald-700" : "text-amber-700"}`}
            >
              Saldo
            </p>
            <p
              className={`text-sm font-bold ${saldo >= 0 ? "text-emerald-700" : "text-amber-700"}`}
            >
              {formatMoney(saldo)}
            </p>
          </div>
        </div>

        {/* Formulário */}
        <div className="rounded-xl border bg-muted/30 p-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setTipo("entrada")}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors border ${
                tipo === "entrada"
                  ? "bg-green-600 text-white border-green-600"
                  : "bg-white text-green-700 border-green-200 hover:bg-green-50"
              }`}
            >
              <ArrowUpCircle className="w-4 h-4" />
              Entrada
            </button>
            <button
              type="button"
              onClick={() => {
                setTipo("saida");
                setVincularPeca(false);
                setPecaSel(null);
                setModeloBusca("");
              }}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors border ${
                tipo === "saida"
                  ? "bg-red-600 text-white border-red-600"
                  : "bg-white text-red-700 border-red-200 hover:bg-red-50"
              }`}
            >
              <ArrowDownCircle className="w-4 h-4" />
              Saída
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Valor (R$)
              </label>
              <Input
                inputMode="decimal"
                placeholder="220,00"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Motivo *
              </label>
              <Input
                placeholder="Ex: conta INSS"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </div>
          </div>

          {tipo === "entrada" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Forma de pagamento
              </label>
              <div className="mt-1 grid grid-cols-3 gap-1">
                {(["dinheiro", "pix", "debito", "credito_1x", "credito_2x", "credito_3x"] as FormaPagamento[]).map((f) => {
                  const ativo = formaPagto === f;
                  const semTaxa = f === "dinheiro" || f === "pix";
                  const short =
                    f === "dinheiro" ? "Dinheiro"
                    : f === "pix" ? "PIX"
                    : f === "debito" ? "Débito"
                    : f === "credito_1x" ? "Créd 1x"
                    : f === "credito_2x" ? "Créd 2x"
                    : "Créd 3x";
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFormaPagto(f)}
                      className={`flex flex-col items-center justify-center gap-0.5 rounded-lg border py-1.5 text-[10px] font-semibold transition-colors ${
                        ativo
                          ? semTaxa
                            ? "bg-emerald-600 text-white border-emerald-600"
                            : "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {f === "dinheiro" ? <Banknote className="h-3.5 w-3.5" /> : f === "pix" ? <QrCode className="h-3.5 w-3.5" /> : <CreditCard className="h-3.5 w-3.5" />}
                      {short}
                    </button>
                  );
                })}
              </div>
              {formaPagto === "pix" && (
                <p className="mt-1 text-[11px] text-emerald-700">
                  PIX — sem taxa, entra na gaveta (igual dinheiro).
                </p>
              )}
              {isCartaoForma(formaPagto) && (
                <p className="mt-1 text-[11px] text-blue-700">
                  Cartão — a maquininha desconta {TAXAS_CARTAO[formaPagto as FormaCartao].toLocaleString("pt-BR")}%. Não entra na gaveta.
                </p>
              )}
            </div>
          )}

          {tipo === "entrada" && (
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={vincularPeca}
                onChange={(e) => {
                  setVincularPeca(e.target.checked);
                  if (!e.target.checked) {
                    setPecaSel(null);
                    setModeloBusca("");
                  }
                }}
                className="h-4 w-4 accent-emerald-600"
              />
              <span className="flex items-center gap-1.5 text-foreground">
                <Package className="w-3.5 h-3.5 text-muted-foreground" />
                É troca de tela / peça (baixa o estoque)
              </span>
            </label>
          )}

          {tipo === "entrada" && vincularPeca && (
            <div className="relative">
              <Input
                placeholder="Digite o modelo... ex: A03 Core"
                value={modeloBusca}
                onChange={(e) => {
                  setModeloBusca(e.target.value);
                  setPecaSel(null);
                }}
              />
              {pecaSel && (
                <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-700">
                  <Check className="w-3.5 h-3.5" />
                  {pecaSel.modelo} — {pecaSel.qualidade} ({pecaSel.quantidade} em
                  estoque)
                </div>
              )}
              {!pecaSel && sugestoes.length > 0 && (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg overflow-hidden">
                  {sugestoes.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selecionarPeca(p)}
                      className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between gap-2"
                    >
                      <span className="text-sm">
                        <span className="font-medium">{p.modelo}</span>
                        <span className="text-muted-foreground"> — {p.qualidade}</span>
                      </span>
                      <span
                        className={`text-xs font-semibold shrink-0 ${p.quantidade > 0 ? "text-emerald-600" : "text-red-500"}`}
                      >
                        {p.quantidade} un.
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {!pecaSel &&
                modeloBusca.trim().length > 0 &&
                sugestoes.length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Nenhuma peça encontrada no estoque.
                  </p>
                )}
            </div>
          )}

          <Button
            className="w-full"
            onClick={onSubmit}
            disabled={createCaixa.isPending}
          >
            {createCaixa.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Registrar {tipo === "entrada" ? "entrada" : "saída"}
          </Button>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-2">
          {PERIODOS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriodo(p.key)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                periodo === p.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground border-transparent hover:border-muted-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {periodo === "custom" && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                De
              </label>
              <Input
                type="date"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Até
              </label>
              <Input
                type="date"
                value={fim}
                onChange={(e) => setFim(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Lista de movimentos */}
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Carregando...
          </div>
        ) : movimentos.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Nenhuma movimentação no período.
          </div>
        ) : (
          <div className="space-y-2">
            {movimentos.map((m) => {
              const isEntrada = m.tipo === "entrada";
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-3 rounded-lg border bg-white px-3 py-2"
                >
                  {isEntrada ? (
                    <ArrowUpCircle className="w-5 h-5 text-green-600 shrink-0" />
                  ) : (
                    <ArrowDownCircle className="w-5 h-5 text-red-600 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">
                      {m.motivo}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {format(new Date(m.createdAt), "dd/MM/yyyy 'às' HH:mm", {
                        locale: ptBR,
                      })}
                      {m.modelo ? ` · ${m.modelo}` : ""}
                    </p>
                  </div>
                  <span
                    className={`text-sm font-bold shrink-0 ${isEntrada ? "text-green-700" : "text-red-700"}`}
                  >
                    {isEntrada ? "+" : "−"}
                    {formatMoney(parseMoney(m.valor))}
                  </span>
                  <button
                    onClick={() => onDelete(m)}
                    className="text-muted-foreground hover:text-red-600 transition-colors shrink-0"
                    title="Excluir"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Histórico de fechamentos */}
        <div className="border-t pt-3">
          <button
            type="button"
            onClick={() => setShowHistorico((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-muted"
          >
            <span className="flex items-center gap-2">
              <History className="h-4 w-4 text-indigo-600" />
              Histórico de fechamentos
            </span>
            {showHistorico ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>

          {showHistorico && (
            <div className="mt-3 space-y-2">
              {fechamentos.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Nenhum fechamento registrado ainda.
                </p>
              ) : (
                fechamentos.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-xl border bg-white p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-slate-800">
                        {format(new Date(`${s.data}T12:00:00`), "EEEE, dd/MM", {
                          locale: ptBR,
                        })}
                      </p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          s.status === "fechado"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {s.status === "fechado" ? "Fechado" : "Aberto"}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Sun className="h-3.5 w-3.5 text-amber-500" />
                        Abriu {formatHoraSP(s.aberturaAt)}
                      </span>
                      {s.fechamentoAt && (
                        <span className="flex items-center gap-1">
                          <Moon className="h-3.5 w-3.5 text-indigo-500" />
                          Fechou {formatHoraSP(s.fechamentoAt)}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t pt-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Troco inicial</span>
                        <span className="font-medium text-slate-700">
                          {formatMoney(parseMoney(s.valorInicial))}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-green-600">Entradas</span>
                        <span className="font-medium text-green-700">
                          {s.totalEntradas
                            ? formatMoney(parseMoney(s.totalEntradas))
                            : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-red-600">Saídas</span>
                        <span className="font-medium text-red-700">
                          {s.totalSaidas
                            ? formatMoney(parseMoney(s.totalSaidas))
                            : "—"}
                        </span>
                      </div>
                      {s.totalCartao && parseMoney(s.totalCartao) > 0 && (
                        <div className="flex justify-between">
                          <span className="text-blue-600">Cartão</span>
                          <span className="font-medium text-blue-700">
                            {formatMoney(parseMoney(s.totalCartao))}
                            {s.totalCartaoLiquido
                              ? ` → ${formatMoney(parseMoney(s.totalCartaoLiquido))}`
                              : ""}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="font-semibold text-slate-600">
                          Valor final
                        </span>
                        <span className="font-bold text-emerald-600">
                          {s.valorFinal
                            ? formatMoney(parseMoney(s.valorFinal))
                            : "—"}
                        </span>
                      </div>
                      {s.valorContado && (
                        <div className="flex justify-between">
                          <span className="font-semibold text-slate-600">
                            Conferido
                          </span>
                          <span className="font-bold text-indigo-600">
                            {formatMoney(parseMoney(s.valorContado))}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
