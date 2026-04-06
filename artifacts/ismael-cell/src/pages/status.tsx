import { useParams } from "wouter";
import { useListOrders, getListOrdersQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { type LucideIcon, Wrench, CheckCircle2, Clock, Activity, AlertTriangle, Smartphone, XCircle } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  "aguardando": "bg-amber-100 text-amber-800 border-amber-200",
  "em andamento": "bg-blue-100 text-blue-800 border-blue-200",
  "concluido": "bg-green-100 text-green-800 border-green-200",
  "problema": "bg-red-100 text-red-800 border-red-200",
  "encerrado": "bg-gray-100 text-gray-500 border-gray-200",
};

const STATUS_ICONS: Record<string, LucideIcon> = {
  "aguardando": Clock,
  "em andamento": Activity,
  "concluido": CheckCircle2,
  "problema": AlertTriangle,
  "encerrado": XCircle,
};

const STATUS_LABELS: Record<string, string> = {
  "aguardando": "Aguardando",
  "em andamento": "Em andamento",
  "concluido": "Concluído",
  "problema": "Problema",
  "encerrado": "Encerrado",
};

export default function Status() {
  const params = useParams();
  const codigo = params.codigo;

  const { data: orders, isLoading } = useListOrders(
    { search: codigo },
    { 
      query: { 
        enabled: !!codigo,
        queryKey: getListOrdersQueryKey({ search: codigo })
      } 
    }
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <div className="text-center text-muted-foreground animate-pulse">
          Buscando informações...
        </div>
      </div>
    );
  }

  const order = orders && orders.length > 0 ? orders.find(o => o.codigo === codigo) : null;

  if (!order) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>Ordem não encontrada</CardTitle>
            <CardDescription>O código {codigo} não corresponde a nenhuma ordem de serviço ativa.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const StatusIcon = STATUS_ICONS[order.status] ?? Wrench;

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-t-4 border-t-primary shadow-xl">
        <CardHeader className="text-center pb-6 border-b">
          <div className="mx-auto w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-4">
            <Wrench className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl font-bold">Status do Reparo</CardTitle>
          <CardDescription>Ismael Cell - Assistência Técnica</CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-8">
          
          <div className="text-center space-y-4">
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-widest">
              Status Atual
            </p>
            <div className={`mx-auto w-24 h-24 rounded-full flex items-center justify-center ${STATUS_COLORS[order.status]}`}>
              <StatusIcon className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-black capitalize tracking-tight">{STATUS_LABELS[order.status] ?? order.status}</h2>
          </div>

          <div className="bg-muted rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <Smartphone className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase">Aparelho</p>
                <p className="font-bold">{order.modelo}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase">Serviço</p>
                <p className="font-semibold">{order.servico}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase">Tempo Estimado</p>
                <p className="font-semibold">{order.tempo}</p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase">Código</p>
                <p className="font-mono font-bold text-primary">#{order.codigo}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase">Data</p>
                <p className="font-medium text-sm">
                  {format(new Date(order.createdAt), "dd/MM/yyyy", { locale: ptBR })}
                </p>
              </div>
            </div>
          </div>

        </CardContent>
      </Card>
    </div>
  );
}
