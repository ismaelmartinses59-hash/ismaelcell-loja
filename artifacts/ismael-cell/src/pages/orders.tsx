import { useEffect } from "react";
import { useLocation } from "wouter";
import { useGetOrderStats, useListOrders, getListOrdersQueryKey, getGetOrderStatsQueryKey } from "@workspace/api-client-react";
import { OrderForm } from "@/components/order-form";
import { OrderCard } from "@/components/order-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, LogOut, Wrench, Activity, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { ListOrdersStatus } from "@workspace/api-client-react";
import { useState } from "react";

export default function Orders() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    if (localStorage.getItem("isLoggedIn") !== "true") {
      setLocation("/");
    }
  }, [setLocation]);

  const { data: stats } = useGetOrderStats({
    query: { queryKey: getGetOrderStatsQueryKey() }
  });

  const { data: orders = [], isLoading } = useListOrders(
    { 
      search: search || undefined, 
      status: statusFilter !== "all" ? (statusFilter as ListOrdersStatus) : undefined 
    },
    { query: { queryKey: getListOrdersQueryKey({ search: search || undefined, status: statusFilter !== "all" ? (statusFilter as ListOrdersStatus) : undefined }) } }
  );

  const handleLogout = () => {
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("userEmail");
    setLocation("/");
  };

  return (
    <div className="min-h-screen bg-muted/30 pb-12">
      <header className="bg-white border-b sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center">
              <Wrench className="h-4 w-4 text-primary-foreground" />
            </div>
            <h1 className="font-bold text-lg tracking-tight">Ismael Cell</h1>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-foreground">
            <LogOut className="h-4 w-4 mr-2" />
            Sair
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 mt-8 space-y-8">
        {/* Stats Row */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card>
              <CardContent className="p-4 flex flex-col items-center justify-center text-center h-full">
                <span className="text-3xl font-bold">{stats.total}</span>
                <span className="text-xs font-medium text-muted-foreground uppercase mt-1">Total</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex flex-col items-center justify-center text-center h-full">
                <Clock className="h-5 w-5 text-amber-500 mb-2" />
                <span className="text-2xl font-bold">{stats.aguardando}</span>
                <span className="text-xs font-medium text-muted-foreground uppercase mt-1">Aguardando</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex flex-col items-center justify-center text-center h-full">
                <Activity className="h-5 w-5 text-blue-500 mb-2" />
                <span className="text-2xl font-bold">{stats.emAndamento}</span>
                <span className="text-xs font-medium text-muted-foreground uppercase mt-1">Em Andamento</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex flex-col items-center justify-center text-center h-full">
                <CheckCircle2 className="h-5 w-5 text-green-500 mb-2" />
                <span className="text-2xl font-bold">{stats.concluido}</span>
                <span className="text-xs font-medium text-muted-foreground uppercase mt-1">Concluídos</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex flex-col items-center justify-center text-center h-full">
                <AlertTriangle className="h-5 w-5 text-red-500 mb-2" />
                <span className="text-2xl font-bold">{stats.problema}</span>
                <span className="text-xs font-medium text-muted-foreground uppercase mt-1">Com Problema</span>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="grid md:grid-cols-[350px_1fr] gap-8 items-start">
          <div className="sticky top-24">
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle>Nova Ordem de Serviço</CardTitle>
              </CardHeader>
              <CardContent>
                <OrderForm />
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Buscar por código, modelo, serviço..." 
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue placeholder="Filtrar por status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  <SelectItem value={ListOrdersStatus.aguardando}>Aguardando</SelectItem>
                  <SelectItem value={ListOrdersStatus.em_andamento}>Em Andamento</SelectItem>
                  <SelectItem value={ListOrdersStatus.concluido}>Concluído</SelectItem>
                  <SelectItem value={ListOrdersStatus.problema}>Com Problema</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-4">
              {isLoading ? (
                <div className="text-center py-12 text-muted-foreground">Carregando ordens...</div>
              ) : orders.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="p-12 text-center text-muted-foreground">
                    <p>Nenhuma ordem encontrada.</p>
                  </CardContent>
                </Card>
              ) : (
                orders.map((order) => (
                  <OrderCard key={order.id} order={order} />
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
