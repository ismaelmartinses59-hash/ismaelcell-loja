import { useRef, useState } from "react";
import {
  Order, OrderStatus,
  useUpdateOrderStatus, useDeleteOrder, useReactivateOrder,
  getListOrdersQueryKey, getGetOrderStatsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Share2, Play, AlertTriangle, CheckCircle2, Loader2, Trash2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ShareCard } from "@/components/share-card";
import { shareOrderAsImage } from "@/lib/share";

const STATUS_COLORS: Record<string, string> = {
  "aguardando": "bg-amber-100 text-amber-800 border-amber-200",
  "em andamento": "bg-blue-100 text-blue-800 border-blue-200",
  "concluido": "bg-green-100 text-green-800 border-green-200",
  "problema": "bg-red-100 text-red-800 border-red-200",
};

export function OrderCard({ order }: { order: Order }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateStatus = useUpdateOrderStatus();
  const deleteOrder = useDeleteOrder();
  const reactivate = useReactivateOrder();
  const shareCardRef = useRef<HTMLDivElement>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const statusUrl = `${window.location.origin}${base}/status/${order.codigo}`;

  const handleStatusChange = (status: OrderStatus) => {
    updateStatus.mutate(
      { id: order.id, data: { status } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetOrderStatsQueryKey() });
          toast({ title: `Status atualizado para "${status}"` });
        },
        onError: () => {
          toast({ title: "Erro ao atualizar status", variant: "destructive" });
        },
      }
    );
  };

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    deleteOrder.mutate(
      { id: order.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetOrderStatsQueryKey() });
          toast({ title: `Ordem ${order.codigo} excluída` });
        },
        onError: () => {
          toast({ title: "Erro ao excluir ordem", variant: "destructive" });
        },
      }
    );
  };

  const handleShare = async () => {
    if (!shareCardRef.current) return;
    setIsSharing(true);
    try {
      await shareOrderAsImage(order, shareCardRef.current, statusUrl);
    } catch {
      toast({ title: "Erro ao gerar imagem", variant: "destructive" });
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <>
      <div style={{ position: "fixed", top: "-9999px", left: "-9999px", zIndex: -1, pointerEvents: "none" }}>
        <ShareCard ref={shareCardRef} order={order} />
      </div>

      <Card className="overflow-hidden transition-all hover:shadow-md border-l-4 hover:border-l-primary">
        <CardContent className="p-0">
          <div className="flex flex-col md:flex-row">
            <div className="flex-1 p-5">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-sm font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded">
                      #{order.codigo}
                    </span>
                    <Badge variant="outline" className="uppercase text-[10px] tracking-wider">
                      {order.linha}
                    </Badge>
                  </div>
                  <h3 className="text-lg font-bold text-foreground">{order.modelo}</h3>
                </div>
                <Badge variant="outline" className={`capitalize px-2.5 py-1 text-xs font-semibold ${STATUS_COLORS[order.status]}`}>
                  {order.status}
                </Badge>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4 text-sm">
                <div>
                  <p className="text-muted-foreground mb-0.5 text-xs font-medium uppercase tracking-wider">Serviço</p>
                  <p className="font-medium text-foreground">{order.servico}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-0.5 text-xs font-medium uppercase tracking-wider">Valor</p>
                  <p className="font-medium text-foreground">R$ {order.valor}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-0.5 text-xs font-medium uppercase tracking-wider">Tempo Est.</p>
                  <p className="font-medium text-foreground">{order.tempo}</p>
                </div>
              </div>
            </div>

            <div className="bg-muted/50 border-t md:border-t-0 md:border-l p-4 flex flex-row md:flex-col items-center justify-center gap-2 min-w-[150px]">

              {order.status === "aguardando" && (
                <Button size="sm" onClick={() => handleStatusChange(OrderStatus.em_andamento)} className="w-full justify-start" variant="secondary">
                  <Play className="w-4 h-4 mr-2 text-blue-500" />
                  Iniciar
                </Button>
              )}

              {order.status === "em andamento" && (
                <>
                  <Button size="sm" onClick={() => handleStatusChange(OrderStatus.concluido)} className="w-full justify-start hover:bg-green-100 hover:text-green-800" variant="secondary">
                    <CheckCircle2 className="w-4 h-4 mr-2 text-green-600" />
                    Concluir
                  </Button>
                  <Button size="sm" onClick={() => handleStatusChange(OrderStatus.problema)} className="w-full justify-start hover:bg-red-100 hover:text-red-800" variant="secondary">
                    <AlertTriangle className="w-4 h-4 mr-2 text-red-600" />
                    Problema
                  </Button>
                </>
              )}

              {order.status === "problema" && (
                <Button size="sm" onClick={() => handleStatusChange(OrderStatus.em_andamento)} className="w-full justify-start" variant="secondary">
                  <Play className="w-4 h-4 mr-2 text-blue-500" />
                  Retomar
                </Button>
              )}

              {/* On concluded orders: reset to aguardando with a brand-new OS code */}
              {order.status === "concluido" && (
                <Button
                  size="sm"
                  onClick={() => reactivate.mutate(
                    { id: order.id },
                    {
                      onSuccess: (updated) => {
                        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
                        queryClient.invalidateQueries({ queryKey: getGetOrderStatsQueryKey() });
                        const novoLink = `${window.location.origin}${base}/status/${updated.codigo}`;
                        navigator.clipboard.writeText(novoLink).catch(() => {});
                        toast({
                          title: `Nova OS: ${updated.codigo}`,
                          description: "Status resetado. Novo link copiado!",
                        });
                      },
                      onError: () => toast({ title: "Erro ao reativar ordem", variant: "destructive" }),
                    }
                  )}
                  disabled={reactivate.isPending}
                  className="w-full justify-start bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800 border border-green-200"
                  variant="outline"
                >
                  {reactivate.isPending
                    ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    : <RefreshCw className="w-4 h-4 mr-2" />}
                  Reativar
                </Button>
              )}

              <Button
                size="sm"
                variant="outline"
                onClick={handleShare}
                disabled={isSharing}
                className="w-full justify-start border-dashed"
              >
                {isSharing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Share2 className="w-4 h-4 mr-2" />}
                WhatsApp
              </Button>

              <Button
                size="sm"
                variant={confirmDelete ? "destructive" : "ghost"}
                onClick={handleDelete}
                disabled={deleteOrder.isPending}
                className="w-full justify-start"
              >
                {deleteOrder.isPending
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : <Trash2 className="w-4 h-4 mr-2" />}
                {confirmDelete ? "Confirmar?" : "Excluir"}
              </Button>

              <p className="text-[10px] text-muted-foreground w-full text-center mt-auto md:pt-2">
                {format(new Date(order.createdAt), "dd/MM/yy HH:mm", { locale: ptBR })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
