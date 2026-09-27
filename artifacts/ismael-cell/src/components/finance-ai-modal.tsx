import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownRight, Bot, LockKeyhole, MessageCircle, Package, Send, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const fmt = (n: number | null) => n === null
  ? "Sem dados" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const todaySP = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
}).format(new Date());

type Alert = { nivel: "risco" | "atencao" | "positivo"; titulo: string; texto: string };
type FinanceSnapshot = {
  atualizadoEm: string;
  saldos: {
    dinheiro: number | null; pix: number; total: number | null;
    reserva: number; protecaoAtiva: boolean; disponivel: number | null;
    podeGastar: number | null; base: string;
  };
  metaCompra: number;
  faltamMeta: number | null;
  semana: { entradas: number; saidas: number; retiradas: number; compras: number; lucro: number | null; custoAusente: boolean };
  mes: { entradas: number; saidas: number; lucro: number | null };
  compras: { totalSemana: number; mediaSemanal: number | null; menor: number | null; maior: number | null; tendencia: number | null; diaHabitual: number | null; semanasRegistradas: number };
  categorias: Record<string, number>;
  estoqueBaixo: { id: number; modelo: string; quantidade: number }[];
  despesasPrevistas: { total: number; contas: { nome: string; valor: number; vencimento: string }[] };
  projecao7Dias: number | null;
  situacao: "risco" | "atencao" | "saudavel";
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
    staleTime: 30000,
    refetchInterval: open ? 60000 : false,
    queryFn: () => api("/financeiro-ia"),
  });
  const [reserva, setReserva] = useState("0");
  const [meta, setMeta] = useState("0");
  const [proteger, setProteger] = useState(false);
  const [saving, setSaving] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<{ pergunta: string; resposta: string }[]>([]);
  const [thinking, setThinking] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todaySP);
  const [payment, setPayment] = useState<"dinheiro" | "pix">("dinheiro");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!data) return;
    setReserva(String(data.saldos.reserva.toFixed(2)));
    setMeta(String(data.metaCompra.toFixed(2)));
    setProteger(data.saldos.protecaoAtiva);
  }, [data?.saldos.reserva, data?.metaCompra, data?.saldos.protecaoAtiva]);

  async function saveConfig() {
    setSaving(true);
    try {
      await api("/financeiro-ia/config", {
        method: "PUT",
        body: JSON.stringify({ reserva, metaCompra: meta, protecaoAtiva: proteger }),
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
    setQuestion("");
    setThinking(true);
    try {
      const result = await api<{ resposta: string }>("/financeiro-ia/perguntar", {
        method: "POST", body: JSON.stringify({ pergunta }),
      });
      setMessages(prev => [...prev, { pergunta, resposta: result.resposta }]);
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
      await api("/financeiro-ia/retiradas", {
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
      toast({ title: "Retirada registrada no Caixa" });
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
              <section aria-label="Disponibilidade financeira">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-bold text-slate-800">O que posso usar agora?</h3>
                  <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${data.situacao === "risco" ? "bg-red-100 text-red-700" : data.situacao === "atencao" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                    {data.situacao === "risco" ? "Risco" : data.situacao === "atencao" ? "Atenção" : "Saudável"}
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
                    <p className="flex items-center gap-1 text-xs text-blue-700"><LockKeyhole className="h-3.5 w-3.5" /> Reserva {summary.protecaoAtiva ? "protegida" : "desativada"}</p>
                    <p data-testid="text-reserva-protegida" className="mt-1 font-bold text-blue-900">{fmt(summary.reserva)}</p>
                    <p className="text-[11px] text-blue-700">{summary.protecaoAtiva ? "Fora do disponível" : "Sem proteção ativa"}</p>
                  </div>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{summary.base}</p>
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
                <h3 className="font-bold text-slate-800">Observações</h3>
                {data.observacoes.map((item, i) => (
                  <div key={`${item.titulo}-${i}`} className={`rounded-xl border p-3 text-sm ${severities[item.nivel]}`}>
                    <p className="flex items-center gap-1 font-bold"><AlertTriangle className="h-4 w-4" /> {item.titulo}</p>
                    <p className="mt-1 leading-relaxed">{item.texto}</p>
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
                <h3 className="font-bold text-slate-800">Reserva e meta</h3>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="text-xs text-slate-600">Reserva (R$)
                    <Input data-testid="input-reserva" type="number" inputMode="decimal" min="0" step="0.01" className="mt-1" value={reserva} onChange={e => setReserva(e.target.value)} />
                  </label>
                  <label className="text-xs text-slate-600">Compra planejada (R$)
                    <Input data-testid="input-meta-compra" type="number" inputMode="decimal" min="0" step="0.01" className="mt-1" value={meta} onChange={e => setMeta(e.target.value)} />
                  </label>
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input data-testid="toggle-protecao-reserva" type="checkbox" checked={proteger} onChange={e => setProteger(e.target.checked)} />
                  Proteger a reserva no cálculo do disponível
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

              <section className="space-y-3" aria-label="Conversa com assistente financeiro">
                <h3 className="flex items-center gap-2 font-bold text-slate-800"><MessageCircle className="h-4 w-4" /> Pergunte sobre suas finanças</h3>
                <div className="flex flex-wrap gap-2">
                  {["Como está meu caixa?", "Quanto posso gastar hoje?", "Posso comprar R$ 1.500 em peças?", "Quanto faturei essa semana?"].map(q => (
                    <button data-testid={`button-pergunta-${q.length}`} key={q} type="button" onClick={() => void ask(q)} className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-800 hover:bg-blue-100">{q}</button>
                  ))}
                </div>
                {messages.map((message, i) => <div key={i} className="space-y-1 text-sm">
                  <p className="ml-6 rounded-xl bg-slate-100 p-2 text-slate-800">{message.pergunta}</p>
                  <p className="mr-6 rounded-xl bg-blue-50 p-3 leading-relaxed text-blue-950">{message.resposta}</p>
                </div>)}
                <form onSubmit={e => { e.preventDefault(); void ask(); }} className="flex gap-2">
                  <Input data-testid="input-pergunta-financeira" value={question} maxLength={400} onChange={e => setQuestion(e.target.value)} placeholder="Pergunte sobre seu Caixa..." aria-label="Sua pergunta" />
                  <Button data-testid="button-enviar-pergunta" disabled={thinking || !question.trim()} type="submit" aria-label="Enviar pergunta"><Send className="h-4 w-4" /></Button>
                </form>
                {thinking && <p className="text-xs text-slate-500">Conferindo os registros...</p>}
              </section>
              <div className="border-t pt-3 text-[11px] leading-relaxed text-slate-500">
                {data.avisos.map((notice, i) => <p key={i}>{notice}</p>)}
                <p className="mt-2">Atualizado em {new Date(data.atualizadoEm).toLocaleString("pt-BR")}. Nenhuma sugestão altera seu Caixa automaticamente.</p>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}