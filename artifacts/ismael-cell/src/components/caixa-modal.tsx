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
import { DivisaoLucro } from "./divisao-lucro";
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
  ChevronRight,
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
  reaberto?: boolean;
  aberturaAt: string;
  fechamentoAt: string | null;
}

/** Horário limite para reabrir o caixa: 20:30 (mesmo valor do backend). */
const LIMITE_REABRIR_MIN = 20 * 60 + 30;

/** Minutos desde a meia-noite AGORA no fuso de São Paulo (independe do fuso do aparelho). */
function agoraMinutosSP(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
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

/** "Hoje" (YYYY-MM-DD) no fuso de São Paulo. */
function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
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
  const [diaDetalhe, setDiaDetalhe] = useState<CaixaSessao | null>(null);
  const [nowTick, setNowTick] = useState(0);

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
    entradasPix?: number;
    saidasDinheiro?: number;
    saidasPix?: number;
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

  // Atualiza o relógio interno a cada 30s para o travamento das 20:30 (e a
  // virada do dia) reagirem sozinhos, mesmo sem interação nem mudança de dados.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNowTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, [open]);

  // "Hoje" (SP) e se o caixa de hoje já travou (passou das 20:30, OU fechado e
  // já reaberto uma vez). Recalcula a cada tick.
  const hojeStr = useMemo(() => hojeSP(), [nowTick]);
  const hojeTravado = useMemo(() => {
    const sess = hoje?.sessao;
    if (!sess) return false;
    // O dia "trava" (some da lista principal e vai pro Histórico) quando passa
    // das 20:30 — independente de o caixa ter sido fechado ou não — OU quando já
    // foi fechado e reaberto (não dá mais pra reabrir). Antes das 20:30 com o
    // caixa aberto, a lista de hoje continua visível.
    return (
      agoraMinutosSP() > LIMITE_REABRIR_MIN ||
      (sess.status === "fechado" && sess.reaberto === true)
    );
  }, [hoje, nowTick]);

  // Lançamentos de HOJE vêm de uma query dedicada (por data SP), independente
  // do filtro de período usado no "Resumo do período".
  const { data: hojeMovData, isLoading: hojeMovLoading } = useQuery<{
    movimentos: CaixaMovimento[];
    totalEntradas: number;
    totalSaidas: number;
  }>({
    queryKey: ["caixa-hoje", hojeStr],
    enabled: open && !hojeTravado,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/caixa?dia=${hojeStr}`);
      if (!r.ok) throw new Error("erro ao carregar hoje");
      return r.json();
    },
  });
  const movimentosHoje = hojeTravado ? [] : (hojeMovData?.movimentos ?? []);

  const { data: detalheData, isLoading: detalheLoading } = useQuery<{
    movimentos: CaixaMovimento[];
    totalEntradas: number;
    totalSaidas: number;
  }>({
    queryKey: ["caixa-dia", diaDetalhe?.data],
    enabled: open && !!diaDetalhe,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/caixa?dia=${diaDetalhe!.data}`);
      if (!r.ok) throw new Error("erro ao carregar o dia");
      return r.json();
    },
  });

  const params: ListCaixaParams =
    periodo === "custom" && inicio && fim ? { inicio, fim } : { periodo: periodo === "custom" ? "30" : periodo };

  const { data } = useListCaixa(params, {
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
    enabled: open && tipo === "entrada",
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

    // Sugestões de peças ao digitar o MODELO direto no campo Motivo (ex: "G24")
    const motivoSugestoes = useMemo(() => {
      if (pecaSel) return [];
      const norm = (t: string) =>
        t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
      const q = norm(motivo);
      if (q.length < 2) return [];
      const palavras = q.split(" ").filter((w) => w.length >= 2 && !["do", "da", "de", "conta", "troca", "tela"].includes(w));
      if (palavras.length === 0) return [];
      return pecas
        .filter((p) => {
          const m = norm(`${p.modelo} ${p.qualidade}`);
          return palavras.every((w) => m.includes(w));
        })
        .slice(0, 5);
    }, [motivo, pecaSel, pecas]);

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

  const reabrirCaixa = async () => {
    if (
      !window.confirm(
        "Reabrir o caixa de hoje? Ele volta a ficar aberto, como se não tivesse sido fechado. As entradas e saídas do dia continuam salvas.",
      )
    )
      return;
    setSessaoBusy(true);
    try {
      const r = await fetch(`${BASE}/api/caixa-sessoes/reabrir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Erro ao reabrir");
      }
      toast({ title: "Caixa reaberto!" });
      qc.invalidateQueries({ queryKey: ["caixa-sessao-hoje"] });
      qc.invalidateQueries({ queryKey: ["caixa-sessao"] });
      qc.invalidateQueries({ queryKey: ["caixa-historico"] });
    } catch (e) {
      toast({
        title: "Erro ao reabrir",
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
    qc.invalidateQueries({ queryKey: ["caixa-hoje"] });
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
          formaPagamento:
            tipo === "entrada"
              ? formaPagto
              : formaPagto === "pix"
                ? "pix"
                : "dinheiro",
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

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setDiaDetalhe(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg w-full p-0 gap-0 max-h-[95vh] flex flex-col overflow-hidden">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-emerald-100 rounded-xl flex items-center justify-center">
              <Wallet className="w-5 h-5 text-emerald-600" />
            </div>
            <span className="text-xl font-bold text-gray-800">Caixa</span>
          </div>
          {hoje?.sessao && hoje.sessao.status !== "fechado" && !fecharAberto && (
            <button
              onClick={() => {
                const ini = hoje.sessao ? parseMoney(hoje.sessao.valorInicial) : 0;
                setContadoValor(
                  (ini + (hoje.entradasDinheiro ?? hoje.totalEntradas) - (hoje.saidasDinheiro ?? hoje.totalSaidas))
                    .toFixed(2).replace(".", ","),
                );
                setFecharAberto(true);
              }}
              disabled={sessaoBusy}
              className="flex items-center gap-1.5 border border-emerald-500 text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors"
            >
              <Moon className="w-3.5 h-3.5" />
              Fechar caixa
            </button>
          )}
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

          {/* Avisos (NotificacoesToggle) */}
          <NotificacoesToggle />

          {/* ── Caixa de hoje ──────────────────────────────────────────────── */}
          {hoje?.sessao ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60">
              {/* Card header */}
              <div className="flex items-center justify-between px-4 pt-3 pb-2">
                <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 uppercase tracking-wide">
                  <span className={`w-2 h-2 rounded-full ${hoje.sessao.status === "fechado" ? "bg-slate-400" : "bg-emerald-500"}`} />
                  {hoje.sessao.status === "fechado" ? "Caixa fechado" : "Caixa aberto"}
                </span>
                <span className="flex items-center gap-1 text-[11px] text-slate-500">
                  <Sun className="w-3.5 h-3.5 text-amber-500" />
                  Aberto {formatHoraSP(hoje.sessao.aberturaAt)}
                </span>
              </div>

              {/* Stats grid — row 1: 3 cols */}
              <div className="grid grid-cols-3 gap-2 px-3 pb-2">
                {[
                  {
                    icon: <Wallet className="w-3.5 h-3.5 text-slate-500" />,
                    bg: "bg-slate-100",
                    label: "Troco inicial",
                    value: formatMoney(parseMoney(hoje.sessao.valorInicial)),
                    color: "text-slate-700",
                  },
                  {
                    icon: <ArrowDownCircle className="w-3.5 h-3.5 text-emerald-600" />,
                    bg: "bg-emerald-100",
                    label: "Entrou (dinheiro)",
                    value: formatMoney(hoje.entradasDinheiro ?? hoje.totalEntradas),
                    color: "text-emerald-700",
                  },
                  {
                    icon: <ArrowUpCircle className="w-3.5 h-3.5 text-red-500" />,
                    bg: "bg-red-100",
                    label: "Saiu (dinheiro)",
                    value: formatMoney(hoje.saidasDinheiro ?? hoje.totalSaidas),
                    color: "text-red-600",
                  },
                ].map((c, i) => (
                  <div key={i} className="bg-white rounded-xl p-2.5 border border-gray-100">
                    <div className={`w-7 h-7 rounded-full ${c.bg} flex items-center justify-center mb-1.5`}>{c.icon}</div>
                    <div className={`text-sm font-bold leading-tight ${c.color}`}>{c.value}</div>
                    <div className="text-[9px] text-slate-400 leading-tight mt-0.5">{c.label}</div>
                  </div>
                ))}
              </div>

              {/* Stats grid — row 2: 2 cols */}
              <div className="grid grid-cols-2 gap-2 px-3 pb-3">
                <div className="bg-white rounded-xl p-2.5 border border-gray-100">
                  <div className="w-7 h-7 rounded-full bg-cyan-100 flex items-center justify-center mb-1.5">
                    <QrCode className="w-3.5 h-3.5 text-cyan-600" />
                  </div>
                  <div className="text-sm font-bold text-cyan-700 leading-tight">{formatMoney(hoje.entradasPix ?? 0)}</div>
                  <div className="text-[9px] text-slate-400 mt-0.5">PIX hoje</div>
                </div>
                <div className="bg-white rounded-xl p-2.5 border border-gray-100">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center">
                      <Wallet className="w-3.5 h-3.5 text-emerald-600" />
                    </div>
                  </div>
                  <div className="text-sm font-bold text-emerald-700 leading-tight">
                    {formatMoney(
                      parseMoney(hoje.sessao.valorInicial) +
                        (hoje.entradasDinheiro ?? hoje.totalEntradas) -
                        (hoje.saidasDinheiro ?? hoje.totalSaidas),
                    )}
                  </div>
                  <div className="text-[9px] text-slate-400 mt-0.5">Em caixa agora</div>
                </div>
              </div>

              {/* Saiu PIX (opcional) */}
              {(hoje.saidasPix ?? 0) > 0 && (
                <div className="mx-3 mb-2 flex justify-between text-xs rounded-lg bg-white border border-gray-100 px-3 py-2">
                  <span className="text-cyan-600">Saiu (PIX)</span>
                  <span className="font-semibold text-cyan-700">{formatMoney(hoje.saidasPix ?? 0)}</span>
                </div>
              )}

              <p className="mx-3 mb-2 text-[10px] leading-tight text-slate-400 italic">
                "Em caixa agora" é só o dinheiro vivo na gaveta. O PIX cai direto na conta e o cartão aparece abaixo — nenhum dos dois entra na gaveta.
              </p>

              {/* Cartão */}
              {hoje.cartao && hoje.cartao.length > 0 && (
                <div className="mx-3 mb-3 rounded-xl border border-blue-200 bg-blue-50/70 p-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-blue-800 mb-1">
                    <CreditCard className="h-3.5 w-3.5" />
                    Cartão hoje (não está na gaveta)
                  </div>
                  <div className="space-y-0.5">
                    {hoje.cartao.map((c) => (
                      <div key={c.forma} className="flex justify-between text-[11px] text-blue-900">
                        <span>{c.label} <span className="text-blue-500">(−{c.taxa.toLocaleString("pt-BR")}%)</span></span>
                        <span className="font-medium">{formatMoney(c.bruto)} → {formatMoney(c.liquido)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t border-blue-200 pt-0.5 text-[11px] font-bold text-blue-900">
                      <span>Você recebe (cartão)</span>
                      <span>{formatMoney(hoje.totalCartaoLiquido ?? 0)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Conferido */}
              {hoje.sessao.status === "fechado" && hoje.sessao.valorContado && (
                <div className="mx-3 mb-2 flex justify-between border-t border-emerald-100 pt-2 text-xs">
                  <span className="font-semibold text-slate-600">Conferido na gaveta</span>
                  <span className="font-bold text-indigo-600">{formatMoney(parseMoney(hoje.sessao.valorContado))}</span>
                </div>
              )}

              {/* Divisão de lucro */}
              {hoje.sessao.status === "fechado" && (
                <div className="px-3 pb-3"><DivisaoLucro dia={hojeStr} enabled={open} /></div>
              )}

              {/* Reabrir / mensagens de travamento */}
              {hoje.sessao.status === "fechado" && (
                hoje.sessao.reaberto ? (
                  <p className="mx-3 mb-3 text-[11px] text-slate-500 italic">Este caixa já foi reaberto uma vez hoje. Não dá pra reabrir de novo.</p>
                ) : agoraMinutosSP() > LIMITE_REABRIR_MIN ? (
                  <p className="mx-3 mb-3 text-[11px] text-slate-500 italic">O horário para reabrir o caixa (até 20:30) já passou.</p>
                ) : (
                  <div className="mx-3 mb-3">
                    <p className="mb-2 text-[11px] text-slate-500">
                      Fechou sem querer? <span className="font-semibold text-amber-700">Só pode reabrir 1 vez por dia, até as 20:30.</span>
                    </p>
                    <Button variant="outline" onClick={reabrirCaixa} disabled={sessaoBusy} className="w-full border-amber-300 text-amber-700 hover:bg-amber-50">
                      <Sun className="mr-2 h-4 w-4" />
                      {sessaoBusy ? "Reabrindo..." : "Reabrir caixa"}
                    </Button>
                  </div>
                )
              )}

              {/* Fechar caixa (inline form) */}
              {hoje.sessao.status !== "fechado" && (
                fecharAberto ? (
                  <div className="mx-3 mb-3 space-y-2 border-t border-emerald-100 pt-3">
                    <label className="text-xs font-semibold text-slate-700">Quanto tem na gaveta agora?</label>
                    <Input inputMode="decimal" placeholder="Ex: 150,00" value={contadoValor} onChange={(e) => setContadoValor(e.target.value)} className="h-11 text-base" />
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setFecharAberto(false)} disabled={sessaoBusy} className="flex-1">Cancelar</Button>
                      <Button onClick={fecharCaixa} disabled={sessaoBusy} className="flex-1 bg-indigo-600 hover:bg-indigo-700">{sessaoBusy ? "Fechando..." : "Confirmar"}</Button>
                    </div>
                  </div>
                ) : (
                  <div className="px-3 pb-3">
                    <Button
                      onClick={() => {
                        const ini = hoje.sessao ? parseMoney(hoje.sessao.valorInicial) : 0;
                        setContadoValor((ini + (hoje.entradasDinheiro ?? hoje.totalEntradas) - (hoje.saidasDinheiro ?? hoje.totalSaidas)).toFixed(2).replace(".", ","));
                        setFecharAberto(true);
                      }}
                      disabled={sessaoBusy}
                      className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 rounded-xl text-sm font-semibold"
                    >
                      <Moon className="mr-2 h-4 w-4" />
                      Fechar caixa agora
                    </Button>
                  </div>
                )
              )}
            </div>
          ) : (
            /* Caixa não aberto hoje */
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-bold text-amber-800">Caixa ainda não foi aberto hoje.</p>
              <p className="mt-0.5 text-xs text-amber-700">Informe o valor inicial (troco) para abrir o caixa.</p>
              <div className="mt-3 flex gap-2">
                <Input inputMode="decimal" placeholder="Ex: 100,00" value={abrirValor} onChange={(e) => setAbrirValor(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") abrirCaixa(); }} className="bg-white" />
                <Button onClick={abrirCaixa} disabled={sessaoBusy} className="shrink-0 bg-emerald-600 hover:bg-emerald-700">
                  <Sun className="mr-2 h-4 w-4" />
                  {sessaoBusy ? "Abrindo..." : "Abrir"}
                </Button>
              </div>
            </div>
          )}

          {/* ── Resumo do período ───────────────────────────────────────────── */}
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-2">Resumo do período:</p>
            <div className="flex flex-wrap gap-1.5">
              {PERIODOS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPeriodo(p.key)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors border ${
                    periodo === p.key
                      ? "bg-emerald-600 text-white border-emerald-600"
                      : "bg-white text-slate-500 border-slate-200 hover:border-emerald-300"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {periodo === "custom" && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">De</label>
                  <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Até</label>
                  <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
                </div>
              </div>
            )}
          </div>

          {/* ── Entradas / Saídas / Saldo ───────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-green-50 border border-green-200 p-3">
              <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center mb-2">
                <ArrowDownCircle className="w-4 h-4 text-green-600" />
              </div>
              <p className="text-[9px] font-bold text-green-700 uppercase tracking-wider">ENTRADAS</p>
              <p className="text-sm font-extrabold text-green-700 mt-0.5">{formatMoney(totalEntradas)}</p>
            </div>
            <div className="rounded-2xl bg-red-50 border border-red-200 p-3">
              <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center mb-2">
                <ArrowUpCircle className="w-4 h-4 text-red-500" />
              </div>
              <p className="text-[9px] font-bold text-red-600 uppercase tracking-wider">SAÍDAS</p>
              <p className="text-sm font-extrabold text-red-600 mt-0.5">{formatMoney(totalSaidas)}</p>
            </div>
            <div className={`rounded-2xl border p-3 ${saldo >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center mb-2 ${saldo >= 0 ? "bg-emerald-100" : "bg-amber-100"}`}>
                <Wallet className={`w-4 h-4 ${saldo >= 0 ? "text-emerald-600" : "text-amber-600"}`} />
              </div>
              <p className={`text-[9px] font-bold uppercase tracking-wider ${saldo >= 0 ? "text-emerald-700" : "text-amber-700"}`}>SALDO</p>
              <p className={`text-sm font-extrabold mt-0.5 ${saldo >= 0 ? "text-emerald-700" : "text-amber-700"}`}>{formatMoney(saldo)}</p>
            </div>
          </div>

          {/* ── Formulário ─────────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            {/* Entrada / Saída tabs */}
            <div className="grid grid-cols-2 border-b border-gray-100">
              <button
                type="button"
                onClick={() => setTipo("entrada")}
                className={`flex items-center justify-center gap-1.5 py-3 text-sm font-semibold transition-colors ${
                  tipo === "entrada" ? "bg-white text-emerald-700 border-b-2 border-emerald-600" : "bg-gray-50 text-slate-400 hover:text-slate-600"
                }`}
              >
                <ArrowDownCircle className="w-4 h-4" /> Entrada
              </button>
              <button
                type="button"
                onClick={() => {
                  setTipo("saida");
                  setVincularPeca(false);
                  setPecaSel(null);
                  setModeloBusca("");
                  if (isCartaoForma(formaPagto)) setFormaPagto("dinheiro");
                }}
                className={`flex items-center justify-center gap-1.5 py-3 text-sm font-semibold transition-colors ${
                  tipo === "saida" ? "bg-white text-red-600 border-b-2 border-red-500" : "bg-gray-50 text-slate-400 hover:text-slate-600"
                }`}
              >
                <ArrowUpCircle className="w-4 h-4" /> Saída
              </button>
            </div>

            <div className="p-3 space-y-3">
              {/* Valor + Motivo */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">Valor (R$)</label>
                  <Input inputMode="decimal" placeholder="220,00" value={valor} onChange={(e) => setValor(e.target.value)} className="h-10" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">Motivo</label>
                  <div className="relative">
                    <Input placeholder="Ex: conta INSS ou G24" value={motivo} onChange={(e) => setMotivo(e.target.value)} className="h-10" />
                    {tipo === "entrada" && motivoSugestoes.length > 0 && (
                      <div className="absolute z-50 left-0 right-0 mt-1 bg-white border rounded-xl shadow-lg overflow-hidden">
                        {motivoSugestoes.map((p) => (
                          <button key={p.id} type="button" disabled={p.quantidade === 0}
                            onClick={() => { setVincularPeca(true); setPecaSel(p); setModeloBusca(`${p.modelo} — ${p.qualidade}`); setMotivo(`Troca de tela (${p.modelo})`); if (!valor) setValor(p.valor); }}
                            className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between gap-2 disabled:opacity-50"
                          >
                            <span className="text-xs"><span className="font-medium">{p.modelo}</span><span className="text-muted-foreground"> — {p.qualidade}</span></span>
                            <span className={`text-[11px] font-semibold shrink-0 ${p.quantidade === 0 ? "text-red-500" : "text-emerald-600"}`}>{p.quantidade === 0 ? "Esgotado" : `${p.quantidade} no estoque`}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Forma de pagamento */}
              <div>
                <label className="text-xs font-semibold text-slate-500 mb-1.5 block">Forma de pagamento</label>
                <div className={`grid gap-1.5 ${tipo === "entrada" ? "grid-cols-3" : "grid-cols-2"}`}>
                  {((tipo === "entrada" ? ["dinheiro", "pix", "debito", "credito_1x", "credito_2x", "credito_3x"] : ["dinheiro", "pix"]) as FormaPagamento[]).map((f) => {
                    const ativo = formaPagto === f;
                    const semTaxa = f === "dinheiro" || f === "pix";
                    const label = f === "dinheiro" ? "Dinheiro" : f === "pix" ? "PIX" : f === "debito" ? "Débito" : f === "credito_1x" ? "Crédito 1x" : f === "credito_2x" ? "Crédito 2x" : "Crédito 3x";
                    return (
                      <button key={f} type="button" onClick={() => setFormaPagto(f)}
                        className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-semibold transition-colors ${
                          ativo ? semTaxa ? "bg-emerald-600 text-white border-emerald-600" : "bg-blue-600 text-white border-blue-600"
                               : "bg-gray-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        {f === "dinheiro" ? <Banknote className="h-3.5 w-3.5" /> : f === "pix" ? <QrCode className="h-3.5 w-3.5" /> : <CreditCard className="h-3.5 w-3.5" />}
                        {label}
                      </button>
                    );
                  })}
                </div>
                {formaPagto === "pix" && (
                  <p className="mt-1.5 text-[11px] text-cyan-700">
                    {tipo === "entrada" ? "PIX — sem taxa, cai direto na conta. NÃO entra na gaveta." : "PIX — sai direto da conta. NÃO sai da gaveta."}
                  </p>
                )}
                {isCartaoForma(formaPagto) && (
                  <p className="mt-1.5 text-[11px] text-blue-700">Cartão — a maquininha desconta {TAXAS_CARTAO[formaPagto as FormaCartao].toLocaleString("pt-BR")}%. Não entra na gaveta.</p>
                )}
              </div>

              {/* Vincular peça */}
              {tipo === "entrada" && (
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input type="checkbox" checked={vincularPeca} onChange={(e) => { setVincularPeca(e.target.checked); if (!e.target.checked) { setPecaSel(null); setModeloBusca(""); } }} className="h-4 w-4 accent-emerald-600 rounded" />
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <Package className="w-3.5 h-3.5 text-slate-400" />
                    É troca de tela / peça (baixa o estoque)
                  </span>
                </label>
              )}
              {tipo === "entrada" && vincularPeca && (
                <div className="relative">
                  <Input placeholder="Digite o modelo... ex: A03 Core" value={modeloBusca} onChange={(e) => { setModeloBusca(e.target.value); setPecaSel(null); }} />
                  {pecaSel && (
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-700">
                      <Check className="w-3.5 h-3.5" />
                      {pecaSel.modelo} — {pecaSel.qualidade} ({pecaSel.quantidade} em estoque)
                    </div>
                  )}
                  {!pecaSel && sugestoes.length > 0 && (
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-white border rounded-xl shadow-lg overflow-hidden">
                      {sugestoes.map((p) => (
                        <button key={p.id} type="button" onClick={() => selecionarPeca(p)} className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between gap-2">
                          <span className="text-sm"><span className="font-medium">{p.modelo}</span><span className="text-muted-foreground"> — {p.qualidade}</span></span>
                          <span className={`text-xs font-semibold shrink-0 ${p.quantidade > 0 ? "text-emerald-600" : "text-red-500"}`}>{p.quantidade} un.</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {!pecaSel && modeloBusca.trim().length > 0 && sugestoes.length === 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">Nenhuma peça encontrada no estoque.</p>
                  )}
                </div>
              )}

              {/* Submit */}
              <Button className={`w-full h-11 rounded-xl text-sm font-semibold ${tipo === "entrada" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}`} onClick={onSubmit} disabled={createCaixa.isPending}>
                {createCaixa.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : tipo === "entrada" ? <Check className="mr-2 h-4 w-4" /> : <ArrowUpCircle className="mr-2 h-4 w-4" />}
                Registrar {tipo === "entrada" ? "entrada" : "saída"}
              </Button>
            </div>
          </div>

          {/* ── Lançamentos de hoje ─────────────────────────────────────────── */}
          <div>
            <p className="text-sm font-bold text-slate-700 mb-2">Lançamentos de hoje</p>
            {hojeMovLoading ? (
              <div className="text-center py-6 text-muted-foreground text-sm">Carregando...</div>
            ) : hojeTravado ? (
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 px-4 py-5 text-center text-sm text-slate-600">
                Os lançamentos de hoje já foram arquivados.{" "}
                <span className="font-semibold text-indigo-700">Abra o Histórico</span> abaixo para ver.
              </div>
            ) : movimentosHoje.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">Nenhuma movimentação hoje ainda.</div>
            ) : (
              <div className="space-y-1.5">
                {movimentosHoje.map((m) => {
                  const isEntrada = m.tipo === "entrada";
                  return (
                    <div key={m.id} className="flex items-center gap-3 rounded-2xl border bg-white px-3 py-2.5">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${isEntrada ? "bg-emerald-100" : "bg-red-100"}`}>
                        {isEntrada ? <ArrowDownCircle className="w-4 h-4 text-emerald-600" /> : <ArrowUpCircle className="w-4 h-4 text-red-500" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 truncate">{m.motivo}</p>
                        <p className="text-[11px] text-slate-400">
                          {format(new Date(m.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                          {m.modelo ? ` · ${m.modelo}` : ""}
                          {m.formaPagamento ? ` · ${m.formaPagamento === "pix" ? "PIX" : m.formaPagamento === "dinheiro" ? "Dinheiro" : m.formaPagamento === "debito" ? "Débito" : m.formaPagamento === "credito_1x" ? "Créd 1x" : m.formaPagamento === "credito_2x" ? "Créd 2x" : m.formaPagamento === "credito_3x" ? "Créd 3x" : m.formaPagamento}` : ""}
                        </p>
                      </div>
                      <span className={`text-sm font-bold shrink-0 ${isEntrada ? "text-emerald-700" : "text-red-600"}`}>
                        {isEntrada ? "+" : "−"}{formatMoney(parseMoney(m.valor))}
                      </span>
                      <button onClick={() => onDelete(m)} className="text-slate-300 hover:text-red-500 transition-colors shrink-0" title="Excluir">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Histórico de fechamentos ────────────────────────────────────── */}
          <div className="pb-2">
            <button
              type="button"
              onClick={() => setShowHistorico((v) => !v)}
              className="flex w-full items-center justify-between py-2 text-sm font-bold text-slate-700"
            >
              <span className="flex items-center gap-2">
                <History className="h-4 w-4 text-indigo-500" />
                Histórico de fechamentos
              </span>
              {showHistorico ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
            </button>

            {showHistorico && (
              <div className="mt-2 space-y-2">
                {fechamentos.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">Nenhum fechamento registrado ainda.</p>
                ) : (
                  fechamentos.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setDiaDetalhe(s)}
                      className="w-full text-left rounded-2xl border bg-white p-3 flex items-center gap-3 hover:bg-gray-50 active:scale-[0.99] transition-all"
                    >
                      {/* Date badge */}
                      <div className="shrink-0 w-12 text-center">
                        <div className="text-xl font-extrabold text-slate-800 leading-none">
                          {format(new Date(`${s.data}T12:00:00`), "dd", { locale: ptBR })}
                        </div>
                        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">
                          {format(new Date(`${s.data}T12:00:00`), "MMM", { locale: ptBR })}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-700 capitalize">
                          {format(new Date(`${s.data}T12:00:00`), "EEEE, dd/MM", { locale: ptBR })}
                        </p>
                        <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <Sun className="h-3 w-3 text-amber-500" />
                          Aberto {formatHoraSP(s.aberturaAt)}
                          {s.fechamentoAt && <><Moon className="h-3 w-3 text-indigo-400 ml-1" /> Fechou {formatHoraSP(s.fechamentoAt)}</>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${s.status === "fechado" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                          {s.status === "fechado" ? "Fechado" : "Aberto"}
                        </span>
                        <ChevronRight className="h-4 w-4 text-slate-300" />
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

        </div>
      </DialogContent>

      {/* Detalhe de um dia do histórico */}
      <Dialog
        open={open && !!diaDetalhe}
        onOpenChange={(v) => !v && setDiaDetalhe(null)}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <History className="h-5 w-5 text-indigo-600" />
              {diaDetalhe
                ? format(
                    new Date(`${diaDetalhe.data}T12:00:00`),
                    "EEEE, dd/MM/yyyy",
                    { locale: ptBR },
                  )
                : ""}
            </DialogTitle>
          </DialogHeader>

          {diaDetalhe && (
            <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Sun className="h-3.5 w-3.5 text-amber-500" />
                Abriu {formatHoraSP(diaDetalhe.aberturaAt)}
              </span>
              {diaDetalhe.fechamentoAt && (
                <span className="flex items-center gap-1">
                  <Moon className="h-3.5 w-3.5 text-indigo-500" />
                  Fechou {formatHoraSP(diaDetalhe.fechamentoAt)}
                </span>
              )}
            </div>
          )}

          {detalheData && (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-green-200 bg-green-50 p-2 text-center">
                <p className="text-[10px] font-medium uppercase tracking-wider text-green-700">
                  Entrou no dia
                </p>
                <p className="text-sm font-bold text-green-700">
                  {formatMoney(detalheData.totalEntradas)}
                </p>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-center">
                <p className="text-[10px] font-medium uppercase tracking-wider text-red-700">
                  Saiu no dia
                </p>
                <p className="text-sm font-bold text-red-700">
                  {formatMoney(detalheData.totalSaidas)}
                </p>
              </div>
            </div>
          )}

          {diaDetalhe && (
            <DivisaoLucro
              dia={diaDetalhe.data}
              enabled={open && !!diaDetalhe}
            />
          )}

          {detalheLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Carregando...
            </div>
          ) : !detalheData || detalheData.movimentos.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma movimentação neste dia.
            </div>
          ) : (
            <div className="space-y-2">
              {detalheData.movimentos.map((m) => {
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
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
