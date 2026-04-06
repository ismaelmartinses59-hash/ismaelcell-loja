import { useState, useMemo } from "react";
import { useListOrders, useEditOrder, getListOrdersQueryKey, getGetOrderStatsQueryKey, OrderLinha } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, Search, CheckCircle2, Loader2, Smartphone, Calendar, Wrench, AlertTriangle, Pencil, Trash2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, addDays, isBefore, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Order } from "@workspace/api-client-react";

const GARANTIA_OPTIONS = ["7 dias", "30 dias", "90 dias", "6 meses", "1 ano"];
const GARANTIA_OPTIONS_EDIT = ["0 dias", ...GARANTIA_OPTIONS];

function parseGarantiaDias(garantia: string): number | null {
  if (!garantia || garantia === "Sem garantia" || garantia === "0 dias") return null;
  if (garantia === "7 dias") return 7;
  if (garantia === "30 dias") return 30;
  if (garantia === "90 dias") return 90;
  if (garantia === "6 meses") return 180;
  if (garantia === "1 ano") return 365;
  return null;
}

function getDataBase(order: { dataServico?: string | null; createdAt: string }): Date {
  if (order.dataServico) {
    const [y, m, d] = order.dataServico.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(order.createdAt);
}

function getExpiry(order: { dataServico?: string | null; createdAt: string; garantia?: string | null }): Date | null {
  const dias = parseGarantiaDias(order.garantia ?? "");
  if (!dias) return null;
  return addDays(getDataBase(order), dias);
}

interface GarantiaModalProps {
  open: boolean;
  onClose: () => void;
}

type Tab = "registrar" | "consultar";

export function GarantiaModal({ open, onClose }: GarantiaModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const editOrder = useEditOrder();

  const [tab, setTab] = useState<Tab>("registrar");

  // Aba Registrar
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  const [garantiaSelecionada, setGarantiaSelecionada] = useState("");

  // Aba Consultar
  const [consultaBusca, setConsultaBusca] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDeleteOrder, setConfirmDeleteOrder] = useState<Order | null>(null);

  const { data: ordersRegistrar = [], isLoading: loadingRegistrar } = useListOrders(
    { search: buscaAtiva },
    { query: { enabled: !!buscaAtiva && tab === "registrar" } }
  );

  const { data: todasOrders = [], isLoading: loadingConsultar } = useListOrders(
    {},
    { query: { enabled: open && tab === "consultar" } }
  );

  const orderRegistrar = buscaAtiva
    ? ordersRegistrar.find(o => {
        const codNum = o.codigo.replace(/^OS-/i, "").toLowerCase();
        const termLow = buscaAtiva.toLowerCase();
        return codNum === termLow || codNum.includes(termLow) || o.codigo.toLowerCase().includes(termLow);
      }) ?? (ordersRegistrar.length === 1 ? ordersRegistrar[0] : null)
    : null;

  const ordersComGarantia = useMemo(() => {
    return todasOrders
      .filter(o => o.garantia && o.garantia !== "Sem garantia" && o.garantia !== "0 dias")
      .filter(o => !consultaBusca
        || o.modelo.toLowerCase().includes(consultaBusca.toLowerCase())
        || o.codigo.toLowerCase().includes(consultaBusca.toLowerCase())
        || (o.nomeCliente ?? "").toLowerCase().includes(consultaBusca.toLowerCase())
      )
      .sort((a, b) => {
        const ea = getExpiry(a);
        const eb = getExpiry(b);
        if (!ea && !eb) return 0;
        if (!ea) return 1;
        if (!eb) return -1;
        return ea.getTime() - eb.getTime();
      });
  }, [todasOrders, consultaBusca]);

  const valiasCount = ordersComGarantia.filter(o => {
    const exp = getExpiry(o);
    return exp && !isBefore(exp, new Date());
  }).length;

  // ── Helpers ──────────────────────────────────────────
  const saveGarantia = (order: Order, novaGarantia: string, onSuccess?: () => void) => {
    editOrder.mutate(
      {
        id: order.id,
        data: {
          modelo: order.modelo,
          linha: order.linha as OrderLinha,
          servico: order.servico,
          valor: order.valor,
          tempo: order.tempo,
          nomeCliente: order.nomeCliente ?? undefined,
          senhaDispo: order.senhaDispo ?? undefined,
          garantia: novaGarantia,
          dataServico: order.dataServico ?? undefined,
        }
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetOrderStatsQueryKey() });
          onSuccess?.();
        },
        onError: () => toast({ title: "Erro ao salvar", variant: "destructive" }),
      }
    );
  };

  // ── Registrar handlers ───────────────────────────────
  const handleBuscar = () => {
    const termo = busca.trim();
    if (!termo) return;
    // Remove o prefixo "OS-" (com qualquer capitalização) para a busca no backend
    const numPart = termo.replace(/^os-/i, "");
    setBuscaAtiva(numPart);
    setGarantiaSelecionada("");
  };

  const handleSalvarRegistrar = () => {
    if (!orderRegistrar || !garantiaSelecionada) return;
    saveGarantia(orderRegistrar, garantiaSelecionada, () => {
      toast({ title: "Garantia registrada!", description: `${orderRegistrar.codigo} — ${garantiaSelecionada}` });
      setBusca("");
      setBuscaAtiva("");
      setGarantiaSelecionada("");
    });
  };

  // ── Consultar / Edit handlers ────────────────────────
  const handleStartEdit = (order: Order) => {
    setEditingId(order.id);
    setEditValue(order.garantia ?? "");
  };

  const handleEditChange = (order: Order, value: string) => {
    if (value === "0 dias") {
      setConfirmDeleteOrder(order);
      setEditingId(null);
      setEditValue("");
    } else {
      setEditValue(value);
    }
  };

  const handleSalvarEdit = (order: Order) => {
    if (!editValue) return;
    saveGarantia(order, editValue, () => {
      toast({ title: "Garantia atualizada!", description: `${order.codigo} — ${editValue}` });
      setEditingId(null);
      setEditValue("");
    });
  };

  const handleConfirmDelete = () => {
    if (!confirmDeleteOrder) return;
    saveGarantia(confirmDeleteOrder, "Sem garantia", () => {
      toast({ title: "Garantia removida", description: confirmDeleteOrder.codigo });
      setConfirmDeleteOrder(null);
    });
  };

  // ── Close ────────────────────────────────────────────
  const handleClose = () => {
    setBusca("");
    setBuscaAtiva("");
    setGarantiaSelecionada("");
    setConsultaBusca("");
    setEditingId(null);
    setEditValue("");
    setConfirmDeleteOrder(null);
    setTab("registrar");
    onClose();
  };

  const hoje = new Date();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-sm max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Shield className="w-5 h-5 text-yellow-600" />
            Garantias
          </DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          <button
            onClick={() => setTab("registrar")}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${tab === "registrar" ? "bg-white shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Registrar
          </button>
          <button
            onClick={() => setTab("consultar")}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${tab === "consultar" ? "bg-white shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Consultar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 pr-0.5">

          {/* ── ABA REGISTRAR ─────────────────────────────── */}
          {tab === "registrar" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Digite o número da OS para registrar a garantia</p>
              <div className="flex gap-2">
                <Input
                  placeholder="Ex: 1234567890"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleBuscar()}
                  className="flex-1"
                />
                <Button size="sm" onClick={handleBuscar} disabled={!busca.trim()}>
                  <Search className="w-4 h-4" />
                </Button>
              </div>

              {loadingRegistrar && buscaAtiva && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-3 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> Buscando...
                </div>
              )}

              {buscaAtiva && !loadingRegistrar && !orderRegistrar && (
                <div className="text-center py-4 text-sm text-muted-foreground rounded-lg border border-dashed">
                  Nenhuma OS encontrada para <strong>{buscaAtiva}</strong>
                </div>
              )}

              {orderRegistrar && (
                <div className="rounded-xl border bg-muted/40 p-4 space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">#{orderRegistrar.codigo}</span>
                      {orderRegistrar.garantia && orderRegistrar.garantia !== "Sem garantia" && (
                        <span className="text-xs bg-yellow-100 text-yellow-700 border border-yellow-200 px-2 py-0.5 rounded-full font-medium">
                          Atual: {orderRegistrar.garantia}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Smartphone className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="font-semibold">{orderRegistrar.modelo}</span>
                      <span className="text-muted-foreground text-xs capitalize">({orderRegistrar.linha})</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Wrench className="w-3.5 h-3.5 shrink-0" />
                      <span>{orderRegistrar.servico}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="w-3.5 h-3.5 shrink-0" />
                      {orderRegistrar.dataServico
                        ? (() => { const [y,m,d] = orderRegistrar.dataServico!.split("-"); return `${d}/${m}/${y}`; })()
                        : format(new Date(orderRegistrar.createdAt), "dd/MM/yyyy", { locale: ptBR })
                      }
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 border-t">
                    <p className="text-xs font-semibold uppercase tracking-wider">Período de Garantia</p>
                    <Select value={garantiaSelecionada} onValueChange={setGarantiaSelecionada}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o período..." />
                      </SelectTrigger>
                      <SelectContent>
                        {GARANTIA_OPTIONS.map((g) => (
                          <SelectItem key={g} value={g}>{g}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button className="w-full" onClick={handleSalvarRegistrar} disabled={!garantiaSelecionada || editOrder.isPending}>
                      {editOrder.isPending
                        ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        : <CheckCircle2 className="w-4 h-4 mr-2" />
                      }
                      Salvar Garantia
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── ABA CONSULTAR ────────────────────────────── */}
          {tab === "consultar" && (
            <div className="space-y-3">
              {loadingConsultar ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
                </div>
              ) : (
                <>
                  {/* Contador resumo */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-center">
                      <p className="text-2xl font-bold text-green-700">{valiasCount}</p>
                      <p className="text-xs text-green-600 font-medium mt-0.5">Em garantia</p>
                    </div>
                    <div className="rounded-lg bg-muted border p-3 text-center">
                      <p className="text-2xl font-bold">{ordersComGarantia.length}</p>
                      <p className="text-xs text-muted-foreground font-medium mt-0.5">Com garantia</p>
                    </div>
                  </div>

                  {/* Confirmação de exclusão */}
                  {confirmDeleteOrder && (
                    <div className="rounded-xl border-2 border-red-200 bg-red-50 p-4 space-y-3">
                      <div className="flex items-start gap-2">
                        <Trash2 className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-red-800">Apagar garantia?</p>
                          <p className="text-xs text-red-600 mt-0.5">
                            {confirmDeleteOrder.modelo} — {confirmDeleteOrder.garantia}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          className="flex-1"
                          onClick={handleConfirmDelete}
                          disabled={editOrder.isPending}
                        >
                          {editOrder.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Confirmar"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          onClick={() => setConfirmDeleteOrder(null)}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Busca */}
                  {ordersComGarantia.length > 0 && (
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Filtrar por modelo, cliente, OS..."
                        className="pl-9"
                        value={consultaBusca}
                        onChange={(e) => setConsultaBusca(e.target.value)}
                      />
                    </div>
                  )}

                  {/* Lista */}
                  {ordersComGarantia.length === 0 && !confirmDeleteOrder ? (
                    <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
                      Nenhuma OS com garantia registrada ainda.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {ordersComGarantia.map((o) => {
                        const expiry = getExpiry(o);
                        const expirado = expiry ? isBefore(expiry, hoje) : false;
                        const diasRestantes = expiry ? differenceInDays(expiry, hoje) : null;
                        const isEditing = editingId === o.id;

                        return (
                          <div
                            key={o.id}
                            className={`rounded-lg border p-3 space-y-2 transition-colors ${
                              isEditing
                                ? "border-primary/40 bg-primary/5"
                                : expirado
                                ? "bg-red-50/50 border-red-100"
                                : "bg-green-50/30 border-green-100"
                            }`}
                          >
                            {/* Info do card */}
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-semibold text-sm truncate">{o.modelo}</p>
                                {o.nomeCliente && <p className="text-xs text-muted-foreground truncate">{o.nomeCliente}</p>}
                                <p className="font-mono text-[10px] text-muted-foreground">#{o.codigo}</p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {!isEditing && (
                                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${expirado ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                                    {o.garantia}
                                  </span>
                                )}
                                {!isEditing ? (
                                  <button
                                    onClick={() => handleStartEdit(o)}
                                    className="p-1 rounded hover:bg-black/5 text-muted-foreground hover:text-foreground transition-colors"
                                    title="Editar garantia"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => { setEditingId(null); setEditValue(""); }}
                                    className="p-1 rounded hover:bg-black/5 text-muted-foreground hover:text-foreground transition-colors"
                                    title="Cancelar"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Validade (só quando não editando) */}
                            {!isEditing && (
                              <div className="flex items-center gap-2 text-xs text-muted-foreground border-t border-inherit pt-1.5">
                                {expirado
                                  ? <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                                  : <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                                }
                                <span className="truncate">{o.servico}</span>
                                {expiry && (
                                  <span className={`ml-auto shrink-0 font-medium ${expirado ? "text-red-500" : "text-green-600"}`}>
                                    {expirado
                                      ? `Expirou ${format(expiry, "dd/MM/yy")}`
                                      : diasRestantes === 0
                                        ? "Expira hoje"
                                        : `${diasRestantes}d`
                                    }
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Edição inline */}
                            {isEditing && (
                              <div className="space-y-2 pt-1 border-t border-primary/20">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                                  Novo período — selecione "0 dias" para apagar
                                </p>
                                <Select value={editValue} onValueChange={(v) => handleEditChange(o, v)}>
                                  <SelectTrigger className="h-8 text-sm">
                                    <SelectValue placeholder="Selecione..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {GARANTIA_OPTIONS_EDIT.map((g) => (
                                      <SelectItem key={g} value={g} className={g === "0 dias" ? "text-red-600 font-medium" : ""}>
                                        {g === "0 dias" ? "0 dias (apagar garantia)" : g}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Button
                                  size="sm"
                                  className="w-full h-8"
                                  onClick={() => handleSalvarEdit(o)}
                                  disabled={!editValue || editOrder.isPending}
                                >
                                  {editOrder.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                                  Salvar
                                </Button>
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
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
