import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownRight, Bot, Download, LockKeyhole, MessageCircle, Mic, Package, Send, Square, Volume2, VolumeX, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { requestMicrophone, turnOffMicrophone, useMicrophoneActive } from "@/lib/microphone";
import { ReservaUtilizacaoPanel } from "./reserva-utilizacao-panel";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const FINANCIAL_NOTES_HIDDEN_AT = "finance-ai-warnings-hidden-after-message-at";
const fmt = (n: number | null) => n === null
  ? "Sem dados" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const todaySP = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
}).format(new Date());

type Alert = { nivel: "risco" | "atencao" | "positivo"; titulo: string; texto: string; aconteceu: string; dado: string; impacto: string; continuidade: string; sugestao: string };
type FinanceSnapshot = {
  atualizadoEm: string;
  ultimoFechamentoCaixa: string | null;
  conciliacaoReservaPendente: string | null;
  saldos: {
    dinheiro: number | null; pix: number; total: number | null;
    reserva: number; protecaoAtiva: boolean; disponivel: number | null;
    podeGastar: number | null; base: string;
  };
  metaCompra: number;
  reservaAutomatica: {
    reservaSemana: number; aporte: number; entradaNova: number; percentual: number;
    entradasSemana: number; protecaoPendente: number; compraProtegida: number; contasProtegidas: number;
    estado: "pausada" | "sem_saldo" | "iniciando" | "sem_entradas" | "sem_aumento" | "acumulando" | "fechamento";
  };
  movimentoSemana: {
    inicio: string;
    fim: string;
    entradas: number;
    saidas: number;
    percentualProtecao: number;
    protecao: number;
    projecaoOperacaoSemana: number;
    alocacaoOperacao: number;
    operacaoPendente: number;
    saldoOperacionalAntesPedidos: number;
    saldoOperacionalAnterior: number; saldoCarryInSemana: number;
    saidasSegunda: number;
    saidasPedidosEstoque: number;
    saidasCicloAnterior: number;
    saidasOperacionais: number;
    saldoOperacionalDisponivel: number;
    resultadoOperacionalSemana: number;
    aberturaRealNoPeriodo: boolean;
    consolidadoNaAbertura: { abertura: string; entradas: number; saidas: number; liquido: number; operacao: number; protecao: number } | null;
    necessidadeOperacional: number;
    saldoOperacional: number;
    entradasSemForma: number;
    saidasSemForma: number;
  };
  faltamMeta: number | null;
  semana: { entradas: number; saidas: number; retiradas: number; compras: number; lucro: number | null; custoAusente: boolean };
  historicoSemanal: {
    inicio: string;
    fim: string;
    entradas: number;
    saidas: number;
    liquido: number;
    saidasPorCategoria: Record<string, number>;
    saidasPagasPelaReserva: number;
    registros: {
      id: number;
      data: string;
      tipo: string;
      valor: number;
      formaPagamento: string | null;
      categoria: string | null;
      motivo: string;
      observacao: string | null;
      pagaPelaReserva: boolean;
    }[];
  }[];
  mes: { entradas: number; saidas: number; lucro: number | null };
  compras: { totalSemana: number; mediaSemanal: number | null; menor: number | null; maior: number | null; tendencia: number | null; diaHabitual: number | null; semanasRegistradas: number };
  categorias: Record<string, number>;
  estoqueBaixo: { id: number; modelo: string; quantidade: number }[];
  despesasPrevistas: { total: number; contas: { nome: string; valor: number; vencimento: string }[] };
  projecao7Dias: number | null;
  situacao: "risco" | "atencao" | "saudavel" | "sem_dados" | "sem_alertas";
  observacoes: Alert[];
  avisos: string[];
};
const days = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}/api${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 401
    ? "Para proteger seus dados financeiros, saia e entre novamente no sistema."
    : body.error ?? "Não foi possível consultar a análise financeira.");
  return body as T;
}

export function FinanceAiModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, error, refetch } = useQuery<FinanceSnapshot>({
    queryKey: ["financeiro-ia"],
    enabled: open,
    staleTime: 0,
    refetchInterval: open ? 15000 : false,
    queryFn: () => api("/financeiro-ia"),
  });
  const [question, setQuestion] = useState("");
  const [financialNotesHiddenAt, setFinancialNotesHiddenAt] = useState<number | null>(() => {
    const saved = Number(window.localStorage.getItem(FINANCIAL_NOTES_HIDDEN_AT));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  });
  const [messages, setMessages] = useState<{ pergunta: string; resposta: string }[]>([]);
  const [selectedFinanceWeek, setSelectedFinanceWeek] = useState<"current" | "previous">("current");
  const [exportingWeeklyReport, setExportingWeeklyReport] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState(() => window.localStorage.getItem("finance-voice") ?? "");
  const [readAloud, setReadAloud] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const microphoneActive = useMicrophoneActive();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const latestMessageRef = useRef<HTMLDivElement | null>(null);
  const startingVoiceRef = useRef(false);
  const chunksRef = useRef<Blob[]>([]);
  const timeoutRef = useRef<number | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const [withdraw, setWithdraw] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todaySP);
  const [payment, setPayment] = useState<"dinheiro" | "pix">("dinheiro");
  const [sending, setSending] = useState(false);
  const lastClosedAt = data?.ultimoFechamentoCaixa ? Date.parse(data.ultimoFechamentoCaixa) : NaN;
  const financialNotesHidden = financialNotesHiddenAt !== null &&
    (!Number.isFinite(lastClosedAt) || lastClosedAt <= financialNotesHiddenAt);
  const weeklyReportStart = selectedFinanceWeek === "previous"
    ? data?.historicoSemanal[0]?.inicio
    : data?.movimentoSemana.inicio;

  async function exportWeeklyReconciliation() {
    if (!weeklyReportStart || exportingWeeklyReport) return;
    setExportingWeeklyReport(true);
    try {
      const report = await api<unknown>(
        `/financeiro-ia/relatorio-semanal?inicio=${encodeURIComponent(weeklyReportStart)}`,
      );
      const blob = new Blob([JSON.stringify(report, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `conciliacao-financeira-${weeklyReportStart}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ title: "Relatório exportado", description: "O arquivo semanal foi baixado para o seu dispositivo." });
    } catch (error) {
      toast({
        title: "Não foi possível exportar",
        description: String(error instanceof Error ? error.message : error),
        variant: "destructive",
      });
    } finally {
      setExportingWeeklyReport(false);
    }
  }

  useEffect(() => {
    if (!open || messages.length === 0) return;
    const frame = window.requestAnimationFrame(() => {
      latestMessageRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, open]);

  function hideFinancialNotes() {
    if (financialNotesHiddenAt !== null) return;
    const now = Date.now();
    window.localStorage.setItem(FINANCIAL_NOTES_HIDDEN_AT, String(now));
    setFinancialNotesHiddenAt(now);
  }

  useEffect(() => {
    if (financialNotesHiddenAt === null || !Number.isFinite(lastClosedAt) || lastClosedAt <= financialNotesHiddenAt) return;
    window.localStorage.removeItem(FINANCIAL_NOTES_HIDDEN_AT);
    setFinancialNotesHiddenAt(null);
  }, [financialNotesHiddenAt, lastClosedAt]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const updateVoices = () => setVoices(window.speechSynthesis.getVoices());
    updateVoices();
    window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", updateVoices);
  }, []);

  useEffect(() => {
    if (open) return;
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      recorder.onstop = null;
      recorder.stop();
    }
    recorderRef.current = null;
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    window.speechSynthesis?.cancel();
    setRecording(false);
    setSpeaking(false);
  }, [open]);

  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      recorder.onstop = null;
      recorder.stop();
    }
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    window.speechSynthesis?.cancel();
  }, []);

  function speak(text: string) {
    if (!("speechSynthesis" in window)) {
      toast({ title: "Leitura de voz não disponível neste navegador", variant: "destructive" });
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "pt-BR";
    utterance.rate = 1;
    utterance.voice = voices.find(voice => voice.voiceURI === selectedVoice)
      ?? voices.find(voice => voice.lang.toLowerCase() === "pt-br")
      ?? voices.find(voice => voice.lang.toLowerCase().startsWith("pt"))
      ?? null;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }

  function stopVoice() {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
  }

  async function startVoice() {
    if (recording || transcribing || thinking || startingVoiceRef.current) return;
    startingVoiceRef.current = true;
    window.speechSynthesis?.cancel();
    try {
      const stream = await requestMicrophone();
      if (!openRef.current) return;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/mp4" });
        chunksRef.current = [];
        if (!openRef.current) return;
        if (blob.size < 100) {
          toast({ title: "Não ouvi uma pergunta. Tente novamente." });
          return;
        }
        setTranscribing(true);
        try {
          const audioBase64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
            reader.onerror = () => reject(new Error("Não foi possível ler a gravação."));
            reader.readAsDataURL(blob);
          });
          const result = await api<{ pergunta: string }>("/financeiro-ia/transcrever", {
            method: "POST",
            body: JSON.stringify({ audioBase64, mimeType: blob.type }),
          });
          if (!openRef.current) return;
          setQuestion(result.pergunta);
          await ask(result.pergunta);
        } catch (err) {
          if (openRef.current) toast({ title: "Não consegui ouvir sua pergunta", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
        } finally {
          if (openRef.current) setTranscribing(false);
        }
      };
      recorder.start();
      setRecording(true);
      timeoutRef.current = window.setTimeout(stopVoice, 30_000);
    } catch (err) {
      toast({ title: "Microfone indisponível", description: err instanceof Error ? err.message : "Confira a permissão do microfone no navegador.", variant: "destructive" });
    } finally {
      startingVoiceRef.current = false;
    }
  }

  async function ask(text = question) {
    const pergunta = text.trim();
    if (!pergunta || thinking) return;
    hideFinancialNotes();
    setQuestion("");
    setThinking(true);
    try {
      const result = await api<{ resposta: string }>("/financeiro-ia/perguntar", {
        method: "POST", body: JSON.stringify({ pergunta }),
      });
      if (!openRef.current) return;
      setMessages(prev => [...prev, { pergunta, resposta: result.resposta }]);
      if (readAloud) speak(result.resposta);
    } catch (e) {
      toast({ title: "Falha na análise", description: String(e instanceof Error ? e.message : e), variant: "destructive" });
      setQuestion(pergunta);
    } finally { setThinking(false); }
  }

  async function registerWithdrawal() {
    if (!amount.trim() || !reason.trim()) {
      toast({ title: "Informe o valor e o motivo da retirada", variant: "destructive" });
      return;
    }
    if (!window.confirm(`Confirmar retirada de R$ ${amount} em ${payment === "pix" ? "PIX" : "dinheiro"}? Esta ação fará uma saída real no Caixa.`)) return;
    setSending(true);
    try {
      const result = await api<{ resumo: FinanceSnapshot }>("/financeiro-ia/retiradas", {
        method: "POST",
        body: JSON.stringify({ valor: amount, motivo: reason, observacao: note, data: date, formaPagamento: payment }),
      });
      setWithdraw(false);
      setAmount(""); setReason(""); setNote("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["financeiro-ia"] }),
        qc.invalidateQueries({ queryKey: ["caixa"] }),
        qc.invalidateQueries({ queryKey: ["caixa-sessao-hoje"] }),
        qc.invalidateQueries({ queryKey: ["caixa-hoje"] }),
      ]);
      const before = data?.saldos.disponivel;
      const after = result.resumo.saldos.disponivel;
      toast({
        title: "Retirada registrada no Caixa",
        description: before !== null && before !== undefined && after !== null
          ? `Disponível operacional: ${fmt(before)} → ${fmt(after)}.`
          : "Confira o saldo físico e o PIX registrados.",
      });
    } catch (e) {
      toast({ title: "Retirada não registrada", description: String(e instanceof Error ? e.message : e), variant: "destructive" });
    } finally { setSending(false); }
  }

  const summary = data?.saldos;
  const semanaAnterior = data?.historicoSemanal[0] ?? null;
  const rateioAbertura = data?.movimentoSemana.consolidadoNaAbertura ?? null;
  const entradasRateadasSemana = data?.movimentoSemana.entradas ?? 0;
  const saidasRateadasSemana = data?.movimentoSemana.saidas ?? 0;
  const liquidoRateadoSemana = data?.movimentoSemana.saldoOperacional ?? 0;
  const operacaoRateadaSemana = data?.movimentoSemana.projecaoOperacaoSemana ?? 0;
  const protecaoRateadaSemana = data?.movimentoSemana.protecao ?? 0;
  const percentualProtecaoExibido = data?.movimentoSemana.percentualProtecao ?? 0;
  const percentualOperacaoExibido = liquidoRateadoSemana > 0
    ? summary?.protecaoAtiva ? 100 - percentualProtecaoExibido : 100
    : 0;
  const severities = {
    risco: "bg-red-50 border-red-200 text-red-900",
    atencao: "bg-amber-50 border-amber-200 text-amber-900",
    positivo: "bg-emerald-50 border-emerald-200 text-emerald-900",
  };
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="w-[calc(100vw-16px)] max-w-2xl max-h-[94dvh] overflow-y-auto p-0 gap-0 rounded-2xl [&>button:last-child]:hidden">
        <DialogHeader className="sticky top-0 z-10 border-b bg-white px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="flex min-w-0 items-center gap-2 text-lg text-slate-900">
              <Bot className="h-5 w-5 shrink-0 text-blue-600" /> IA Financeira
            </DialogTitle>
            <Button
              data-testid="button-fechar-ia-financeira"
              type="button"
              variant="ghost"
              className="h-9 shrink-0 gap-1 px-2 text-xs text-slate-700 hover:bg-slate-100"
              onClick={onClose}
              aria-label="Fechar IA Financeira"
              title="Fechar IA Financeira"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Fechar
            </Button>
          </div>
        </DialogHeader>
        <div className="space-y-5 p-4 pb-8">
          {isLoading && !data && <div className="py-12 text-center text-sm text-slate-500">Analisando os dados do Caixa...</div>}
          {error && !data && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <p>{String(error instanceof Error ? error.message : error)}</p>
              <Button variant="outline" className="mt-3" onClick={() => void refetch()}>Tentar novamente</Button>
            </div>
          )}
          {data && summary && (
            <>
              {data.conciliacaoReservaPendente && (
                <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                  <p className="font-semibold">Conciliação manual necessária para a reserva</p>
                  <p className="mt-1">
                    O fechamento da semana iniciada em {data.conciliacaoReservaPendente} não pode ser aplicado sem reduzir a reserva registrada abaixo de zero. Nenhum saldo foi alterado. A disponibilidade para gastar ficará indisponível e o uso da reserva está bloqueado até a conciliação.
                  </p>
                </div>
              )}
              <div className={financialNotesHidden ? "sticky top-16 z-10 -mx-4 bg-white px-4 pb-2 pt-2 shadow-sm" : ""}>
              <section aria-label="Movimentação financeira desta semana">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-bold text-slate-800">{selectedFinanceWeek === "current" ? "Resumo financeiro da semana atual" : "Resumo financeiro da semana passada"}</h3>
                  {selectedFinanceWeek === "current" && <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${data.situacao === "risco" ? "bg-red-100 text-red-700" : data.situacao === "atencao" ? "bg-amber-100 text-amber-700" : data.situacao === "sem_dados" ? "bg-slate-100 text-slate-700" : "bg-emerald-100 text-emerald-700"}`}>
                    {data.situacao === "risco" ? "Risco" : data.situacao === "atencao" ? "Atenção" : data.situacao === "sem_dados" ? "Dados insuficientes" : data.situacao === "sem_alertas" ? "Sem alertas" : "Sem alerta de risco"}
                  </span>}
                </div>
                <div className="mb-3 grid grid-cols-2 rounded-xl border border-slate-200 bg-slate-100 p-1" role="tablist" aria-label="Período do resumo financeiro">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selectedFinanceWeek === "current"}
                    data-testid="button-semana-atual"
                    className={`rounded-lg px-3 py-2 text-sm font-semibold ${selectedFinanceWeek === "current" ? "bg-white text-emerald-800 shadow-sm" : "text-slate-600"}`}
                    onClick={() => setSelectedFinanceWeek("current")}
                  >Semana atual</button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selectedFinanceWeek === "previous"}
                    data-testid="button-semana-passada"
                    className={`rounded-lg px-3 py-2 text-sm font-semibold ${selectedFinanceWeek === "previous" ? "bg-white text-emerald-800 shadow-sm" : "text-slate-600"}`}
                    onClick={() => setSelectedFinanceWeek("previous")}
                  >Semana passada</button>
                </div>
                <div className="mb-3 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="button-exportar-conciliacao-semanal"
                    disabled={!weeklyReportStart || exportingWeeklyReport}
                    onClick={() => void exportWeeklyReconciliation()}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    {exportingWeeklyReport ? "Preparando relatório..." : "Exportar conciliação da semana"}
                  </Button>
                </div>
                <p className="mb-2 text-[11px] text-slate-500">Baixa um arquivo JSON com lançamentos, ajustes e utilizações da reserva. Revise-o antes de compartilhar.</p>
                {selectedFinanceWeek === "current" && <p className="mb-2 text-[11px] text-slate-500">O selo resume alertas financeiros; não é o fluxo semanal nem, sozinho, uma decisão sobre pedidos. Compare o valor do pedido com a margem conservadora abaixo.</p>}
                {selectedFinanceWeek === "current" && <>
                <div className="rounded-2xl bg-emerald-600 p-4 text-white">
                  <p className="text-sm font-medium text-emerald-50">Entradas elegíveis nesta semana · dinheiro + PIX</p>
                  <p data-testid="text-entradas-elegiveis-semana" className="mt-1 text-3xl font-extrabold">{fmt(entradasRateadasSemana)}</p>
                  {!financialNotesHidden && <p className="mt-1 text-xs text-emerald-50">De {data.movimentoSemana.inicio} até hoje ({data.movimentoSemana.fim}); inclui o período inteiro, também os lançamentos consolidados na abertura. Não inclui cartão nem o valor de abertura da gaveta.</p>}
                </div>
                {data.movimentoSemana.consolidadoNaAbertura && (
                  <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3" data-testid="card-rateio-consolidado-abertura">
                    <p className="font-semibold text-indigo-950">Rateio incorporado na abertura de {data.movimentoSemana.consolidadoNaAbertura.abertura}</p>
                    <p className="mt-1 text-[11px] text-indigo-800">Esses lançamentos já foram considerados no acompanhamento operacional. A parte de proteção é provisória e só entra na reserva se a semana fechar positiva; não some novamente aos valores abaixo.</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-indigo-950">
                      <p>Entradas elegíveis: <strong>{fmt(data.movimentoSemana.consolidadoNaAbertura.entradas)}</strong></p>
                      <p>Saídas do rateio: <strong>{fmt(data.movimentoSemana.consolidadoNaAbertura.saidas)}</strong></p>
                      <p>Líquido: <strong>{fmt(data.movimentoSemana.consolidadoNaAbertura.liquido)}</strong></p>
                      <p>Operação · {summary.protecaoAtiva ? "60%" : "100%"}: <strong>{fmt(data.movimentoSemana.consolidadoNaAbertura.operacao)}</strong></p>
                      {summary.protecaoAtiva && <p>Proteção · 40%: <strong>{fmt(data.movimentoSemana.consolidadoNaAbertura.protecao)}</strong></p>}
                    </div>
                  </div>
                )}
                </>}
                {selectedFinanceWeek === "previous" ? (
                  <div className="mt-3 space-y-3" data-testid="resumo-semana-passada">
                    {semanaAnterior ? (
                      <>
                        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                          <p className="font-semibold text-indigo-950">Período: {semanaAnterior.inicio.split("-").reverse().join("/")} a {semanaAnterior.fim.split("-").reverse().join("/")}</p>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                            <div className="rounded-lg bg-white/80 p-2"><p className="text-xs text-slate-600">Entradas registradas</p><p className="font-bold text-emerald-800">{fmt(semanaAnterior.entradas)}</p></div>
                            <div className="rounded-lg bg-white/80 p-2"><p className="text-xs text-slate-600">Saídas registradas</p><p className="font-bold text-rose-800">{fmt(semanaAnterior.saidas)}</p></div>
                            <div className="col-span-2 rounded-lg bg-white/80 p-2"><p className="text-xs text-slate-600">Líquido registrado (entradas − saídas)</p><p className={`font-bold ${semanaAnterior.liquido < 0 ? "text-rose-800" : "text-slate-900"}`}>{fmt(semanaAnterior.liquido)}</p></div>
                          </div>
                        </div>
                        <div className="rounded-xl border bg-white p-3">
                          <p className="text-sm font-bold text-slate-800">Para onde foram as saídas</p>
                          {Object.keys(semanaAnterior.saidasPorCategoria).length > 0 ? (
                            <ul className="mt-2 space-y-1 text-sm">
                              {Object.entries(semanaAnterior.saidasPorCategoria).map(([categoria, valor]) => (
                                <li key={categoria} className="flex justify-between gap-2"><span>{categoria === "pecas" ? "Peças" : categoria}</span><strong>{fmt(valor)}</strong></li>
                              ))}
                            </ul>
                          ) : <p className="mt-1 text-xs text-slate-500">Nenhuma saída registrada nessa semana.</p>}
                          {semanaAnterior.saidasPagasPelaReserva > 0 && <p className="mt-2 text-xs text-blue-800">{fmt(semanaAnterior.saidasPagasPelaReserva)} das saídas foram pagas pela reserva e não são debitadas novamente da operação.</p>}
                        </div>
                        <div className="space-y-2">
                          <p className="text-sm font-bold text-slate-800">Lançamentos da semana</p>
                          {semanaAnterior.registros.length === 0 ? <p className="rounded-xl border bg-slate-50 p-3 text-sm text-slate-500">Nenhum lançamento registrado nessa semana.</p> :
                            [...semanaAnterior.registros].sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id).map(registro => (
                              <article key={registro.id} className="rounded-lg border bg-white p-2 text-xs">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="font-semibold text-slate-800">{registro.data.slice(0, 10).split("-").reverse().join("/")} · {registro.tipo === "entrada" ? "Entrada" : "Saída"}{registro.pagaPelaReserva ? " · paga pela reserva" : ""}</p>
                                    <p className="mt-0.5 break-words text-slate-600">{registro.motivo || "Sem descrição"}{registro.categoria ? ` · ${registro.categoria === "pecas" ? "Peças" : registro.categoria}` : ""}</p>
                                    {registro.observacao && <p className="mt-0.5 break-words text-slate-500">{registro.observacao}</p>}
                                  </div>
                                  <div className="shrink-0 text-right">
                                    <p className={`font-bold ${registro.tipo === "entrada" ? "text-emerald-700" : "text-rose-700"}`}>{registro.tipo === "entrada" ? "+" : "−"}{fmt(registro.valor)}</p>
                                    <p className="text-slate-500">{registro.formaPagamento === "pix" ? "PIX" : registro.formaPagamento === "dinheiro" ? "Dinheiro" : registro.formaPagamento?.replaceAll("_", " ") ?? "Pagamento não informado"}</p>
                                  </div>
                                </div>
                              </article>
                            ))}
                        </div>
                          <p className="text-[11px] text-slate-500">Este resumo mostra o líquido de todos os lançamentos do Caixa, não o saldo físico de fechamento. Para o 40% da reserva, entram todas as saídas registradas em dinheiro/PIX, inclusive Peças e saídas de segunda; o saldo operacional segue seu ciclo próprio.</p>
                      </>
                    ) : <p className="rounded-xl border bg-slate-50 p-3 text-sm text-slate-600">O histórico da semana passada ainda não está disponível.</p>}
                  </div>
                ) : (
                <>
                {data.movimentoSemana.aberturaRealNoPeriodo && (
                  <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3" data-testid="card-saldos-atuais-pos-abertura">
                    <p className="mb-2 font-semibold text-emerald-950">Saldos atuais após a abertura</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-emerald-800">Saldo disponível da operação</p>
                        <p data-testid="text-alocacao-operacao-semana" className="text-lg font-extrabold text-emerald-950">{fmt(data.movimentoSemana.saldoOperacionalDisponivel)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-blue-800">Reserva protegida acumulada</p>
                        <p data-testid="text-reserva-protegida" className="text-lg font-extrabold text-blue-950">{fmt(summary.reserva)}</p>
                      </div>
                    </div>
                    {!financialNotesHidden && <p className="mt-2 text-[11px] text-emerald-800">Estes são os saldos atuais. A operação pendente até a próxima abertura é {fmt(data.movimentoSemana.operacaoPendente)} e não aumenta o limite para pedidos. Saldo anterior {fmt(data.movimentoSemana.saldoOperacionalAntesPedidos)} − débitos do ciclo anterior {fmt(data.movimentoSemana.saidasCicloAnterior)} = {fmt(data.movimentoSemana.saldoOperacionalAnterior)}; pedidos de estoque: {fmt(data.movimentoSemana.saidasPedidosEstoque)}. Para a próxima abertura: + operação após esta abertura {fmt(data.movimentoSemana.alocacaoOperacao)} − outras saídas {fmt(data.movimentoSemana.saidasOperacionais)}. A atividade abaixo mostra somente o que aconteceu depois da abertura e não substitui nem zera estes saldos.</p>}
                  </div>
                )}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-violet-100 bg-violet-50 p-3">
                    <p className="flex items-center gap-1 text-xs text-violet-700"><LockKeyhole className="h-3.5 w-3.5" /> Projeção de proteção da semana · {percentualProtecaoExibido}%</p>
                    <p data-testid="text-protecao-calculada-semana" className="mt-1 font-bold text-violet-900">{fmt(protecaoRateadaSemana)}</p>
                    {!financialNotesHidden && <p className="text-[11px] text-violet-700">{!summary.protecaoAtiva ? "Proteção desativada; nenhum valor é destinado à reserva." : "Recalculada a cada lançamento: todas as entradas e saídas em dinheiro/PIX, inclusive Peças e segunda, primeiro compensam o déficit anterior. O 60/40 é apenas uma projeção e só entra na reserva se a semana fechar positiva."}</p>}
                  </div>
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                    <p className="flex items-center gap-1 text-xs text-emerald-700"><Wallet className="h-3.5 w-3.5" /> Líquido após compensar o déficit anterior</p>
                    <p data-testid="text-saldo-operacional-semana" className="mt-1 font-bold text-emerald-900">{fmt(liquidoRateadoSemana)}</p>
                    {!financialNotesHidden && <p className="text-[11px] text-emerald-700">Entradas em dinheiro/PIX {fmt(entradasRateadasSemana)} − todas as saídas {fmt(saidasRateadasSemana)} − déficit anterior. A semana é recalculada em tempo real; se o resultado fechar em zero ou negativo, não há rateio.</p>}
                  </div>
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                    <p className="flex items-center gap-1 text-xs text-emerald-700"><Wallet className="h-3.5 w-3.5" /> Operação rateada nesta semana · {percentualOperacaoExibido}%</p>
                    <p data-testid="text-operacao-rateada-semana" className="mt-1 font-bold text-emerald-900">{fmt(operacaoRateadaSemana)}</p>
                    {!financialNotesHidden && <p className="text-[11px] text-emerald-700">Projeção da parcela operacional pelo resultado elegível acumulado na semana. O saldo disponível acima continua separado e considera a abertura real, os débitos do ciclo anterior e as saídas já registradas.</p>}
                  </div>
                  <div className={`rounded-xl border p-3 ${data.movimentoSemana.resultadoOperacionalSemana < 0 ? "border-rose-100 bg-rose-50" : "border-slate-200 bg-slate-50"}`}>
                    <p className={`flex items-center gap-1 text-xs ${data.movimentoSemana.resultadoOperacionalSemana < 0 ? "text-rose-700" : "text-slate-700"}`}><Wallet className="h-3.5 w-3.5" /> Resultado após compensar o déficit</p>
                    <p data-testid="text-resultado-operacional-semana" className={`mt-1 font-bold ${data.movimentoSemana.resultadoOperacionalSemana < 0 ? "text-rose-900" : "text-slate-900"}`}>{fmt(data.movimentoSemana.resultadoOperacionalSemana)}</p>
                    {!financialNotesHidden && <p className="text-[11px] text-slate-700">Resultado elegível da semana após descontar o déficit anterior. Atualiza junto com as entradas e saídas; o saldo disponível para pedidos continua separado e não inclui a projeção desta semana.</p>}
                  </div>
                  {!data.movimentoSemana.aberturaRealNoPeriodo && <>
                    <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
                      <p className="flex items-center gap-1 text-xs text-blue-700"><LockKeyhole className="h-3.5 w-3.5" /> {data.conciliacaoReservaPendente ? "Saldo protegido registrado (pendente de conciliação)" : "Saldo protegido total"} {summary.protecaoAtiva ? "" : "(proteção desativada)"}</p>
                      <p data-testid="text-reserva-protegida" className="mt-1 font-bold text-blue-900">{fmt(summary.reserva)}</p>
                        <p className="text-[11px] text-blue-700">{!financialNotesHidden && (data.conciliacaoReservaPendente ? "Último valor registrado; não confirmado pela conciliação pendente." : "Acumulado das semanas fechadas · sem teto máximo. A semana atual ainda é provisória.")}</p>
                    </div>
                    <div className={`rounded-xl border p-3 ${data.movimentoSemana.saldoOperacionalDisponivel < 0 ? "border-rose-100 bg-rose-50" : "border-emerald-100 bg-emerald-50"}`}>
                      <p className={`flex items-center gap-1 text-xs ${data.movimentoSemana.saldoOperacionalDisponivel < 0 ? "text-rose-700" : "text-emerald-700"}`}><Wallet className="h-3.5 w-3.5" /> {data.movimentoSemana.saldoOperacionalDisponivel < 0 ? "Déficit carregado" : "Saldo restante do ciclo anterior"}</p>
                      <p data-testid="text-alocacao-operacao-semana" className={`mt-1 font-bold ${data.movimentoSemana.saldoOperacionalDisponivel < 0 ? "text-rose-900" : "text-emerald-900"}`}>{fmt(data.movimentoSemana.saldoOperacionalDisponivel)}</p>
                      {!financialNotesHidden && <p className={`text-[11px] ${data.movimentoSemana.saldoOperacionalDisponivel < 0 ? "text-rose-700" : "text-emerald-700"}`}>Operação pendente até a próxima abertura real: {fmt(data.movimentoSemana.operacaoPendente)} (não aumenta o limite para pedidos). Saldo anterior {fmt(data.movimentoSemana.saldoOperacionalAntesPedidos)} − pedidos/saídas atribuídos ao ciclo anterior {fmt(data.movimentoSemana.saidasCicloAnterior)} (pedidos de estoque: {fmt(data.movimentoSemana.saidasPedidosEstoque)}) = {fmt(data.movimentoSemana.saldoOperacionalAnterior)}. Depois: + operação desta semana {fmt(data.movimentoSemana.alocacaoOperacao)} − outras saídas {fmt(data.movimentoSemana.saidasOperacionais)}. Déficits são cobertos pelas próximas alocações.</p>}
                    </div>
                  </>}
                </div>
                {data.conciliacaoReservaPendente
                  ? <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">O saldo protegido exibido é o último valor registrado e ainda não foi conciliado. Não é possível registrar uso da reserva até concluir a conciliação.</p>
                  : <ReservaUtilizacaoPanel saldo={summary.reserva} />}
                <p data-testid="text-lancamentos-sem-forma-semana" className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  Lançamentos com forma de pagamento não informada, excluídos do cálculo: entradas {fmt(data.movimentoSemana.entradasSemForma)} e saídas {fmt(data.movimentoSemana.saidasSemForma)}. O app não presume que sejam dinheiro ou PIX.
                </p>
                <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700" aria-label="Caixa atual e margem para pedidos">
                  <h3 className="font-bold text-slate-800">Caixa atual e margem para pedidos</h3>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <p>Caixa + PIX registrado agora</p>
                      <p data-testid="text-saldo-caixa-pix-atual" className="font-bold">{fmt(data.saldos.total)}</p>
                    </div>
                    <div>
                      <p>Disponível após reserva protegida</p>
                      <p data-testid="text-disponivel-apos-reserva" className="font-bold">{fmt(data.saldos.disponivel)}</p>
                    </div>
                  </div>
                  <p data-testid="text-limite-conservador-pedido" className="mt-2">
                    Margem conservadora após reserva, contas previstas e meta de compra: <strong>{fmt(data.saldos.podeGastar)}</strong>. A decisão sobre um pedido depende do valor do pedido; esse valor não é a movimentação líquida da semana.
                  </p>
                  {!financialNotesHidden && <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{data.saldos.base}</p>}
                </div>
                {!financialNotesHidden && <p className="mt-2 text-[11px] leading-relaxed text-slate-500">Em tempo real, o app compensa primeiro qualquer déficit operacional anterior e depois desconta as saídas elegíveis das entradas. Se o resultado ajustado for positivo e a proteção estiver ativa, a projeção é 60% para operação e 40% para proteção. A parcela protegida só entra na reserva depois do fechamento semanal. Se o resultado ficar em zero ou negativo, a projeção de 40% diminui até zerar e o déficit continua carregado. A proteção é uma classificação contábil, não uma transferência.</p>}
                </>
                )}
              </section>

              </div>
              {!financialNotesHidden && <>
              <section className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-sm" aria-label="Reserva gradual">
                <h3 className="flex items-center gap-2 font-bold text-blue-900"><LockKeyhole className="h-4 w-4" /> Reserva sem teto</h3>
                <p className="mt-1 text-slate-700">
                  O saldo protegido total é acumulado sem meta máxima. Ele pode continuar crescendo depois de R$ 50 mil, R$ 100 mil ou qualquer outro valor.
                </p>
                <p className="mt-1 text-xs text-slate-600">A parcela da semana atual é provisória: os 40% só entram na reserva acumulada depois do fechamento, se o resultado elegível terminar positivo. Semana fechada em zero ou negativo não recebe reserva; seu déficit reduz o saldo operacional carregado. A reserva das semanas fechadas permanece acumulada sem teto.</p>
                {data.reservaAutomatica.entradaNova > 0 && (
                  <p className="mt-1 text-slate-700">Nova entrada registrada no Caixa: <strong>{fmt(data.reservaAutomatica.entradaNova)}</strong>. Ela altera a projeção da semana, mas não aumenta a reserva antes do fechamento.</p>
                )}
                {data.reservaAutomatica.aporte !== 0 && (
                  <p data-testid="text-aporte-reserva" className="mt-1 font-semibold text-emerald-700">
                    {data.reservaAutomatica.aporte > 0
                      ? `No fechamento semanal, a reserva recebeu ${fmt(data.reservaAutomatica.aporte)}.`
                      : `No fechamento semanal, o saldo protegido foi reduzido em ${fmt(-data.reservaAutomatica.aporte)} para refletir o resultado final.`}
                  </p>
                )}
                    {data.conciliacaoReservaPendente && <p className="mt-1 font-medium text-amber-800">A atualização automática da reserva está suspensa até a conciliação manual.</p>}
                    {data.reservaAutomatica.estado === "pausada" && <p className="mt-1 text-amber-700">Aumento automático pausado: ative a proteção da reserva abaixo.</p>}
                {data.reservaAutomatica.estado === "sem_saldo" && <p className="mt-1 text-amber-700">Sem sessão da gaveta, não é seguro aumentar a reserva.</p>}
                {data.reservaAutomatica.estado === "iniciando" && <p className="mt-1 text-slate-600">Acompanhamento iniciado. A reserva da semana será definida somente após o fechamento do período.</p>}
                {data.reservaAutomatica.estado === "sem_entradas" && <p className="mt-1 text-slate-600">Nenhuma entrada nova desde a última leitura; a projeção continua baseada no resultado elegível acumulado da semana.</p>}
                {data.reservaAutomatica.estado === "sem_aumento" && <p className="mt-1 text-slate-600">Nenhuma reserva é acrescentada durante a semana aberta. A projeção só será aplicada no fechamento, se o resultado for positivo.</p>}
                <p className="mt-2 text-xs leading-relaxed text-slate-600">
                  O cálculo em tempo real considera {fmt(entradasRateadasSemana)} em entradas − {fmt(saidasRateadasSemana)} em saídas − {fmt(Math.abs(Math.min(0, data.movimentoSemana.saldoCarryInSemana ?? 0)))} de déficit anterior = {fmt(liquidoRateadoSemana)}. {summary.protecaoAtiva && liquidoRateadoSemana > 0 ? `Se a semana fechar agora, a projeção é ${fmt(operacaoRateadaSemana)} para operação (60%) e ${fmt(protecaoRateadaSemana)} para proteção (40%).` : liquidoRateadoSemana > 0 ? "Com a proteção desativada, o líquido positivo fica na operação." : "Como o líquido não é positivo, a reserva projetada é zero e o déficit segue no saldo operacional."} A projeção de proteção só será adicionada à reserva depois do fechamento semanal; a reserva acumulada não tem teto máximo.
                </p>
                <p className="mt-1 text-xs text-slate-500">É uma proteção no cálculo do app, não uma transferência ou saída do Caixa. Gastos e transferências não registrados podem alterar o saldo real.</p>
              </section>

              <section className="space-y-2" aria-label="Próxima compra">
                <h3 className="flex items-center gap-2 font-bold text-slate-800"><Package className="h-4 w-4" /> Próxima compra</h3>
                <div className="rounded-xl border bg-slate-50 p-3 text-sm">
                  <div className="flex justify-between"><span>Média semanal registrada</span><strong>{fmt(data.compras.mediaSemanal)}</strong></div>
                  <div className="mt-1 flex justify-between"><span>Meta de compra</span><strong>{fmt(data.metaCompra)}</strong></div>
                  {data.faltamMeta !== null && data.metaCompra > 0 && <p className="mt-2 font-medium text-amber-800">Faltam {fmt(data.faltamMeta)} para a meta sem usar a reserva.</p>}
                  {data.compras.diaHabitual !== null && <p className="mt-1 text-xs text-slate-500">Dia mais frequente de compra: {days[data.compras.diaHabitual]} (com base nos registros).</p>}
                  {data.compras.mediaSemanal === null && <p className="mt-1 text-xs text-slate-500">Registre compras de peças no Caixa para calcular a média.</p>}
                </div>
              </section>

              <section className="space-y-2" aria-label="Alertas financeiros">
                <h3 className="font-bold text-slate-800">Observações baseadas nos registros</h3>
                {data.observacoes.length === 0 && <p className="rounded-xl border bg-slate-50 p-3 text-sm text-slate-600">Nenhuma condição gerou alerta agora. Comparações de tendência exigem registros nas quatro semanas anteriores; continue categorizando saídas e compras.</p>}
                {data.observacoes.map((item, i) => (
                  <div key={`${item.titulo}-${i}`} className={`min-w-0 rounded-xl border p-3 text-sm ${severities[item.nivel]}`}>
                    <p className="flex items-center gap-1 font-bold"><AlertTriangle className="h-4 w-4" /> {item.titulo}</p>
                    <dl className="mt-2 divide-y divide-current/10 leading-relaxed">
                      {[["O que aconteceu?", item.aconteceu], ["Qual dado provocou o alerta?", item.dado], ["Como isso afetou o caixa?", item.impacto], ["O que pode acontecer se continuar?", item.continuidade], ["Qual ação considerar?", item.sugestao]].map(([label, description]) => (
                        <div key={label} className="py-2 first:pt-0 last:pb-0"><dt className="text-xs font-bold">{label}</dt><dd className="mt-0.5 break-words text-sm">{description}</dd></div>
                      ))}
                    </dl>
                  </div>
                ))}
              </section>

              <section className="space-y-2" aria-label="Resumo da semana">
                <h3 className="font-bold text-slate-800">Esta semana</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {[
                    ["Entradas", data.semana.entradas], ["Saídas", data.semana.saidas],
                    ["Retiradas", data.semana.retiradas], ["Compras", data.semana.compras],
                    ["Lucro estimado", data.semana.lucro],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl border bg-white p-3">
                      <p className="text-xs text-slate-500">{label}</p>
                      <p className="mt-1 font-bold">{fmt(value as number | null)}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500">O resumo principal mostra somente o fluxo de hoje; esta seção mantém os totais de entradas e saídas da semana.</p>
                {Object.keys(data.categorias).length > 0 && <p className="text-xs text-slate-600">
                  Despesas por categoria: {Object.entries(data.categorias).map(([cat, value]) => `${cat}: ${fmt(value)}`).join(" · ")}
                </p>}
                <p className="text-xs text-slate-600">Contas previstas (7 dias): {fmt(data.despesasPrevistas.total)} · Projeção do saldo (7 dias): {fmt(data.projecao7Dias)} <span className="text-slate-500">(estimativa)</span></p>
                {data.estoqueBaixo.length > 0 && <p className="text-xs text-amber-700">Estoque baixo: {data.estoqueBaixo.map(p => `${p.modelo} (${p.quantidade})`).join(", ")}</p>}
              </section>
              </>}

              <section className="space-y-2" aria-label="Histórico financeiro semanal">
                <div>
                  <h3 className="font-bold text-slate-800">Histórico financeiro semanal</h3>
                  <p className="text-xs text-slate-500">As últimas 12 semanas encerradas, reconstruídas pelos lançamentos originais do Caixa. Abra uma semana para conferir cada entrada e saída.</p>
                </div>
                {data.historicoSemanal.length === 0 ? (
                  <p className="rounded-xl border bg-slate-50 p-3 text-sm text-slate-600">Ainda não há lançamentos no período do histórico.</p>
                ) : data.historicoSemanal.slice(selectedFinanceWeek === "previous" ? 1 : 0).map((semana, index) => (
                  <details key={semana.inicio} open={index === 0} className="rounded-xl border border-slate-200 bg-white">
                    <summary className="cursor-pointer list-none p-3 [&::-webkit-details-marker]:hidden">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <strong>{semana.inicio} a {semana.fim}</strong>
                        <span className="text-slate-600">Entrou {fmt(semana.entradas)} · saiu {fmt(semana.saidas)}</span>
                      </div>
                      <p className={`mt-1 text-xs font-semibold ${semana.liquido < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                        Líquido registrado: {fmt(semana.liquido)} · {semana.registros.length} lançamentos
                      </p>
                    </summary>
                    <div className="space-y-3 border-t px-3 pb-3 pt-2">
                      <div>
                        <p className="text-xs font-bold text-slate-700">Saídas por categoria</p>
                        {Object.keys(semana.saidasPorCategoria).length > 0 ? (
                          <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
                            {Object.entries(semana.saidasPorCategoria).map(([categoria, valor]) => (
                              <li key={categoria} className="flex justify-between gap-2">
                                <span>{categoria === "pecas" ? "Peças" : categoria}</span><strong>{fmt(valor)}</strong>
                              </li>
                            ))}
                          </ul>
                        ) : <p className="mt-1 text-xs text-slate-500">Nenhuma saída registrada.</p>}
                        {semana.saidasPagasPelaReserva > 0 && (
                          <p className="mt-2 text-[11px] text-blue-800">Dentro das saídas acima, {fmt(semana.saidasPagasPelaReserva)} foram pagas pela reserva; aparecem no histórico do Caixa, mas não são debitadas novamente da operação.</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-bold text-slate-700">Lançamentos detalhados</p>
                        {[...semana.registros].sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id).map(registro => (
                          <article key={registro.id} className="rounded-lg bg-slate-50 p-2 text-xs">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-semibold text-slate-800">
                                  {registro.data.slice(0, 10).split("-").reverse().join("/")} · {registro.tipo === "entrada" ? "Entrada" : "Saída"}
                                  {registro.pagaPelaReserva ? " · paga pela reserva" : ""}
                                </p>
                                <p className="mt-0.5 break-words text-slate-600">
                                  {registro.motivo || "Sem descrição"}{registro.categoria ? ` · ${registro.categoria === "pecas" ? "Peças" : registro.categoria}` : ""}
                                </p>
                                {registro.observacao && <p className="mt-0.5 break-words text-slate-500">{registro.observacao}</p>}
                              </div>
                              <div className="shrink-0 text-right">
                                <p className={`font-bold ${registro.tipo === "entrada" ? "text-emerald-700" : "text-rose-700"}`}>{registro.tipo === "entrada" ? "+" : "−"}{fmt(registro.valor)}</p>
                                <p className="text-slate-500">{registro.formaPagamento
                                  ? registro.formaPagamento === "pix" ? "PIX" : registro.formaPagamento === "dinheiro" ? "Dinheiro" : registro.formaPagamento.replaceAll("_", " ")
                                  : "Pagamento não informado"}</p>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                      <p className="text-[11px] text-slate-500">O rateio 60/40 é uma classificação contábil, não uma saída de dinheiro. Este histórico mostra somente os lançamentos efetivamente registrados; gastos fora do Caixa não aparecem.</p>
                    </div>
                  </details>
                ))}
              </section>

              <section id="conversa-financeira" className="scroll-mt-20 space-y-3" aria-label="Conversa com assistente financeiro">
                <h3 className="flex items-center gap-2 font-bold text-slate-800"><MessageCircle className="h-4 w-4" /> Pergunte sobre suas finanças</h3>
                <p className="text-xs text-slate-500">As respostas ficam escritas na conversa. A leitura em voz alta é opcional.</p>
                <div className="flex flex-wrap gap-2">
                  {["Como está meu caixa?", "Quanto posso gastar hoje?", "Posso comprar R$ 1.500 em peças?", "Quanto faturei essa semana?"].map(q => (
                    <button data-testid={`button-pergunta-${q.length}`} key={q} type="button" onClick={() => void ask(q)} className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-800 hover:bg-blue-100">{q}</button>
                  ))}
                </div>
                {messages.map((message, i) => <div key={i} ref={i === messages.length - 1 ? latestMessageRef : undefined} className="space-y-1 text-sm">
                  <p className="ml-6 rounded-xl bg-slate-100 p-2 text-slate-800">{message.pergunta}</p>
                  <div aria-label="Resposta por escrito da IA" aria-live="polite" className="mr-6 rounded-xl bg-blue-50 p-3 text-blue-950">
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-blue-700">Resposta por escrito</p>
                    <p className="whitespace-pre-line leading-relaxed">{message.resposta}</p>
                    <button data-testid={`button-ouvir-resposta-${i}`} type="button" onClick={() => speak(message.resposta)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700"><Volume2 className="h-3.5 w-3.5" /> Ouvir em voz alta</button>
                  </div>
                </div>)}
                <form onSubmit={e => { e.preventDefault(); void ask(); }} className="flex items-center gap-2">
                  <Input data-testid="input-pergunta-financeira" className="min-w-0 flex-1" value={question} maxLength={400} onChange={e => setQuestion(e.target.value)} placeholder="Pergunte sobre seu Caixa..." aria-label="Sua pergunta" />
                  <Button
                    data-testid="button-falar-ia-financeira"
                    type="button"
                    size="icon"
                    variant={recording ? "destructive" : "outline"}
                    onClick={() => recording ? stopVoice() : void startVoice()}
                    disabled={transcribing || thinking}
                    className="h-10 w-10 shrink-0"
                    aria-label={recording ? "Parar e enviar gravação" : transcribing ? "Transcrevendo pergunta" : "Gravar pergunta por voz"}
                    title={recording ? "Parar e enviar gravação" : "Gravar pergunta por voz"}
                  >
                    {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </Button>
                  <Button data-testid="button-enviar-pergunta" className="h-10 w-10 shrink-0" disabled={thinking || !question.trim()} type="submit" aria-label="Enviar pergunta"><Send className="h-4 w-4" /></Button>
                </form>
                {(recording || transcribing) && <p role="status" className="text-xs text-blue-700">{recording ? "Gravando. Toque no microfone para parar e enviar." : "Transcrevendo sua pergunta..."}</p>}
                {speaking && <Button data-testid="button-parar-voz-ia" variant="outline" type="button" onClick={() => { window.speechSynthesis.cancel(); setSpeaking(false); }}><VolumeX className="mr-2 h-4 w-4" /> Parar leitura</Button>}
                <details className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600">
                  <summary className="cursor-pointer font-medium text-slate-700">Opções de voz</summary>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-slate-700">
                    <label className="flex items-center gap-2">
                      Voz
                      <select
                        data-testid="select-voz-ia-financeira"
                        className="max-w-[12rem] rounded-md border border-slate-300 bg-white px-2 py-1.5"
                        value={selectedVoice}
                        onChange={e => { setSelectedVoice(e.target.value); window.localStorage.setItem("finance-voice", e.target.value); }}
                      >
                        <option value="">Padrão em português</option>
                        {(voices.some(voice => voice.lang.toLowerCase().startsWith("pt"))
                          ? voices.filter(voice => voice.lang.toLowerCase().startsWith("pt"))
                          : voices).map(voice => (
                          <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} ({voice.lang})</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input data-testid="checkbox-ler-resposta-ia" aria-label="Ler respostas automaticamente em voz alta" type="checkbox" checked={readAloud} onChange={e => setReadAloud(e.target.checked)} />
                      Ler respostas automaticamente
                    </label>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">O trecho gravado é enviado para transcrição. Você pode desligar o microfone quando quiser.</p>
                </details>
                {microphoneActive && (
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
                    <span data-testid="status-microfone-ia">Microfone ativo neste acesso ao app. Só gravamos ao tocar no microfone.</span>
                    <button data-testid="button-desativar-microfone-ia" type="button" disabled={recording || transcribing} onClick={turnOffMicrophone} className="shrink-0 font-semibold text-blue-700 underline disabled:opacity-50">Desativar</button>
                  </div>
                )}
                {thinking && <p className="text-xs text-slate-500">Conferindo os registros...</p>}
              </section>
              <section className="rounded-xl border p-3" aria-label="Registrar retirada">
                <Button data-testid="button-registrar-retirada" variant="outline" className="w-full" onClick={() => setWithdraw(v => !v)}>
                  <ArrowDownRight className="mr-2 h-4 w-4" /> Registrar retirada
                </Button>
                {withdraw && <div className="mt-3 space-y-2">
                  <label className="block text-xs text-slate-600">Valor (R$)<Input data-testid="input-retirada-valor" type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label>
                  <label className="block text-xs text-slate-600">Motivo<Input data-testid="input-retirada-motivo" value={reason} maxLength={120} onChange={e => setReason(e.target.value)} /></label>
                  <label className="block text-xs text-slate-600">Data<Input data-testid="input-retirada-data" type="date" max={todaySP()} value={date} onChange={e => setDate(e.target.value)} /></label>
                  <label className="block text-xs text-slate-600">Forma
                    <select data-testid="select-retirada-forma" value={payment} onChange={e => setPayment(e.target.value as "dinheiro" | "pix")} className="mt-1 h-10 w-full rounded-md border bg-white px-2">
                      <option value="dinheiro">Dinheiro</option><option value="pix">PIX</option>
                    </select>
                  </label>
                  <label className="block text-xs text-slate-600">Observação (opcional)<Input data-testid="input-retirada-observacao" value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></label>
                  <Button data-testid="button-confirmar-retirada" variant="destructive" disabled={sending} className="w-full" onClick={() => void registerWithdrawal()}>{sending ? "Registrando..." : "Confirmar saída no Caixa"}</Button>
                </div>}
              </section>
              {!financialNotesHidden && <div className="border-t pt-3 text-[11px] leading-relaxed text-slate-500">
                {data.avisos.map((notice, i) => <p key={i}>{notice}</p>)}
                <p className="mt-2">Atualizado em {new Date(data.atualizadoEm).toLocaleString("pt-BR")}. Nenhuma sugestão altera seu Caixa automaticamente.</p>
              </div>}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
