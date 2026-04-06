import { useRef, useState } from "react";
import {
  Order, OrderLinha, OrderStatus,
  useUpdateOrderStatus, useDeleteOrder, useReactivateOrder, useEditOrder,
  getListOrdersQueryKey, getGetOrderStatsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Share2, Play, AlertTriangle, CheckCircle2, Loader2, Trash2,
  RefreshCw, Pencil, X, Save, Eye, EyeOff, XCircle, User, Shield, Calendar, KeyRound, Copy, Check
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ShareCard } from "@/components/share-card";
import { ShareCardCliente } from "@/components/share-card-cliente";
import { shareOrderAsImage } from "@/lib/share";
import { SERVICES_BY_LINE, SERVICES_BY_LINE_CLIENTE, ESTIMATED_TIMES } from "@/lib/constants";

const GARANTIA_OPTIONS = ["Sem garantia", "7 dias", "30 dias", "90 dias", "6 meses", "1 ano"];

const STATUS_COLORS: Record<string, string> = {
  "aguardando": "bg-amber-100 text-amber-800 border-amber-200",
  "em andamento": "bg-blue-100 text-blue-800 border-blue-200",
  "concluido": "bg-green-100 text-green-800 border-green-200",
  "problema": "bg-red-100 text-red-800 border-red-200",
  "encerrado": "bg-gray-100 text-gray-500 border-gray-200",
};

const STATUS_LABELS: Record<string, string> = {
  "aguardando": "Aguardando",
  "em andamento": "Em andamento",
  "concluido": "Concluído",
  "problema": "Problema",
  "encerrado": "Encerrado",
};

export function OrderCard({ order }: { order: Order }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateStatus = useUpdateOrderStatus();
  const deleteOrder = useDeleteOrder();
  const reactivate = useReactivateOrder();
  const editOrder = useEditOrder();
  const shareCardRef = useRef<HTMLDivElement>(null);

  const [isSharing, setIsSharing] = useState(false);
  const [copiedOS, setCopiedOS] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmEncerrar, setConfirmEncerrar] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showSenha, setShowSenha] = useState(false);

  const [editModelo, setEditModelo] = useState(order.modelo);
  const [editLinha, setEditLinha] = useState<OrderLinha>(order.linha as OrderLinha);
  const [editServico, setEditServico] = useState(order.servico);
  const [editValor, setEditValor] = useState(order.valor);
  const [editTempo, setEditTempo] = useState(order.tempo);
  const [editNomeCliente, setEditNomeCliente] = useState(order.nomeCliente ?? "");
  const [editSenhaDispo, setEditSenhaDispo] = useState(order.senhaDispo ?? "");
  const [editGarantia, setEditGarantia] = useState(order.garantia ?? "");

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const statusUrl = `${window.location.origin}${base}/status/${order.codigo}`;
  const isEncerrado = order.status === "encerrado";

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetOrderStatsQueryKey() });
  };

  const openEdit = () => {
    setEditModelo(order.modelo);
    setEditLinha(order.linha as OrderLinha);
    setEditServico(order.servico);
    setEditValor(order.valor);
    setEditTempo(order.tempo);
    setEditNomeCliente(order.nomeCliente ?? "");
    setEditSenhaDispo(order.senhaDispo ?? "");
    setEditGarantia(order.garantia ?? "");
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (!editModelo.trim() || !editServico || !editValor.trim() || !editTempo) {
      toast({ title: "Preencha todos os campos obrigatórios", variant: "destructive" });
      return;
    }
    editOrder.mutate(
      {
        id: order.id,
        data: {
          modelo: editModelo.trim(),
          linha: editLinha,
          servico: editServico,
          valor: editValor.trim(),
          tempo: editTempo,
          nomeCliente: editNomeCliente || undefined,
          senhaDispo: editSenhaDispo || undefined,
          garantia: editGarantia || undefined,
          dataServico: order.dataServico ?? undefined,
        }
      },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Ordem atualizada!" });
          setIsEditing(false);
        },
        onError: () => toast({ title: "Erro ao salvar", variant: "destructive" }),
      }
    );
  };

  const handleStatusChange = (status: OrderStatus) => {
    updateStatus.mutate(
      { id: order.id, data: { status } },
      {
        onSuccess: () => invalidate(),
        onError: () => toast({ title: "Erro ao atualizar status", variant: "destructive" }),
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
          invalidate();
          toast({ title: `Ordem ${order.codigo} excluída` });
        },
        onError: () => toast({ title: "Erro ao excluir ordem", variant: "destructive" }),
      }
    );
  };

  const handleEncerrar = () => {
    if (!confirmEncerrar) {
      setConfirmEncerrar(true);
      setTimeout(() => setConfirmEncerrar(false), 3500);
      return;
    }
    handleStatusChange(OrderStatus.encerrado);
    setConfirmEncerrar(false);
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

  const serviceMap = order.tipo === "cliente" ? SERVICES_BY_LINE_CLIENTE : SERVICES_BY_LINE;
  const availableServices = serviceMap[editLinha] ?? [];

  return (
    <>
      <div style={{ position: "fixed", top: "-9999px", left: "-9999px", zIndex: -1, pointerEvents: "none" }}>
        {order.tipo === "cliente"
          ? <ShareCardCliente ref={shareCardRef} order={order} />
          : <ShareCard ref={shareCardRef} order={order} />
        }
      </div>

      <Card className={`overflow-hidden transition-all hover:shadow-md border-l-4 hover:border-l-primary ${isEncerrado ? "opacity-60" : ""}`}>
        <CardContent className="p-0">

          {/* ── EDIT MODE ─────────────────────────────────────────────── */}
          {isEditing ? (
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm">Editar Ordem #{order.codigo}</span>
                <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {order.tipo === "cliente" && (
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">Nome do Cliente</Label>
                    <Input value={editNomeCliente} onChange={(e) => setEditNomeCliente(e.target.value)} placeholder="Ex: João Silva" />
                  </div>
                )}

                <div className="space-y-1">
                  <Label className="text-xs">Modelo</Label>
                  <Input value={editModelo} onChange={(e) => setEditModelo(e.target.value)} placeholder="Ex: Moto e13" />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Linha</Label>
                  <Select value={editLinha} onValueChange={(v) => { setEditLinha(v as OrderLinha); setEditServico(""); setEditTempo(""); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.values(OrderLinha).map((l) => (
                        <SelectItem key={l} value={l} className="uppercase">{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Serviço</Label>
                  <Select value={editServico} onValueChange={(v) => { setEditServico(v); setEditTempo(ESTIMATED_TIMES[v] ?? ""); }}>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {availableServices.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Valor (R$)</Label>
                  <Input value={editValor} onChange={(e) => setEditValor(e.target.value)} placeholder="Ex: 50" />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Tempo estimado</Label>
                  <Input value={editTempo} onChange={(e) => setEditTempo(e.target.value)} placeholder="Ex: 30 min a 2h" />
                </div>


                <div className="space-y-1">
                  <Label className="text-xs">Garantia</Label>
                  <Select value={editGarantia} onValueChange={setEditGarantia}>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {GARANTIA_OPTIONS.map((g) => (
                        <SelectItem key={g} value={g}>{g}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Senha do Aparelho</Label>
                  <Input value={editSenhaDispo} onChange={(e) => setEditSenhaDispo(e.target.value)} placeholder="PIN ou padrão" />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={handleSaveEdit} disabled={editOrder.isPending} className="flex-1">
                  {editOrder.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Salvar
                </Button>
                <Button size="sm" variant="outline" onClick={() => setIsEditing(false)} className="flex-1">
                  Cancelar
                </Button>
              </div>
            </div>

          ) : (
          /* ── VIEW MODE ──────────────────────────────────────────────── */
            <div className="flex flex-col md:flex-row">
              <div className="flex-1 p-5">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(order.codigo);
                          setCopiedOS(true);
                          setTimeout(() => setCopiedOS(false), 1800);
                        }}
                        className="flex items-center gap-1.5 font-mono text-sm font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded hover:bg-muted/80 active:scale-95 transition-all group"
                        title="Copiar código da OS"
                      >
                        #{order.codigo}
                        {copiedOS
                          ? <Check className="w-3 h-3 text-green-600 shrink-0" />
                          : <Copy className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
                        }
                      </button>
                      <Badge variant="outline" className="uppercase text-[10px] tracking-wider">
                        {order.linha}
                      </Badge>
                    </div>
                    <h3 className="text-lg font-bold text-foreground">{order.modelo}</h3>
                    {order.nomeCliente && order.tipo === "cliente" && (
                      <div className="flex items-center gap-1 mt-0.5 text-sm text-muted-foreground">
                        <User className="w-3.5 h-3.5" />
                        <span>{order.nomeCliente}</span>
                      </div>
                    )}
                  </div>
                  <Badge variant="outline" className={`capitalize px-2.5 py-1 text-xs font-semibold ${STATUS_COLORS[order.status]}`}>
                    {STATUS_LABELS[order.status] ?? order.status}
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

                  {order.dataServico && (
                    <div>
                      <p className="text-muted-foreground mb-0.5 text-xs font-medium uppercase tracking-wider flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> Data
                      </p>
                      <p className="font-medium text-foreground">
                        {(() => {
                          const [y, m, d] = order.dataServico!.split("-");
                          return `${d}/${m}/${y}`;
                        })()}
                      </p>
                    </div>
                  )}

                  {order.garantia && (
                    <div>
                      <p className="text-muted-foreground mb-0.5 text-xs font-medium uppercase tracking-wider flex items-center gap-1">
                        <Shield className="w-3 h-3" /> Garantia
                      </p>
                      <p className="font-medium text-foreground">{order.garantia}</p>
                    </div>
                  )}

                  {order.senhaDispo && (
                    <div>
                      <p className="text-muted-foreground mb-0.5 text-xs font-medium uppercase tracking-wider flex items-center gap-1">
                        <KeyRound className="w-3 h-3" /> Senha
                      </p>
                      <div className="flex items-center gap-1">
                        <p className={`font-medium text-foreground transition-all ${showSenha ? "" : "blur-sm select-none"}`}>
                          {order.senhaDispo}
                        </p>
                        <button
                          onClick={() => setShowSenha((s) => !s)}
                          className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
                          title={showSenha ? "Ocultar senha" : "Mostrar senha"}
                        >
                          {showSenha ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-muted/50 border-t md:border-t-0 md:border-l p-4 grid grid-cols-2 md:grid-cols-1 gap-2 md:min-w-[150px] content-start">

                {!isEncerrado && order.status === "aguardando" && (
                  <Button size="sm" onClick={() => handleStatusChange(OrderStatus.em_andamento)} className="w-full justify-start" variant="secondary">
                    <Play className="w-4 h-4 mr-2 text-blue-500" />
                    Iniciar
                  </Button>
                )}

                {!isEncerrado && order.status === "em andamento" && (
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

                {!isEncerrado && order.status === "problema" && (
                  <Button size="sm" onClick={() => handleStatusChange(OrderStatus.em_andamento)} className="w-full justify-start" variant="secondary">
                    <Play className="w-4 h-4 mr-2 text-blue-500" />
                    Retomar
                  </Button>
                )}

                {order.status === "concluido" && (
                  <Button
                    size="sm"
                    onClick={() => reactivate.mutate(
                      { id: order.id },
                      {
                        onSuccess: (updated) => {
                          invalidate();
                          const novoLink = `${window.location.origin}${base}/status/${updated.codigo}`;
                          navigator.clipboard.writeText(novoLink).catch(() => {});
                          toast({ title: `Nova OS: ${updated.codigo}`, description: "Novo link copiado!" });
                        },
                        onError: () => toast({ title: "Erro ao reativar ordem", variant: "destructive" }),
                      }
                    )}
                    disabled={reactivate.isPending}
                    className="w-full justify-start bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800 border border-green-200"
                    variant="outline"
                  >
                    {reactivate.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                    Reativar
                  </Button>
                )}

                {isEncerrado && (
                  <Button
                    size="sm"
                    onClick={() => handleStatusChange(OrderStatus.aguardando)}
                    className="w-full justify-start bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200"
                    variant="outline"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Reabrir
                  </Button>
                )}

                {!isEncerrado && (
                  <>
                    <Button size="sm" variant="outline" onClick={openEdit} className="w-full justify-start border-dashed">
                      <Pencil className="w-4 h-4 mr-2" />
                      Editar
                    </Button>

                    <Button size="sm" variant="outline" onClick={handleShare} disabled={isSharing} className="w-full justify-start border-dashed">
                      {isSharing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Share2 className="w-4 h-4 mr-2" />}
                      WhatsApp
                    </Button>

                    <Button
                      size="sm"
                      variant={confirmEncerrar ? "destructive" : "outline"}
                      onClick={handleEncerrar}
                      disabled={updateStatus.isPending}
                      className={`w-full justify-start ${confirmEncerrar ? "" : "border-orange-300 text-orange-700 hover:bg-orange-50"}`}
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      {confirmEncerrar ? "Confirmar?" : "Encerrar OS"}
                    </Button>
                  </>
                )}

                <Button
                  size="sm"
                  variant={confirmDelete ? "destructive" : "ghost"}
                  onClick={handleDelete}
                  disabled={deleteOrder.isPending}
                  className="w-full justify-start"
                >
                  {deleteOrder.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                  {confirmDelete ? "Confirmar?" : "Excluir"}
                </Button>

                <p className="text-[10px] text-muted-foreground w-full text-center col-span-2 md:col-span-1 md:pt-2">
                  {format(new Date(order.createdAt), "dd/MM/yy HH:mm", { locale: ptBR })}
                </p>
              </div>
            </div>
          )}

        </CardContent>
      </Card>
    </>
  );
}
