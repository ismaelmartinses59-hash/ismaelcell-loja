import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const fmt = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const localDateTime = () => {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return date.toISOString().slice(0, 16);
};
const localDateTimeFromIso = (value: string) => {
  const date = new Date(new Date(value).getTime() - new Date().getTimezoneOffset() * 60000);
  return date.toISOString().slice(0, 16);
};
type CashOut = { id: number; valor: string; motivo: string; categoria: string | null; createdAt: string; formaPagamento: string | null };
type HistoryRow = { id: string; usoId: number; tipo: string; valor: number; data: string; motivo: string; estornada: boolean };
type ReserveData = { saldo: number; saidasDisponiveis: CashOut[]; historico: HistoryRow[] };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}/api${path}`, {
    credentials: "same-origin", cache: "no-store", ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Não foi possível atualizar a reserva.");
  return body as T;
}

export function ReservaUtilizacaoPanel({ saldo }: { saldo: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [tipo, setTipo] = useState<"despesa" | "transferencia">("despesa");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(localDateTime);
  const [categoria, setCategoria] = useState("outros");
  const [motivo, setMotivo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("dinheiro");
  const [origemDinheiro, setOrigemDinheiro] = useState("");
  const [caixaId, setCaixaId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestKey = useRef(crypto.randomUUID());
  const { data: reserve, refetch } = useQuery<ReserveData>({
    queryKey: ["financeiro-ia-reserva"],
    queryFn: () => api("/financeiro-ia/reserva"),
    staleTime: 0,
  });

  async function submit() {
    setError("");
    const amount = Number(valor.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0 || amount > saldo || !motivo.trim()) {
      setError("Informe um valor positivo dentro do saldo protegido e o motivo.");
      return;
    }
    setBusy(true);
    try {
      await api("/financeiro-ia/reserva/utilizacoes", {
        method: "POST",
        body: JSON.stringify({
          requestKey: requestKey.current,
          valor: amount.toFixed(2),
          tipo,
          categoria,
          motivo: motivo.trim(),
          descricao: descricao.trim() || undefined,
          data: new Date(data).toISOString(),
          formaPagamento: caixaId ? undefined : formaPagamento,
          origemDinheiro: tipo === "transferencia" ? origemDinheiro : undefined,
          caixaId: caixaId || undefined,
        }),
      });
      requestKey.current = crypto.randomUUID();
      setValor(""); setMotivo(""); setDescricao(""); setCaixaId("");
      setData(localDateTime()); setOpen(false);
      await Promise.all([
        refetch(),
        qc.invalidateQueries({ queryKey: ["financeiro-ia"] }),
        qc.invalidateQueries({ queryKey: ["caixa"] }),
        qc.invalidateQueries({ queryKey: ["caixa-historico"] }),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar a utilização.");
    } finally { setBusy(false); }
  }

  async function estornar(id: number) {
    const motivoEstorno = window.prompt("Motivo do estorno:", "Utilização estornada");
    if (motivoEstorno === null) return;
    try {
      await api(`/financeiro-ia/reserva/utilizacoes/${id}/estornar`, {
        method: "POST", body: JSON.stringify({ motivo: motivoEstorno }),
      });
      await Promise.all([refetch(), qc.invalidateQueries({ queryKey: ["financeiro-ia"] })]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível estornar.");
    }
  }

  const history = reserve?.historico ?? [];
  return (
    <section className="mt-3 rounded-xl border border-blue-200 bg-white p-3" aria-label="Utilização do saldo protegido">
      <Button type="button" className="mt-3 h-8" onClick={() => setOpen(value => !value)}>
        {open ? "Cancelar" : "Registrar saída de emergência"}
      </Button>
      {open && (
        <div className="mt-3 grid gap-2 rounded-lg border bg-slate-50 p-3 text-sm">
          <label>Tipo de utilização
            <select className="mt-1 h-9 w-full rounded-md border bg-white px-2" value={tipo} onChange={e => setTipo(e.target.value as typeof tipo)}>
              <option value="despesa">Despesa real</option><option value="transferencia">Transferência interna</option>
            </select>
          </label>
          <label>Valor
            <Input type="number" min="0.01" step="0.01" max={saldo} value={valor} onChange={e => setValor(e.target.value)} />
          </label>
          <label>Data e hora
            <Input type="datetime-local" value={data} disabled={tipo === "despesa" && !!caixaId} onChange={e => setData(e.target.value)} />
          </label>
          <label>Categoria
            <select className="mt-1 h-9 w-full rounded-md border bg-white px-2" value={categoria} onChange={e => setCategoria(e.target.value)}>
              {["pecas", "frete", "aluguel", "energia", "internet", "agua", "combustivel", "ferramentas", "alimentacao", "retirada pessoal", "parcelas", "outros"].map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>Motivo
            <Input value={motivo} maxLength={120} onChange={e => setMotivo(e.target.value)} placeholder="Por que a reserva será utilizada?" />
          </label>
          <label>Descrição opcional
            <Input value={descricao} maxLength={500} onChange={e => setDescricao(e.target.value)} />
          </label>
          {tipo === "transferencia" && <label>Origem do dinheiro (opcional)
            <Input value={origemDinheiro} maxLength={80} onChange={e => setOrigemDinheiro(e.target.value)} placeholder="Ex.: conta bancária da loja" />
          </label>}
          {tipo === "despesa" && (
            <>
              <label>Saída já registrada no Caixa (opcional)
                <select className="mt-1 h-9 w-full rounded-md border bg-white px-2" value={caixaId} onChange={e => {
                  const selected = (reserve?.saidasDisponiveis ?? []).find(row => String(row.id) === e.target.value);
                  setCaixaId(e.target.value);
                  if (selected) {
                    const raw = selected.valor.replace(/[^\d,.-]/g, "");
                    setValor((raw.includes(",") ? Number(raw.replace(/\./g, "").replace(",", ".")) : Number(raw)).toFixed(2));
                    setData(localDateTimeFromIso(selected.createdAt));
                  }
                }}>
                  <option value="">Registrar uma nova saída</option>
                  {(reserve?.saidasDisponiveis ?? []).map(row => <option key={row.id} value={row.id}>#{row.id} · {row.motivo} · {row.valor} · {new Date(row.createdAt).toLocaleString("pt-BR")}</option>)}
                </select>
              </label>
              {!caixaId && <label>Forma de pagamento
                <select className="mt-1 h-9 w-full rounded-md border bg-white px-2" value={formaPagamento} onChange={e => setFormaPagamento(e.target.value)}>
                  <option value="dinheiro">Dinheiro</option><option value="pix">PIX</option>
                </select>
              </label>}
            </>
          )}
          {tipo === "transferencia" && <p className="text-xs text-slate-600">Transferência interna: será registrada no histórico da reserva, sem criar uma despesa no Caixa.</p>}
          {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
          <Button type="button" disabled={busy} onClick={() => void submit()}>{busy ? "Salvando..." : "Confirmar saída"}</Button>
        </div>
      )}
      <div className="mt-3 space-y-2">
        <h4 className="text-sm font-semibold">Histórico de saídas de emergência</h4>
        {history.length === 0 && <p className="border-t pt-2 text-xs text-slate-500">Nenhuma saída de emergência registrada.</p>}
        {history.slice(0, showAll ? history.length : 5).map(row => (
          <div key={row.id} className="flex items-start justify-between gap-2 border-t pt-2 text-xs">
            <div>
              <p className="font-semibold">Saída de emergência · {fmt(row.valor)}</p>
              <p>{row.motivo}</p>
              <p className="text-slate-500">{new Date(row.data).toLocaleString("pt-BR")}</p>
              {row.estornada && <p className="font-semibold text-amber-700">Estornada</p>}
            </div>
            {row.usoId && !row.estornada && <Button type="button" variant="outline" className="h-7 shrink-0 px-2" onClick={() => void estornar(row.usoId!)}>Estornar</Button>}
          </div>
        ))}
        {history.length > 5 && <Button type="button" variant="ghost" className="h-7 px-2" onClick={() => setShowAll(value => !value)}>{showAll ? "Mostrar menos" : "Ver todas as saídas"}</Button>}
      </div>
    </section>
  );
}
