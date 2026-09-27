import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownRight, Bot, LockKeyhole, MessageCircle, Mic, Package, Send, Square, Volume2, VolumeX, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { requestMicrophone, turnOffMicrophone, useMicrophoneActive } from "@/lib/microphone";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DASHBOARD_HIDDEN_AT = "finance-ai-dashboard-hidden-at";
const fmt = (n: number | null) => n === null
  ? "Sem dados" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const todaySP = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
}).format(new Date());

type Alert = { nivel: "risco" | "atencao" | "positivo"; titulo: string; texto: string; aconteceu: string; dado: string; impacto: string; continuidade: string; sugestao: string };
type FinanceSnapshot = {
  atualizadoEm: string;
  ultimoFechamentoCaixa: string | null;
  saldos: {
    dinheiro: number | null; pix: number; total: number | null;
    reserva: number; protecaoAtiva: boolean; disponivel: number | null;
    podeGastar: number | null; base: string;
  };
  metaCompra: number;
  reservaAutomatica: {
    meta: number; falta: number; aporte: number; entradaNova: number; percentual: 30 | 45 | 60;
    entradas7Dias: number; compraProtegida: number; contasProtegidas: number;
    estado: "pausada" | "sem_saldo" | "iniciando" | "sem_entradas" | "sem_margem" | "concluida" | "acumulando";
  };
  faltamMeta: number | null;
  semana: { entradas: number; saidas: number; retiradas: number; compras: number; lucro: number | null; custoAusente: boolean };
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
    refetchInterval: open ? 60000 : false,
    queryFn: () => api("/financeiro-ia"),
  });
  const [reserva, setReserva] = useState("0");
  const [metaReserva, setMetaReserva] = useState("1500");
  const [meta, setMeta] = useState("0");
  const [proteger, setProteger] = useState(false);
  const [saving, setSaving] = useState(false);
  const [question, setQuestion] = useState("");
  const [dashboardHiddenAt, setDashboardHiddenAt] = useState<number | null>(() => {
    const saved = Number(window.localStorage.getItem(DASHBOARD_HIDDEN_AT));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  });
  const [messages, setMessages] = useState<{ pergunta: string; resposta: string }[]>([]);
  const [thinking, setThinking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState(() => window.localStorage.getItem("finance-voice") ?? "");
  const [readAloud, setReadAloud] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const microphoneActive = useMicrophoneActive();
  const recorderRef = useRef<MediaRecorder | null>(null);
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
  const dashboardHidden = dashboardHiddenAt !== null &&
    (!Number.isFinite(lastClosedAt) || lastClosedAt <= dashboardHiddenAt);

  function hideDashboard() {
    if (dashboardHiddenAt !== null) return;
    const now = Date.now();
    window.localStorage.setItem(DASHBOARD_HIDDEN_AT, String(now));
    setDashboardHiddenAt(now);
  }

  useEffect(() => {
    if (dashboardHiddenAt === null || !Number.isFinite(lastClosedAt) || lastClosedAt <= dashboardHiddenAt) return;
    window.localStorage.removeItem(DASHBOARD_HIDDEN_AT);
    setDashboardHiddenAt(null);
  }, [dashboardHiddenAt, lastClosedAt]);

  useEffect(() => {
    if (!data) return;
    setReserva(String(data.saldos.reserva.toFixed(2)));
    setMetaReserva(String(data.reservaAutomatica.meta.toFixed(2)));
    setMeta(String(data.metaCompra.toFixed(2)));
    setProteger(data.saldos.protecaoAtiva);
  }, [data?.saldos.reserva, data?.reservaAutomatica.meta, data?.metaCompra, data?.saldos.protecaoAtiva]);

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

  async function saveConfig() {
    setSaving(true);
    try {
      await api("/financeiro-ia/config", {
        method: "PUT",
        body: JSON.stringify({ reserva, metaReserva, metaCompra: meta, protecaoAtiva: proteger }),
      });
      await qc.invalidateQueries({ queryKey: ["financeiro-ia"] });
      toast({ title: "Configuração financeira salva" });
    } catch (e) {
      toast({ title: "Não foi possível salvar", description: String(e instanceof Error ? e.message : e), variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function ask(text = question) {
    const pergunta = text.trim();
    if (!pergunta || thinking) return;
    hideDashboard();
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
  const severities = {
    risco: "bg-red-50 border-red-200 text-red-900",
    atencao: "bg-amber-50 border-amber-200 text-amber-900",
    positivo: "bg-emerald-50 border-emerald-200 text-emerald-900",
  };
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="w-[calc(100vw-16px)] max-w-2xl max-h-[94dvh] overflow-y-auto p-0 gap-0 rounded-2xl">
        <DialogHeader className="sticky top-0 z-10 border-b bg-white px-4 py-4">
          <DialogTitle className="flex items-center gap-2 text-lg text-slate-900">
            <Bot className="h-5 w-5 text-blue-600" /> IA Financeira
          </DialogTitle>
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
              {!dashboardHidden && <>
              <section aria-label="Disponibilidade financeira">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-bold text-slate-800">O que posso usar agora?</h3>
                  <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${data.situacao === "risco" ? "bg-red-100 text-red-700" : data.situacao === "atencao" ? "bg-amber-100 text-amber-700" : data.situacao === "sem_dados" ? "bg-slate-100 text-slate-700" : "bg-emerald-100 text-emerald-700"}`}>
                    {data.situacao === "risco" ? "Risco" : data.situacao === "atencao" ? "Atenção" : data.situacao === "sem_dados" ? "Dados insuficientes" : data.situacao === "sem_alertas" ? "Sem alertas" : "Sem alerta de risco"}
                  </span>
                </div>
                <div className="rounded-2xl bg-emerald-600 p-4 text-white">
                  <p className="text-sm font-medium text-emerald-50">Disponível para operação</p>
                  <p data-testid="text-disponivel-operacional" className="mt-1 text-3xl font-extrabold">{fmt(summary.disponivel)}</p>
                  <p className="mt-1 text-xs text-emerald-50">Dinheiro físico + PIX registrado − reserva protegida</p>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border bg-white p-3">
                    <p className="flex items-center gap-1 text-xs text-slate-500"><Wallet className="h-3.5 w-3.5" /> Saldo total</p>
                    <p data-testid="text-saldo-total" className="mt-1 font-bold">{fmt(summary.total)}</p>
                    <p className="text-[11px] text-slate-500">Dinheiro {fmt(summary.dinheiro)} · PIX {fmt(summary.pix)}</p>
                  </div>
                  <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
                    <p className="flex items-center gap-1 text-xs text-blue-700"><LockKeyhole className="h-3.5 w-3.5" /> Reserva atual {summary.protecaoAtiva ? "protegida" : "desativada"}</p>
                    <p data-testid="text-reserva-protegida" className="mt-1 font-bold text-blue-900">{fmt(summary.reserva)}</p>
                    <p className="text-[11px] text-blue-700">Meta máxima: {fmt(data.reservaAutomatica.meta)} · {summary.protecaoAtiva ? "fora do disponível" : "sem proteção ativa"}</p>
                  </div>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{summary.base}</p>
              </section>

              <section className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-sm" aria-label="Reserva gradual">
                <h3 className="flex items-center gap-2 font-bold text-blue-900"><LockKeyhole className="h-4 w-4" /> Reserva gradual</h3>
                <p className="mt-1 text-slate-700">
                  Protegido: <strong>{fmt(summary.reserva)}</strong> de {fmt(data.reservaAutomatica.meta)}.
                  {data.reservaAutomatica.falta > 0 && <> Faltam {fmt(data.reservaAutomatica.falta)} para o teto.</>}
                </p>
                {data.reservaAutomatica.entradaNova > 0 && (
                  <p className="mt-1 text-slate-700">Nova entrada no Caixa: <strong>{fmt(data.reservaAutomatica.entradaNova)}</strong>. Só depois de ela compor o saldo a reserva é recalculada.</p>
                )}
                {data.reservaAutomatica.aporte > 0 && (
                  <p data-testid="text-aporte-reserva" className="mt-1 font-semibold text-emerald-700">
                    A reserva aumentou {fmt(data.reservaAutomatica.aporte)} nesta atualização.
                  </p>
                )}
                {data.reservaAutomatica.estado === "pausada" && <p className="mt-1 text-amber-700">Aumento automático pausado: ative a proteção da reserva abaixo.</p>}
                {data.reservaAutomatica.estado === "sem_saldo" && <p className="mt-1 text-amber-700">Sem sessão da gaveta, não é seguro aumentar a reserva.</p>}
                {data.reservaAutomatica.estado === "iniciando" && <p className="mt-1 text-slate-600">Acompanhamento iniciado agora. As entradas anteriores já estão no saldo; só as próximas entradas poderão gerar novos aumentos.</p>}
                {data.reservaAutomatica.estado === "sem_entradas" && <p className="mt-1 text-slate-600">Nenhuma nova entrada em dinheiro ou PIX desde o último cálculo; o saldo antigo sozinho não aumenta a reserva.</p>}
                {data.reservaAutomatica.estado === "sem_margem" && <p className="mt-1 text-amber-700">A entrada já compõe o saldo, mas não há margem para aumentar a reserva sem comprometer contas ou pedidos.</p>}
                {data.reservaAutomatica.estado === "concluida" && <p className="mt-1 text-emerald-700">Meta atingida. Novas entradas ficam para a operação e os pedidos.</p>}
                {summary.reserva > data.reservaAutomatica.meta && <p className="mt-1 text-amber-700">O valor já protegido ultrapassa a nova meta. Ele não será reduzido sem seu ajuste manual.</p>}
                <p className="mt-2 text-xs leading-relaxed text-slate-600">
                  Depois de uma nova entrada aparecer no saldo, a IA pode separar até {data.reservaAutomatica.percentual}% desse valor, considerando {fmt(data.reservaAutomatica.contasProtegidas)} em contas previstas e até {fmt(data.reservaAutomatica.compraProtegida)} para pedidos agora. A taxa compara as entradas em dinheiro/PIX da semana ({fmt(data.reservaAutomatica.entradas7Dias)}) com o histórico: semana fraca 30%, normal 45%, forte 60%; sem histórico, 45%.
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
                    ["Lucro estimado", data.semana.lucro], ["Pode gastar*", summary.podeGastar],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl border bg-white p-3">
                      <p className="text-xs text-slate-500">{label}</p>
                      <p className="mt-1 font-bold">{fmt(value as number | null)}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500">* Disponível menos contas previstas nos próximos 7 dias e meta de compra. Estimativa conservadora; gastos não registrados não estão incluídos.</p>
                {Object.keys(data.categorias).length > 0 && <p className="text-xs text-slate-600">
                  Despesas por categoria: {Object.entries(data.categorias).map(([cat, value]) => `${cat}: ${fmt(value)}`).join(" · ")}
                </p>}
                <p className="text-xs text-slate-600">Contas previstas (7 dias): {fmt(data.despesasPrevistas.total)} · Projeção do saldo (7 dias): {fmt(data.projecao7Dias)} <span className="text-slate-500">(estimativa)</span></p>
                {data.estoqueBaixo.length > 0 && <p className="text-xs text-amber-700">Estoque baixo: {data.estoqueBaixo.map(p => `${p.modelo} (${p.quantidade})`).join(", ")}</p>}
              </section>

              <section className="rounded-xl border p-3" aria-label="Configuração financeira">
                <h3 className="font-bold text-slate-800">Metas e reserva</h3>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="text-xs text-slate-600">Reserva atual (R$)
                    <Input data-testid="input-reserva" type="number" inputMode="decimal" min="0" step="0.01" className="mt-1" value={reserva} onChange={e => setReserva(e.target.value)} />
                  </label>
                  <label className="text-xs text-slate-600">Meta máxima da reserva (R$)
                    <Input data-testid="input-meta-reserva" type="number" inputMode="decimal" min="0" step="0.01" className="mt-1" value={metaReserva} onChange={e => setMetaReserva(e.target.value)} />
                  </label>
                  <label className="col-span-2 text-xs text-slate-600">Valor para a próxima compra (R$)
                    <Input data-testid="input-meta-compra" type="number" inputMode="decimal" min="0" step="0.01" className="mt-1" value={meta} onChange={e => setMeta(e.target.value)} />
                  </label>
                </div>
                <p className="mt-2 text-xs text-slate-500">O aumento automático nunca passa da meta e pode voltar a subir após um ajuste manual se houver saldo suficiente.</p>
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input data-testid="toggle-protecao-reserva" type="checkbox" checked={proteger} onChange={e => setProteger(e.target.checked)} />
                  Proteger a reserva e permitir aumentos automáticos
                </label>
                <Button data-testid="button-salvar-financas" className="mt-3 w-full" disabled={saving} onClick={() => void saveConfig()}>{saving ? "Salvando..." : "Salvar configuração"}</Button>
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
              </>}

              <section id="conversa-financeira" className="scroll-mt-20 space-y-3" aria-label="Conversa com assistente financeiro">
                <h3 className="flex items-center gap-2 font-bold text-slate-800"><MessageCircle className="h-4 w-4" /> Pergunte sobre suas finanças</h3>
                {!dashboardHidden && <div className="flex flex-wrap gap-2">
                  {["Como está meu caixa?", "Quanto posso gastar hoje?", "Posso comprar R$ 1.500 em peças?", "Quanto faturei essa semana?"].map(q => (
                    <button data-testid={`button-pergunta-${q.length}`} key={q} type="button" onClick={() => void ask(q)} className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-800 hover:bg-blue-100">{q}</button>
                  ))}
                </div>}
                {messages.map((message, i) => <div key={i} className="space-y-1 text-sm">
                  <p className="ml-6 rounded-xl bg-slate-100 p-2 text-slate-800">{message.pergunta}</p>
                  <div className="mr-6 rounded-xl bg-blue-50 p-3 text-blue-950">
                    <p className="whitespace-pre-line leading-relaxed">{message.resposta}</p>
                    <button data-testid={`button-ouvir-resposta-${i}`} type="button" onClick={() => speak(message.resposta)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700"><Volume2 className="h-3.5 w-3.5" /> Ouvir de novo</button>
                  </div>
                </div>)}
                <form onSubmit={e => { e.preventDefault(); void ask(); }} className="flex items-center gap-2">
                  <Input data-testid="input-pergunta-financeira" className="min-w-0 flex-1" value={question} maxLength={400} onChange={e => { setQuestion(e.target.value); if (e.target.value.length > 0) hideDashboard(); }} placeholder="Pergunte sobre seu Caixa..." aria-label="Sua pergunta" />
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
                      <input data-testid="checkbox-ler-resposta-ia" type="checkbox" checked={readAloud} onChange={e => setReadAloud(e.target.checked)} />
                      Ler respostas
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
              {!dashboardHidden && <div className="border-t pt-3 text-[11px] leading-relaxed text-slate-500">
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
