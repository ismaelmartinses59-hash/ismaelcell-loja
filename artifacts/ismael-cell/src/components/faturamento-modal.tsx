import { useMemo, useState } from "react";
import { useListOrders } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { TrendingUp, Package, Calendar } from "lucide-react";

interface FaturamentoModalProps {
  open: boolean;
  onClose: () => void;
  tipo?: "cliente" | "lojista";
}

function parseMoney(val: string): number {
  if (!val) return 0;
  const cleaned = val.replace(/[^\d,\.]/g, "").replace(",", ".");
  return parseFloat(cleaned) || 0;
}

function formatMoney(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function FaturamentoModal({ open, onClose, tipo }: FaturamentoModalProps) {
  const [filtroTipo, setFiltroTipo] = useState<"todos" | "cliente" | "lojista">(tipo ?? "todos");

  const { data: orders = [], isLoading } = useListOrders(
    { status: "concluido", tipo: filtroTipo === "todos" ? undefined : filtroTipo },
    { query: { enabled: open } }
  );

  const { totalGeral, porMes, porServico } = useMemo(() => {
    let totalGeral = 0;
    const porMes: Record<string, number> = {};
    const porServico: Record<string, { total: number; qtd: number }> = {};

    for (const o of orders) {
      const valor = parseMoney(o.valor);
      totalGeral += valor;

      const mes = format(new Date(o.createdAt), "MMMM yyyy", { locale: ptBR });
      porMes[mes] = (porMes[mes] ?? 0) + valor;

      const srv = o.servico;
      if (!porServico[srv]) porServico[srv] = { total: 0, qtd: 0 };
      porServico[srv].total += valor;
      porServico[srv].qtd += 1;
    }

    const mesesOrdenados = Object.entries(porMes).sort((a, b) => b[1] - a[1]);
    const servicosOrdenados = Object.entries(porServico).sort((a, b) => b[1].total - a[1].total);

    return { totalGeral, porMes: mesesOrdenados, porServico: servicosOrdenados };
  }, [orders]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <TrendingUp className="w-5 h-5 text-green-600" />
            Relatório de Faturamento
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 mb-4">
          {(["todos", "cliente", "lojista"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFiltroTipo(t)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                filtroTipo === t
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground border-transparent hover:border-muted-foreground"
              }`}
            >
              {t === "todos" ? "Todos" : t === "cliente" ? "Cliente" : "Lojista"}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Carregando...</div>
        ) : orders.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Nenhuma OS concluída encontrada.
          </div>
        ) : (
          <div className="space-y-6">
            {/* TOTAL GERAL */}
            <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-center">
              <p className="text-xs text-green-700 uppercase tracking-wider font-medium mb-1">Total Faturado</p>
              <p className="text-3xl font-bold text-green-700">{formatMoney(totalGeral)}</p>
              <p className="text-xs text-green-600 mt-1">{orders.length} ordem{orders.length !== 1 ? "s" : ""} concluída{orders.length !== 1 ? "s" : ""}</p>
            </div>

            {/* POR MÊS */}
            {porMes.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Por Mês</h3>
                </div>
                <div className="space-y-2">
                  {porMes.map(([mes, total]) => (
                    <div key={mes} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                      <span className="text-sm capitalize text-foreground">{mes}</span>
                      <span className="text-sm font-semibold text-green-700">{formatMoney(total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* POR SERVIÇO */}
            {porServico.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Package className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Por Serviço</h3>
                </div>
                <div className="space-y-2">
                  {porServico.map(([srv, { total, qtd }]) => (
                    <div key={srv} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">{srv}</p>
                        <p className="text-xs text-muted-foreground">{qtd} OS</p>
                      </div>
                      <span className="text-sm font-semibold text-green-700">{formatMoney(total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
