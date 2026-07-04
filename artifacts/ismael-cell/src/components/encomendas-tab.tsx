import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Truck, Check, X, Trash2, PackageCheck, Clock, Undo2, AlertTriangle } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const FORNECEDORES = [
  "LEIVAS CELL",
  "PREMIUM CELL",
  "PIAUÍ FRONTAIS",
  "SHOPPING DOS COMPONENTES",
  "OUTROS",
];

function apiFetch(path: string, opts?: RequestInit) {
  return fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  }).then((r) => {
    if (!r.ok) throw new Error(`Erro ${r.status}`);
    if (r.status === 204) return null;
    return r.json();
  });
}

function parsePtBR(val: string | null | undefined): number {
  let s = String(val ?? "").replace(/[^\d.,-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatMoney = (val: string) => fmtBRL(parsePtBR(val));
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

interface EncomendaItem {
  id: number;
  encomendaId: number;
  modelo: string;
  qualidade: string;
  quantidade: number;
  qtdRecebida: number;
  valorCusto: string;
  valorCliente: string;
  valorLojista: string;
  status: string;
  reembolsoForma: string | null;
  createdAt: string;
}

interface Encomenda {
  id: number;
  fornecedor: string;
  formaInvestimento: string;
  status: string;
  saidaCaixaId: number | null;
  createdAt: string;
  itens: EncomendaItem[];
}

interface EncomendasResp {
  encomendas: Encomenda[];
  saldosPorFornecedor: { fornecedor: string; total: number }[];
  saldoTotal: number;
}

export function EncomendasTab({ open }: { open: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<EncomendasResp>({
    queryKey: ["encomendas"],
    queryFn: () => apiFetch("/api/encomendas"),
    enabled: open,
  });

  const [receivingId, setReceivingId] = useState<number | null>(null);
  const [recebimentos, setRecebimentos] = useState<Record<number, string>>({});
  const [cancelItemId, setCancelItemId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["encomendas"] });
    qc.invalidateQueries({ queryKey: ["pecas"] });
    qc.invalidateQueries({ queryKey: ["caixa-hoje"] });
    qc.invalidateQueries({ queryKey: ["caixa-dia"] });
    qc.invalidateQueries({ queryKey: ["caixa-historico"] });
    qc.invalidateQueries({ queryKey: ["caixa-sessao-hoje"] });
    qc.invalidateQueries({ queryKey: ["caixa-pecas"] });
    qc.invalidateQueries({ queryKey: ["vendas"] });
  };

  const receberMutation = useMutation({
    mutationFn: (payload: { id: number; recebimentos: { itemId: number; qtd: number }[] }) =>
      apiFetch(`/api/encomendas/${payload.id}/receber`, {
        method: "POST",
        body: JSON.stringify({ recebimentos: payload.recebimentos }),
      }),
    onSuccess: () => {
      invalidate();
      setReceivingId(null);
      setRecebimentos({});
      toast({ title: "Chegada confirmada!", description: "Estoque atualizado e saída lançada no caixa." });
    },
    onError: () => toast({ title: "Erro ao confirmar chegada", variant: "destructive" }),
  });

  const cancelarMutation = useMutation({
    mutationFn: (payload: { encomendaId: number; itemId: number; reembolsoForma: "dinheiro" | "pix" }) =>
      apiFetch(`/api/encomendas/${payload.encomendaId}/itens/${payload.itemId}/cancelar`, {
        method: "POST",
        body: JSON.stringify({ reembolsoForma: payload.reembolsoForma }),
      }),
    onSuccess: (_r, v) => {
      invalidate();
      setCancelItemId(null);
      toast({ title: "Item cancelado", description: `Reembolso em ${v.reembolsoForma}.` });
    },
    onError: () => toast({ title: "Erro ao cancelar", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/encomendas/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      setDeletingId(null);
      toast({ title: "Encomenda excluída" });
    },
    onError: () => toast({ title: "Não é possível excluir", description: "Essa encomenda já teve chegada confirmada.", variant: "destructive" }),
  });

  const saldos = data?.saldosPorFornecedor ?? [];
  const saldoTotal = data?.saldoTotal ?? 0;
  const encomendas = data?.encomendas ?? [];

  const startReceber = (enc: Encomenda) => {
    const init: Record<number, string> = {};
    for (const it of enc.itens) {
      if (it.status === "aguardando") init[it.id] = String(Math.max(0, it.quantidade - it.qtdRecebida));
    }
    setRecebimentos(init);
    setReceivingId(enc.id);
  };

  const confirmReceber = (enc: Encomenda) => {
    const list = enc.itens
      .filter((it) => it.status === "aguardando")
      .map((it) => ({ itemId: it.id, qtd: parseInt(recebimentos[it.id] ?? "0") || 0 }))
      .filter((r) => r.qtd > 0);
    if (list.length === 0) {
      toast({ title: "Informe o que chegou", description: "Digite a quantidade de ao menos um item.", variant: "destructive" });
      return;
    }
    receberMutation.mutate({ id: enc.id, recebimentos: list });
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 pt-3 pb-4 space-y-3">
      {/* Resumo: na mão dos fornecedores */}
      <div className="rounded-xl border bg-amber-50 border-amber-200 px-3 py-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700 flex items-center gap-1.5">
            <Truck className="w-3.5 h-3.5" /> Na mão dos fornecedores
          </div>
          <div className="text-base font-extrabold text-amber-800">{fmtBRL(saldoTotal)}</div>
        </div>
        {saldos.length > 0 ? (
          <div className="space-y-1">
            {saldos.map((s) => (
              <div key={s.fornecedor} className="flex items-center justify-between text-xs">
                <span className="text-amber-900/80 font-medium truncate">{s.fornecedor}</span>
                <span className="font-bold text-amber-800">{fmtBRL(s.total)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-amber-700/70">Nada aguardando no momento.</p>
        )}
      </div>

      {isLoading && <div className="text-center py-8 text-muted-foreground text-sm">Carregando...</div>}
      {!isLoading && encomendas.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          <PackageCheck className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Nenhuma encomenda a caminho</p>
          <p className="text-xs mt-1 opacity-70">Cadastre uma compra como "Encomenda" na aba Peças.</p>
        </div>
      )}

      {encomendas.map((enc) => {
        const isReceiving = receivingId === enc.id;
        const isDeleting = deletingId === enc.id;
        const podeExcluir = enc.saidaCaixaId === null;
        const totalAguardando = enc.itens
          .filter((it) => it.status === "aguardando")
          .reduce((s, it) => s + parsePtBR(it.valorCusto) * Math.max(0, it.quantidade - it.qtdRecebida), 0);
        return (
          <div key={enc.id} className="rounded-xl border bg-white p-3 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold text-sm truncate">{enc.fornecedor}</div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <Clock className="w-3 h-3" /> Compra {formatDate(enc.createdAt)} ·{" "}
                  {enc.formaInvestimento === "pix" ? "📱 PIX" : "💵 Dinheiro"}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-extrabold text-amber-700">{fmtBRL(totalAguardando)}</div>
                <div className="text-[10px] text-muted-foreground">aguardando</div>
              </div>
            </div>

            {/* Itens */}
            <div className="space-y-1">
              {enc.itens.map((it) => {
                const faltante = Math.max(0, it.quantidade - it.qtdRecebida);
                const isCancelling = cancelItemId === it.id;
                const statusLabel =
                  it.status === "recebido" ? "Recebido" : it.status === "cancelado" ? "Cancelado" : `Faltam ${faltante}`;
                const statusClass =
                  it.status === "recebido"
                    ? "bg-green-100 text-green-700"
                    : it.status === "cancelado"
                    ? "bg-red-100 text-red-600"
                    : "bg-amber-100 text-amber-700";
                return (
                  <div key={it.id} className="rounded-lg bg-muted/40 px-2.5 py-2 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate">{it.modelo}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {it.qualidade} · {it.qtdRecebida}/{it.quantidade} un. · custo {formatMoney(it.valorCusto)}
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusClass}`}>{statusLabel}</span>
                    </div>

                    {/* Receber: input por item */}
                    {isReceiving && it.status === "aguardando" && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">Chegou:</span>
                        <Input
                          type="number"
                          min={0}
                          max={faltante}
                          value={recebimentos[it.id] ?? ""}
                          onChange={(e) => setRecebimentos((c) => ({ ...c, [it.id]: e.target.value }))}
                          className="h-8 w-20 text-sm"
                        />
                        <span className="text-[10px] text-muted-foreground">de {faltante}</span>
                      </div>
                    )}

                    {/* Cancelar item */}
                    {!isReceiving && it.status === "aguardando" && (
                      isCancelling ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground">Reembolso:</span>
                          <Button
                            size="sm"
                            className="h-7 flex-1 text-[11px] bg-emerald-600 hover:bg-emerald-700"
                            disabled={cancelarMutation.isPending}
                            onClick={() => cancelarMutation.mutate({ encomendaId: enc.id, itemId: it.id, reembolsoForma: "dinheiro" })}
                          >
                            💵 Dinheiro
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 flex-1 text-[11px] bg-blue-600 hover:bg-blue-700"
                            disabled={cancelarMutation.isPending}
                            onClick={() => cancelarMutation.mutate({ encomendaId: enc.id, itemId: it.id, reembolsoForma: "pix" })}
                          >
                            📱 PIX
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setCancelItemId(null)}>
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setCancelItemId(it.id)}
                          className="text-[10px] text-red-500 hover:text-red-700 font-medium flex items-center gap-1"
                        >
                          <Undo2 className="w-3 h-3" /> Cancelar (não veio)
                        </button>
                      )
                    )}
                  </div>
                );
              })}
            </div>

            {/* Ações da encomenda */}
            {isReceiving ? (
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1 h-9" onClick={() => { setReceivingId(null); setRecebimentos({}); }} disabled={receberMutation.isPending}>
                  <X className="w-4 h-4 mr-1" /> Cancelar
                </Button>
                <Button className="flex-1 h-9 bg-green-600 hover:bg-green-700" onClick={() => confirmReceber(enc)} disabled={receberMutation.isPending}>
                  <Check className="w-4 h-4 mr-1" /> {receberMutation.isPending ? "Salvando..." : "Confirmar chegada"}
                </Button>
              </div>
            ) : isDeleting ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 space-y-2">
                <div className="text-xs font-semibold text-red-800">Excluir a encomenda de {enc.fornecedor}?</div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" className="flex-1 h-8" onClick={() => setDeletingId(null)}>Não</Button>
                  <Button size="sm" variant="destructive" className="flex-1 h-8" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(enc.id)}>
                    {deleteMutation.isPending ? "..." : "Sim, excluir"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button className="flex-1 h-9 bg-green-600 hover:bg-green-700" onClick={() => startReceber(enc)}>
                  <PackageCheck className="w-4 h-4 mr-1.5" /> Chegou
                </Button>
                {podeExcluir ? (
                  <Button variant="outline" className="h-9 text-red-600 border-red-200 hover:bg-red-50" onClick={() => setDeletingId(enc.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                ) : (
                  <div className="flex items-center px-2 text-[10px] text-muted-foreground gap-1" title="Já teve chegada confirmada (saída lançada)">
                    <AlertTriangle className="w-3.5 h-3.5" />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
