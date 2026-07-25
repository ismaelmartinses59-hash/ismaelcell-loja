import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Sun,
  Moon,
  ArrowUpCircle,
  ArrowDownCircle,
  Wallet,
  CreditCard,
  QrCode,
  Banknote,
  Package,
  Check,
  Plus,
  X,
} from "lucide-react";
import {
  type FormaPagamento,
  type FormaCartao,
  TAXAS_CARTAO,
  isCartaoForma,
} from "../lib/formas-pagamento";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const HORA_ABERTURA = 8; // 08:00 todos os dias úteis
const HORA_FECHAMENTO_SEMANA = 18; // seg–sex 18:00
const HORA_FECHAMENTO_SABADO = 13; // sábado 13:00

interface Sessao {
  id: number;
  data: string;
  status: string;
  valorInicial: string;
  valorFinal: string | null;
  totalEntradas: string | null;
  totalSaidas: string | null;
  aberturaAt: string;
  fechamentoAt: string | null;
}

interface ContaResumo {
    conta: { id: number; nome: string; tipo: string };
    saldo: number;
    totalItens: number;
    totalPago: number;
  }

  interface Peca {
  id: number;
  modelo: string;
  qualidade: string;
  valor: string;
  quantidade: number;
  setor: string;
}

interface CartaoItem {
  forma: string;
  label: string;
  taxa: number;
  bruto: number;
  liquido: number;
}

interface StatusResp {
  sessao: Sessao | null;
  totalEntradas: number;
  totalSaidas: number;
  saldo: number;
  entradasDinheiro?: number;
  entradasPix?: number;
  cartao?: CartaoItem[];
  totalCartao?: number;
  totalCartaoLiquido?: number;
}

function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

function formatMoney(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseValor(raw: string): number {
  if (!raw) return 0;
  return parseFloat(raw.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")) || 0;
}

export function CaixaSessaoGuard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [now, setNow] = useState(() => new Date());
  const [valorInicial, setValorInicial] = useState("");
  const [valorContado, setValorContado] = useState("");
  const [contadoTouched, setContadoTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Venda de última hora (cliente chega na hora de fechar)
  const [showVenda, setShowVenda] = useState(false);
  const [vValor, setVValor] = useState("");
  const [vMotivo, setVMotivo] = useState("");
  const [vForma, setVForma] = useState<FormaPagamento>("dinheiro");
  const [vVincular, setVVincular] = useState(false);
  const [vBusca, setVBusca] = useState("");
  const [vPecaSel, setVPecaSel] = useState<Peca | null>(null);
  const [vSubmitting, setVSubmitting] = useState(false);
    // Fiado: anota a venda na conta de um devedor em vez de entrar no caixa
    const [vFiado, setVFiado] = useState(false);
    const [vDevedor, setVDevedor] = useState("");
    const [vContaSel, setVContaSel] = useState<ContaResumo | null>(null);
    const [avSubmitting, setAvSubmitting] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // Hora/data SEMPRE no fuso de São Paulo, independente do fuso do aparelho.
  const spNow = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }),
  );
  const data = localDate(spNow);

  // IMPORTANTE: se a chamada falhar (servidor reiniciando/rede oscilando), NÃO
  // assuma "sem sessão" — isso faria o overlay pedir para ABRIR o caixa mesmo
  // ele já estando fechado. Lançamos o erro para o react-query manter o último
  // estado bom e tentar de novo, em vez de sobrescrever com sessao: null.
  const { data: status, refetch } = useQuery<StatusResp>({
    queryKey: ["caixa-sessao", data],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/caixa-sessoes`);
      if (!r.ok) throw new Error("status do caixa indisponível");
      return r.json();
    },
    refetchInterval: 30000,
    retry: 3,
    staleTime: 15000,
  });

  const dow = spNow.getDay(); // 0 = domingo, 6 = sábado
  const nowMin = spNow.getHours() * 60 + spNow.getMinutes();
  const openMin = HORA_ABERTURA * 60;
  const closeMin =
    (dow === 6 ? HORA_FECHAMENTO_SABADO : HORA_FECHAMENTO_SEMANA) * 60;

  let mode: "abrir" | "fechar" | null = null;
  if (dow !== 0 && status) {
    const sessao = status.sessao;
    if (!sessao && nowMin >= openMin) mode = "abrir";
    else if (sessao && sessao.status === "aberto" && nowMin >= closeMin)
      mode = "fechar";
  }

  const valIni = status?.sessao ? parseValor(status.sessao.valorInicial) : 0;
  const entradas = status?.entradasDinheiro ?? status?.totalEntradas ?? 0;
  const saidas = status?.totalSaidas ?? 0;
  const valFinal = valIni + entradas - saidas;
  const pix = status?.entradasPix ?? 0;
  const totalGeral = valFinal + pix;
  const cartao = status?.cartao ?? [];
  const totalCartaoLiquido = status?.totalCartaoLiquido ?? 0;

  // Pré-preenche o valor conferido com o esperado (até o usuário ajustar).
  useEffect(() => {
    if (mode === "fechar" && !contadoTouched) {
      setValorContado(valFinal.toFixed(2).replace(".", ","));
    }
  }, [mode, valFinal, contadoTouched]);

  const { data: pecas = [] } = useQuery<Peca[]>({
    queryKey: ["caixa-sessao-pecas"],
    enabled: mode === "fechar" && showVenda,
    queryFn: async () => {
      const [lojista, cliente] = await Promise.all([
        fetch(`${BASE}/api/pecas?setor=lojista`).then((r) => (r.ok ? r.json() : [])),
        fetch(`${BASE}/api/pecas?setor=cliente`).then((r) => (r.ok ? r.json() : [])),
      ]);
      const all: Peca[] = [...lojista, ...cliente];
      const seen = new Set<string>();
      const dedup: Peca[] = [];
      for (const p of all) {
        const key = `${p.modelo.trim().toLowerCase()}__${p.qualidade.trim().toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dedup.push(p);
      }
      return dedup;
    },
  });

    const { data: contasFiado = [] } = useQuery<ContaResumo[]>({
      queryKey: ["caixa-sessao-contas"],
      enabled: mode === "fechar" && showVenda && vFiado,
      queryFn: async () => {
        const r = await fetch(`${BASE}/api/contas-receber`);
        return r.ok ? r.json() : [];
      },
    });

    const vDevSugestoes = useMemo(() => {
      const q = vDevedor.trim().toLowerCase();
      if (!q || vContaSel) return [];
      return contasFiado
        .filter((c) => c.conta.nome.toLowerCase().includes(q))
        .slice(0, 5);
    }, [vDevedor, vContaSel, contasFiado]);

  const vSugestoes = useMemo(() => {
    const q = vBusca.trim().toLowerCase();
    if (!q) return [];
    return pecas
      .filter(
        (p) =>
          p.modelo.toLowerCase().includes(q) ||
          p.qualidade.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [vBusca, pecas]);

  // Sugestões de peças ao digitar o motivo (ex: "Note 60")
  const vMotivoSugestoes = useMemo(() => {
    if (vPecaSel) return [];
    const norm = (t: string) =>
      t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    const q = norm(vMotivo);
    if (q.length < 2) return [];
    const palavras = q.split(" ").filter((w) => w.length >= 2 && !["do", "da", "de", "conta", "troca", "tela", "venda"].includes(w));
    if (palavras.length === 0) return [];
    return pecas
      .filter((p) => {
        const m = norm(`${p.modelo} ${p.qualidade}`);
        return palavras.every((w) => m.includes(w));
      })
      .slice(0, 5);
  }, [vMotivo, vPecaSel, pecas]);

  const selecionarVPeca = (p: Peca) => {
    setVPecaSel(p);
    setVBusca(`${p.modelo} — ${p.qualidade}`);
    if (!vValor) setVValor(p.valor);
    if (!vMotivo) setVMotivo(`Venda de ${p.modelo}`);
  };

  const resetVenda = () => {
    setVValor("");
    setVMotivo("");
    setVForma("dinheiro");
    setVVincular(false);
    setVBusca("");
    setVPecaSel(null);
      setVFiado(false);
      setVDevedor("");
      setVContaSel(null);
      setShowVenda(false);
  };

  const registrarVenda = async () => {
    if (!vValor.trim()) {
      toast({ title: "Informe o valor", variant: "destructive" });
      return;
    }
    if (!vMotivo.trim()) {
      toast({ title: "Diga o que foi (motivo)", variant: "destructive" });
      return;
    }
    if (vVincular && !vPecaSel) {
        toast({ title: "Selecione a peça na lista", variant: "destructive" });
        return;
      }
      if (vFiado && !vDevedor.trim()) {
        toast({ title: "Diga o nome do devedor", variant: "destructive" });
        return;
      }
      setVSubmitting(true);
      try {
        if (vFiado) {
          // Fiado: anota na conta do devedor (não entra no caixa agora)
          let r: Response;
          if (vVincular && vPecaSel) {
            // Peça do estoque: dá baixa + anota na conta numa venda só
            r = await fetch(`${BASE}/api/pecas/${vPecaSel.id}/vender`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                fiado: true,
                nomeDevedor: vContaSel ? vContaSel.conta.nome : vDevedor.trim(),
                tipoDevedor: vContaSel ? vContaSel.conta.tipo : "cliente",
              }),
            });
          } else if (vContaSel) {
            r = await fetch(`${BASE}/api/contas-receber/${vContaSel.conta.id}/item`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ descricao: vMotivo.trim(), valor: vValor.trim() }),
            });
          } else {
            r = await fetch(`${BASE}/api/contas-receber/novo-servico`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                nome: vDevedor.trim(),
                tipo: "cliente",
                descricao: vMotivo.trim(),
                valor: vValor.trim(),
              }),
            });
          }
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            throw new Error(j.error || "Erro ao anotar o fiado");
          }
          toast({ title: "Fiado anotado na conta! 📝" });
          resetVenda();
          await qc.invalidateQueries({ queryKey: ["contas-receber"] });
          await qc.invalidateQueries({ queryKey: ["caixa-sessao-contas"] });
          await qc.invalidateQueries({ queryKey: ["pecas"] });
          await qc.invalidateQueries({ queryKey: ["caixa-pecas"] });
          await qc.invalidateQueries({ queryKey: ["vendas"] });
          return;
        }
      const r = await fetch(`${BASE}/api/caixa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "entrada",
          valor: vValor.trim(),
          motivo: vMotivo.trim(),
          formaPagamento: vForma,
          pecaId: vVincular && vPecaSel ? vPecaSel.id : null,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Erro ao registrar");
      }
      toast({ title: "Venda registrada! 👍" });
      resetVenda();
      setContadoTouched(false); // deixa o valor conferido recalcular com a nova entrada
      await qc.invalidateQueries({ queryKey: ["caixa-sessao", data] });
      await qc.invalidateQueries({ queryKey: ["caixa-historico"] });
      await qc.invalidateQueries({ queryKey: ["pecas"] });
      await qc.invalidateQueries({ queryKey: ["caixa-pecas"] });
      await qc.invalidateQueries({ queryKey: ["vendas"] });
      await refetch();
    } catch (e) {
      toast({
        title: "Erro ao registrar a venda",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setVSubmitting(false);
    }
  };

  const receberAV = async () => {
      if (!vContaSel) return;
      if (!vValor.trim()) {
        toast({ title: "Informe o valor do AV", variant: "destructive" });
        return;
      }
      setAvSubmitting(true);
      try {
        const r = await fetch(`${BASE}/api/contas-receber/${vContaSel.conta.id}/pagamento`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ valor: vValor.trim(), formaPagamento: vForma }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || "Erro ao registrar o AV");
        }
        toast({ title: `AV recebido de ${vContaSel.conta.nome}! 💰` });
        resetVenda();
        setContadoTouched(false);
        await qc.invalidateQueries({ queryKey: ["contas-receber"] });
        await qc.invalidateQueries({ queryKey: ["caixa-sessao-contas"] });
        await qc.invalidateQueries({ queryKey: ["caixa-historico"] });
        await refetch();
      } catch (e) {
        toast({
          title: "Erro ao registrar o AV",
          description: e instanceof Error ? e.message : undefined,
          variant: "destructive",
        });
      } finally {
        setAvSubmitting(false);
      }
    };

    const abrir = async () => {
    if (!valorInicial.trim()) {
      toast({ title: "Informe o valor inicial (troco)", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch(`${BASE}/api/caixa-sessoes/abrir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valorInicial: valorInicial.trim() }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Erro ao abrir");
      }
      toast({ title: "Caixa aberto! Bom trabalho 👍" });
      setValorInicial("");
      await qc.invalidateQueries({ queryKey: ["caixa-sessao", data] });
      await qc.invalidateQueries({ queryKey: ["caixa-historico"] });
      await refetch();
    } catch (e) {
      toast({
        title: "Erro ao abrir o caixa",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const fechar = async () => {
    setSubmitting(true);
    try {
      const r = await fetch(`${BASE}/api/caixa-sessoes/fechar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valorContado: valorContado.trim() }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Erro ao fechar");
      }
      toast({ title: "Caixa fechado! Até amanhã 👋" });
      setValorContado("");
      setContadoTouched(false);
      await qc.invalidateQueries({ queryKey: ["caixa-sessao", data] });
      await qc.invalidateQueries({ queryKey: ["caixa-historico"] });
      await refetch();
    } catch (e) {
      toast({
        title: "Erro ao fechar o caixa",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!mode) return null;

  const horaAlvo = mode === "abrir" ? openMin : closeMin;
  const horaAlvoStr = `${String(Math.floor(horaAlvo / 60)).padStart(2, "0")}:00`;

  const contadoNum = parseValor(valorContado);
  const diferenca = contadoNum - valFinal;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/95 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl overflow-hidden">
        {mode === "abrir" ? (
          <>
            <div className="bg-gradient-to-br from-amber-400 to-orange-500 px-6 py-7 text-center text-white">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/20">
                <Sun className="h-9 w-9" />
              </div>
              <h2 className="text-2xl font-extrabold">Hora de abrir o caixa!</h2>
              <p className="mt-1 text-sm text-white/90">
                O caixa deve abrir às {horaAlvoStr}. Agora são {hhmm(spNow)}.
              </p>
            </div>
            <div className="px-6 py-6 space-y-4">
              <div>
                <label className="text-sm font-semibold text-slate-700">
                  Quanto tem de troco pra começar? (R$)
                </label>
                <Input
                  inputMode="decimal"
                  autoFocus
                  placeholder="Ex: 150,00"
                  value={valorInicial}
                  onChange={(e) => setValorInicial(e.target.value)}
                  className="mt-1.5 h-12 text-lg"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !submitting) abrir();
                  }}
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  É o dinheiro que já está na gaveta pra dar troco.
                </p>
              </div>
              <Button
                className="h-12 w-full text-base font-bold"
                onClick={abrir}
                disabled={submitting}
              >
                {submitting && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                Abrir caixa
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 px-6 py-7 text-center text-white">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/20">
                <Moon className="h-9 w-9" />
              </div>
              <h2 className="text-2xl font-extrabold">Hora de fechar o caixa!</h2>
              <p className="mt-1 text-sm text-white/90">
                O caixa fecha às {horaAlvoStr}. Agora são {hhmm(spNow)}.
              </p>
            </div>
            <div className="px-6 py-6 space-y-4">
              <div className="rounded-2xl border bg-slate-50 p-4 space-y-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-slate-600">
                    <Wallet className="h-4 w-4" /> Troco inicial
                  </span>
                  <span className="font-semibold text-slate-800">
                    {formatMoney(valIni)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-green-600">
                    <ArrowUpCircle className="h-4 w-4" /> Entradas (dinheiro)
                  </span>
                  <span className="font-semibold text-green-700">
                    +{formatMoney(entradas)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-red-600">
                    <ArrowDownCircle className="h-4 w-4" /> Saídas
                  </span>
                  <span className="font-semibold text-red-700">
                    −{formatMoney(saidas)}
                  </span>
                </div>
                <div className="border-t pt-2.5 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
                    <Wallet className="h-4 w-4" /> Na gaveta (dinheiro)
                  </span>
                  <span className="text-lg font-extrabold text-emerald-600">
                    {formatMoney(valFinal)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-bold text-cyan-700">
                    <QrCode className="h-4 w-4" /> No PIX
                  </span>
                  <span className="text-lg font-extrabold text-cyan-700">
                    {formatMoney(pix)}
                  </span>
                </div>
                <div className="border-t border-slate-300 pt-2.5 flex items-center justify-between">
                  <span className="text-sm font-extrabold text-slate-800">
                    Total (gaveta + PIX)
                  </span>
                  <span className="text-xl font-extrabold text-slate-900">
                    {formatMoney(totalGeral)}
                  </span>
                </div>
              </div>
              {cartao.length > 0 && (
                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-bold text-blue-800">
                    <CreditCard className="h-4 w-4" /> Vendas no cartão
                  </div>
                  <p className="text-xs text-blue-600">
                    Esse dinheiro NÃO está na gaveta — cai na conta (a maquininha
                    já desconta a taxa).
                  </p>
                  {cartao.map((c) => (
                    <div
                      key={c.forma}
                      className="flex items-center justify-between text-xs text-blue-900"
                    >
                      <span>
                        {c.label}{" "}
                        <span className="text-blue-500">
                          (−{c.taxa.toLocaleString("pt-BR")}%)
                        </span>
                      </span>
                      <span className="font-medium">
                        {formatMoney(c.bruto)} → {formatMoney(c.liquido)}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-blue-200 pt-2 text-sm font-bold text-blue-900">
                    <span>Você recebe (cartão)</span>
                    <span>{formatMoney(totalCartaoLiquido)}</span>
                  </div>
                </div>
              )}
              {!showVenda ? (
                <button
                  type="button"
                  onClick={() => setShowVenda(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50 py-3 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-100"
                >
                  <Plus className="h-4 w-4" /> Entrou uma venda de última hora?
                </button>
              ) : (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                      <Banknote className="h-4 w-4" /> Venda de última hora
                    </span>
                    <button
                      type="button"
                      onClick={resetVenda}
                      className="rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                      aria-label="Fechar"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-slate-600">
                      Valor (R$)
                    </label>
                    <Input
                      inputMode="decimal"
                      placeholder="Ex: 40,00"
                      value={vValor}
                      onChange={(e) => setVValor(e.target.value)}
                      className="mt-1 h-11"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-slate-600">
                      Forma de pagamento
                    </label>
                    <div className="mt-1 grid grid-cols-3 gap-1">
                      {(
                        [
                          "dinheiro",
                          "pix",
                          "debito",
                          "credito_1x",
                          "credito_2x",
                          "credito_3x",
                        ] as FormaPagamento[]
                      ).map((f) => {
                        const ativo = vForma === f;
                        const semTaxa = f === "dinheiro" || f === "pix";
                        const short =
                          f === "dinheiro"
                            ? "Dinheiro"
                            : f === "pix"
                              ? "PIX"
                              : f === "debito"
                                ? "Débito"
                                : f === "credito_1x"
                                  ? "Créd 1x"
                                  : f === "credito_2x"
                                    ? "Créd 2x"
                                    : "Créd 3x";
                        return (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setVForma(f)}
                            className={`flex flex-col items-center justify-center gap-0.5 rounded-lg border py-1.5 text-[10px] font-semibold transition-colors ${
                              ativo
                                ? semTaxa
                                  ? "bg-emerald-600 text-white border-emerald-600"
                                  : "bg-blue-600 text-white border-blue-600"
                                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                            }`}
                          >
                            {f === "dinheiro" ? (
                              <Banknote className="h-3.5 w-3.5" />
                            ) : f === "pix" ? (
                              <QrCode className="h-3.5 w-3.5" />
                            ) : (
                              <CreditCard className="h-3.5 w-3.5" />
                            )}
                            {short}
                          </button>
                        );
                      })}
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                          setVFiado(!vFiado);
                          if (vFiado) {
                            setVDevedor("");
                            setVContaSel(null);
                          }
                        }}
                        className={`mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-bold transition-colors ${
                          vFiado
                            ? "bg-amber-500 text-white border-amber-500"
                            : "bg-white text-amber-700 border-amber-300 hover:bg-amber-50"
                        }`}
                      >
                        📒 Fiado (anotar na conta de alguém)
                      </button>
                      {vFiado && (
                        <p className="mt-1 text-[11px] text-amber-700">
                          Fiado NÃO entra no caixa agora — fica anotado na conta
                          do devedor.
                        </p>
                      )}
                      {!vFiado && vForma === "pix" && (
                      <p className="mt-1 text-[11px] text-cyan-700">
                        PIX — sem taxa, cai na conta. NÃO entra na gaveta (fica
                        separado do dinheiro).
                      </p>
                    )}
                    {!vFiado && isCartaoForma(vForma) && (
                      <p className="mt-1 text-[11px] text-blue-700">
                        Cartão — a maquininha desconta{" "}
                        {TAXAS_CARTAO[vForma as FormaCartao].toLocaleString(
                          "pt-BR",
                        )}
                        %. Não entra na gaveta.
                      </p>
                    )}
                  </div>

                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={vVincular}
                      onChange={(e) => {
                        setVVincular(e.target.checked);
                        if (!e.target.checked) {
                          setVPecaSel(null);
                          setVBusca("");
                        }
                      }}
                      className="h-4 w-4 accent-emerald-600"
                    />
                    <span className="flex items-center gap-1.5 text-slate-700">
                      <Package className="w-3.5 h-3.5 text-slate-500" />É peça do
                      estoque (dá baixa)
                    </span>
                  </label>

                  {vVincular && (
                    <div className="relative">
                      <Input
                        placeholder="Digite o modelo... ex: carregador"
                        value={vBusca}
                        onChange={(e) => {
                          setVBusca(e.target.value);
                          setVPecaSel(null);
                        }}
                        className="h-11"
                      />
                      {vPecaSel && (
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-700">
                          <Check className="w-3.5 h-3.5" />
                          {vPecaSel.modelo} — {vPecaSel.qualidade} (
                          {vPecaSel.quantidade} em estoque)
                        </div>
                      )}
                      {!vPecaSel && vSugestoes.length > 0 && (
                        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg overflow-hidden">
                          {vSugestoes.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => selecionarVPeca(p)}
                              className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between gap-2"
                            >
                              <span className="text-sm">
                                <span className="font-medium">{p.modelo}</span>
                                <span className="text-slate-500">
                                  {" "}
                                  — {p.qualidade}
                                </span>
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
                      {!vPecaSel &&
                        vBusca.trim().length > 0 &&
                        vSugestoes.length === 0 && (
                          <p className="mt-1 text-xs text-slate-500">
                            Nenhuma peça encontrada no estoque.
                          </p>
                        )}
                    </div>
                  )}

                  {vFiado && (
                      <div className="relative">
                        <label className="text-xs font-medium text-slate-600">
                          Nome do devedor
                        </label>
                        <Input
                          placeholder="Digite o nome..."
                          value={vDevedor}
                          onChange={(e) => {
                            setVDevedor(e.target.value);
                            setVContaSel(null);
                          }}
                          className="mt-1 h-11"
                        />
                        {!vContaSel && vDevSugestoes.length > 0 && (
                          <div className="absolute z-50 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg overflow-hidden">
                            {vDevSugestoes.map((c) => (
                              <button
                                key={c.conta.id}
                                type="button"
                                onClick={() => {
                                  setVContaSel(c);
                                  setVDevedor(c.conta.nome);
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between gap-2"
                              >
                                <span className="text-sm font-medium">{c.conta.nome}</span>
                                <span className={`text-xs font-semibold shrink-0 ${c.saldo > 0 ? "text-red-500" : "text-emerald-600"}`}>
                                  {c.saldo > 0 ? `Deve ${formatMoney(c.saldo)}` : "Em dia"}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        {vContaSel && (
                          <div className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-1.5">
                            <p className="text-xs text-amber-800">
                              <b>{vContaSel.conta.nome}</b> —{" "}
                              {vContaSel.saldo > 0 ? (
                                <>dívida atual: <b>{formatMoney(vContaSel.saldo)}</b></>
                              ) : (
                                "conta em dia"
                              )}
                            </p>
                            {vContaSel.saldo > 0 && (
                              <button
                                type="button"
                                onClick={receberAV}
                                disabled={avSubmitting}
                                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                              >
                                {avSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                💰 Receber AV (abater da dívida) — usa o valor acima
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
  
                  <div>
                    <label className="text-xs font-medium text-slate-600">
                      O que foi? (motivo)
                    </label>
                    <div className="relative mt-1">
                      <Input
                        placeholder="Ex: Note 60, carregador..."
                        value={vMotivo}
                        onChange={(e) => setVMotivo(e.target.value)}
                        className="h-11"
                      />
                      {vMotivoSugestoes.length > 0 && (
                        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg overflow-hidden">
                          {vMotivoSugestoes.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              disabled={p.quantidade === 0}
                              onClick={() => {
                                setVVincular(true);
                                setVPecaSel(p);
                                setVBusca(`${p.modelo} — ${p.qualidade}`);
                                setVMotivo(`Venda de ${p.modelo}`);
                                if (!vValor) setVValor(p.valor);
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between gap-2 disabled:opacity-50"
                            >
                              <span className="text-xs">
                                <span className="font-medium">{p.modelo}</span>
                                <span className="text-muted-foreground"> — {p.qualidade}</span>
                              </span>
                              <span className={`text-[11px] font-semibold shrink-0 ${p.quantidade === 0 ? "text-red-500" : "text-emerald-600"}`}>
                                {p.quantidade === 0 ? "Esgotado" : `${p.quantidade} no estoque`}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <Button
                    className="h-11 w-full font-bold"
                    onClick={registrarVenda}
                    disabled={vSubmitting}
                  >
                    {vSubmitting && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {vFiado ? "Anotar fiado na conta" : "Registrar entrada"}
                  </Button>
                </div>
              )}
              <div>
                <label className="text-sm font-semibold text-slate-700">
                  Quanto tem na gaveta agora? (R$)
                </label>
                <Input
                  inputMode="decimal"
                  placeholder="Ex: 150,00"
                  value={valorContado}
                  onChange={(e) => {
                    setContadoTouched(true);
                    setValorContado(e.target.value);
                  }}
                  className="mt-1.5 h-12 text-lg"
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Conte o dinheiro e confira. Ajuste se esqueceu de lançar
                  alguma entrada ou saída.
                </p>
                {Math.abs(diferenca) >= 0.01 && (
                  <p
                    className={`mt-1.5 text-xs font-semibold ${
                      diferenca > 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {diferenca > 0
                      ? `Sobrando ${formatMoney(diferenca)} a mais que o esperado.`
                      : `Faltando ${formatMoney(Math.abs(diferenca))} em relação ao esperado.`}
                  </p>
                )}
              </div>
              <Button
                className="h-12 w-full text-base font-bold"
                onClick={fechar}
                disabled={submitting || vSubmitting}
              >
                {submitting && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                Fechar caixa
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
