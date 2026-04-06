import { useState, useMemo } from "react";
import { useListOrders, useEditOrder, getListOrdersQueryKey, getGetOrderStatsQueryKey, OrderLinha } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, Search, CheckCircle2, Loader2, Smartphone, Calendar, Wrench, AlertTriangle, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, addDays, addMonths, addYears, isBefore, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";

const GARANTIA_OPTIONS = ["Sem garantia", "7 dias", "30 dias", "90 dias", "6 meses", "1 ano"];

function parseGarantiaDias(garantia: string): number | null {
  if (!garantia || garantia === "Sem garantia") return null;
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
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  const [garantiaSelecionada, setGarantiaSelecionada] = useState("");
  const [consultaBusca, setConsultaBusca] = useState("");

  // Para registrar: busca uma OS específica
  const { data: ordersRegistrar = [], isLoading: loadingRegistrar } = useListOrders(
    { search: buscaAtiva },
    { query: { enabled: !!buscaAtiva && tab === "registrar" } }
  );

  // Para consultar: busca todas as OS que têm garantia
  const { data: todasOrders = [], isLoading: loadingConsultar } = useListOrders(
    {},
    { query: { enabled: open && tab === "consultar" } }
  );

  const orderRegistrar = buscaAtiva
    ? ordersRegistrar.find(o => o.codigo.toLowerCase() === buscaAtiva.toLowerCase())
      ?? (ordersRegistrar.length === 1 ? ordersRegistrar[0] : null)
    : null;

  // Filtra só ordens com garantia real, ordenadas por validade
  const ordersComGarantia = useMemo(() => {
    return todasOrders
      .filter(o => o.garantia && o.garantia !== "Sem garantia")
      .filter(o => !consultaBusca || o.modelo.toLowerCase().includes(consultaBusca.toLowerCase()) || o.codigo.toLowerCase().includes(consultaBusca.toLowerCase()) || (o.nomeCliente ?? "").toLowerCase().includes(consultaBusca.toLowerCase()))
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

  const handleBuscar = () => {
    const termo = busca.trim();
    if (!termo) return;
    const codigo = termo.startsWith("OS-") ? termo : `OS-${termo}`;
    setBuscaAtiva(codigo);
    setGarantiaSelecionada("");
  };

  const handleSalvar = () => {
    if (!orderRegistrar || !garantiaSelecionada) return;
    editOrder.mutate(
      {
        id: orderRegistrar.id,
        data: {
          modelo: orderRegistrar.modelo,
          linha: orderRegistrar.linha as OrderLinha,
          servico: orderRegistrar.servico,
          valor: orderRegistrar.valor,
          tempo: orderRegistrar.tempo,
          nomeCliente: orderRegistrar.nomeCliente ?? undefined,
          senhaDispo: orderRegistrar.senhaDispo ?? undefined,
          garantia: garantiaSelecionada,
          dataServico: orderRegistrar.dataServico ?? undefined,
        }
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetOrderStatsQueryKey() });
          toast({ title: "Garantia registrada!", description: `${orderRegistrar.codigo} — ${garantiaSelecionada}` });
          setBusca("");
          setBuscaAtiva("");
          setGarantiaSelecionada("");
        },
        onError: () => toast({ title: "Erro ao salvar garantia", variant: "destructive" }),
      }
    );
  };

  const handleClose = () => {
    setBusca("");
    setBuscaAtiva("");
    setGarantiaSelecionada("");
    setConsultaBusca("");
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
                    <Button className="w-full" onClick={handleSalvar} disabled={!garantiaSelecionada || editOrder.isPending}>
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
                  {ordersComGarantia.length === 0 ? (
                    <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
                      Nenhuma OS com garantia registrada ainda.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {ordersComGarantia.map((o) => {
                        const expiry = getExpiry(o);
                        const expirado = expiry ? isBefore(expiry, hoje) : false;
                        const diasRestantes = expiry ? differenceInDays(expiry, hoje) : null;

                        return (
                          <div key={o.id} className={`rounded-lg border p-3 space-y-1 ${expirado ? "bg-red-50/50 border-red-100" : "bg-green-50/30 border-green-100"}`}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-semibold text-sm truncate">{o.modelo}</p>
                                {o.nomeCliente && <p className="text-xs text-muted-foreground truncate">{o.nomeCliente}</p>}
                                <p className="font-mono text-[10px] text-muted-foreground">#{o.codigo}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${expirado ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                                  {o.garantia}
                                </span>
                                {expiry && (
                                  <p className={`text-[10px] mt-1 font-medium ${expirado ? "text-red-500" : "text-green-600"}`}>
                                    {expirado
                                      ? `Expirou ${format(expiry, "dd/MM/yy")}`
                                      : diasRestantes === 0
                                        ? "Expira hoje"
                                        : `${diasRestantes}d restantes`
                                    }
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1 border-t border-inherit">
                              {expirado
                                ? <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                                : <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                              }
                              <span>{o.servico}</span>
                              {expiry && (
                                <span className="ml-auto">Vence: {format(expiry, "dd/MM/yy")}</span>
                              )}
                            </div>
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
