import { useState } from "react";
import { useListOrders, useEditOrder, getListOrdersQueryKey, getGetOrderStatsQueryKey, OrderLinha } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, Search, CheckCircle2, Loader2, Smartphone, Calendar, Wrench } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const GARANTIA_OPTIONS = ["Sem garantia", "7 dias", "30 dias", "90 dias", "6 meses", "1 ano"];

interface GarantiaModalProps {
  open: boolean;
  onClose: () => void;
}

export function GarantiaModal({ open, onClose }: GarantiaModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const editOrder = useEditOrder();

  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  const [garantiaSelecionada, setGarantiaSelecionada] = useState("");

  const { data: orders = [], isLoading } = useListOrders(
    { search: buscaAtiva },
    { query: { enabled: !!buscaAtiva } }
  );

  const order = buscaAtiva
    ? orders.find(o => o.codigo.toLowerCase() === buscaAtiva.toLowerCase()) ?? (orders.length === 1 ? orders[0] : null)
    : null;

  const handleBuscar = () => {
    const termo = busca.trim();
    if (!termo) return;
    const codigo = termo.startsWith("OS-") ? termo : `OS-${termo}`;
    setBuscaAtiva(codigo);
    setBusca(termo);
    setGarantiaSelecionada("");
  };

  const handleSalvar = () => {
    if (!order || !garantiaSelecionada) return;
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
          garantia: garantiaSelecionada,
          dataServico: order.dataServico ?? undefined,
        }
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetOrderStatsQueryKey() });
          toast({ title: "Garantia registrada!", description: `${order.codigo} — ${garantiaSelecionada}` });
          setBusca("");
          setBuscaAtiva("");
          setGarantiaSelecionada("");
          onClose();
        },
        onError: () => toast({ title: "Erro ao salvar garantia", variant: "destructive" }),
      }
    );
  };

  const handleClose = () => {
    setBusca("");
    setBuscaAtiva("");
    setGarantiaSelecionada("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Shield className="w-5 h-5 text-yellow-600" />
            Registrar Garantia
          </DialogTitle>
        </DialogHeader>

        {/* Busca por número da OS */}
        <div className="space-y-3">
          <div>
            <p className="text-sm text-muted-foreground mb-2">Digite o número da OS</p>
            <div className="flex gap-2">
              <Input
                placeholder="Ex: 1234567890 ou OS-1234..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleBuscar()}
                className="flex-1"
              />
              <Button size="sm" onClick={handleBuscar} disabled={!busca.trim()}>
                <Search className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Resultado */}
          {isLoading && buscaAtiva && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-3 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Buscando...
            </div>
          )}

          {buscaAtiva && !isLoading && !order && (
            <div className="text-center py-4 text-sm text-muted-foreground">
              Nenhuma OS encontrada para <strong>{buscaAtiva}</strong>
            </div>
          )}

          {order && (
            <div className="rounded-xl border bg-muted/40 p-4 space-y-3">
              {/* Info da OS */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">#{order.codigo}</span>
                  {order.garantia && order.garantia !== "Sem garantia" && (
                    <span className="text-xs bg-yellow-100 text-yellow-700 border border-yellow-200 px-2 py-0.5 rounded-full font-medium">
                      {order.garantia}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Smartphone className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="font-semibold">{order.modelo}</span>
                  <span className="text-muted-foreground capitalize text-xs">({order.linha})</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Wrench className="w-3.5 h-3.5 shrink-0" />
                  <span>{order.servico}</span>
                </div>
                {order.dataServico && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {(() => {
                        const [y, m, d] = order.dataServico!.split("-");
                        return `${d}/${m}/${y}`;
                      })()}
                    </span>
                  </div>
                )}
                {!order.dataServico && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="w-3.5 h-3.5 shrink-0" />
                    <span>{format(new Date(order.createdAt), "dd/MM/yyyy", { locale: ptBR })}</span>
                  </div>
                )}
              </div>

              {/* Seletor de garantia */}
              <div className="space-y-2 pt-2 border-t">
                <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Período de Garantia</p>
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

                <Button
                  className="w-full"
                  onClick={handleSalvar}
                  disabled={!garantiaSelecionada || editOrder.isPending}
                >
                  {editOrder.isPending
                    ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    : <CheckCircle2 className="w-4 h-4 mr-2" />
                  }
                  Registrar Garantia
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
