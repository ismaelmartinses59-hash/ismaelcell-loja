import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetOrderStats, useListOrders, getListOrdersQueryKey, getGetOrderStatsQueryKey,
  type Order, type OrderLinha
} from "@workspace/api-client-react";
import { OrderForm } from "@/components/order-form";
import { OrderCard } from "@/components/order-card";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, LogOut, Wrench, Activity, CheckCircle2, AlertTriangle, Clock, Plus, X } from "lucide-react";
import { ListOrdersStatus } from "@workspace/api-client-react";

interface Prefill {
  modelo: string;
  linha: OrderLinha;
}

export default function Orders() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [prefill, setPrefill] = useState<Prefill | null>(null);

  useEffect(() => {
    if (localStorage.getItem("isLoggedIn") !== "true") {
      setLocation("/");
    }
  }, [setLocation]);

  const { data: stats } = useGetOrderStats({
    query: { queryKey: getGetOrderStatsQueryKey() }
  });

  // All orders (unfiltered) used to compute active models for duplicate check
  const { data: allOrders = [] } = useListOrders(
    {},
    { query: { queryKey: getListOrdersQueryKey({}) } }
  );

  const { data: orders = [], isLoading } = useListOrders(
    {
      search: search || undefined,
      status: statusFilter !== "all" ? (statusFilter as ListOrdersStatus) : undefined
    },
    {
      query: {
        queryKey: getListOrdersQueryKey({
          search: search || undefined,
          status: statusFilter !== "all" ? (statusFilter as ListOrdersStatus) : undefined
        })
      }
    }
  );

  // Models that currently have active (non-concluded) orders — used to block duplicates
  const activeModels = allOrders
    .filter((o) => o.status !== "concluido")
    .map((o) => o.modelo);

  const handleLogout = () => {
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("userEmail");
    setLocation("/");
  };

  const handleRefazer = (order: Order) => {
    setPrefill({ modelo: order.modelo, linha: order.linha as OrderLinha });
    setShowForm(true);
    // Scroll to top smoothly on mobile
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleFormSuccess = () => {
    setShowForm(false);
    setPrefill(null);
  };

  const formProps = { prefill, activeModels, onSuccess: handleFormSuccess };

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-20 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center">
              <Wrench className="h-4 w-4 text-primary-foreground" />
            </div>
            <h1 className="font-bold text-lg tracking-tight">Ismael Cell</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="md:hidden flex items-center gap-1"
              onClick={() => {
                if (showForm) {
                  setShowForm(false);
                  setPrefill(null);
                } else {
                  setShowForm(true);
                }
              }}
            >
              {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {showForm ? "Fechar" : "Nova Ordem"}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-foreground">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline ml-2">Sair</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 mt-4 space-y-4">

        {/* Stats Row */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <Card>
              <CardContent className="p-3 flex flex-col items-center justify-center text-center">
                <span className="text-2xl font-bold">{stats.total}</span>
                <span className="text-xs font-medium text-muted-foreground uppercase mt-1">Total</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 flex flex-col items-center justify-center text-center">
                <Clock className="h-4 w-4 text-amber-500 mb-1" />
                <span className="text-xl font-bold">{stats.aguardando}</span>
                <span className="text-xs font-medium text-muted-foreground uppercase">Aguardando</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 flex flex-col items-center justify-center text-center">
                <Activity className="h-4 w-4 text-blue-500 mb-1" />
                <span className="text-xl font-bold">{stats.emAndamento}</span>
                <span className="text-xs font-medium text-muted-foreground uppercase">Andamento</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 flex flex-col items-center justify-center text-center">
                <CheckCircle2 className="h-4 w-4 text-green-500 mb-1" />
                <span className="text-xl font-bold">{stats.concluido}</span>
                <span className="text-xs font-medium text-muted-foreground uppercase">Concluídos</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 flex flex-col items-center justify-center text-center">
                <AlertTriangle className="h-4 w-4 text-red-500 mb-1" />
                <span className="text-xl font-bold">{stats.problema}</span>
                <span className="text-xs font-medium text-muted-foreground uppercase">Problema</span>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Mobile: collapsible form */}
        {showForm && (
          <div className="md:hidden">
            <Card className="shadow-md border-primary/30 border-2">
              <CardContent className="p-4">
                <h2 className="font-semibold text-base mb-4">
                  {prefill ? `Refazer Ordem — ${prefill.modelo}` : "Nova Ordem de Serviço"}
                </h2>
                <OrderForm {...formProps} />
              </CardContent>
            </Card>
          </div>
        )}

        {/* Desktop: side-by-side layout */}
        <div className="hidden md:grid md:grid-cols-[340px_1fr] gap-6 items-start">
          <div className="sticky top-20">
            <Card className="shadow-md">
              <CardContent className="p-5">
                <h2 className="font-semibold text-base mb-4">
                  {prefill ? `Refazer Ordem — ${prefill.modelo}` : "Nova Ordem de Serviço"}
                </h2>
                <OrderForm {...formProps} />
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <OrderFilters search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />
            <OrdersList orders={orders} isLoading={isLoading} onRefazer={handleRefazer} />
          </div>
        </div>

        {/* Mobile: orders list */}
        <div className="md:hidden space-y-4">
          <OrderFilters search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />
          <OrdersList orders={orders} isLoading={isLoading} onRefazer={handleRefazer} />
        </div>

      </main>
    </div>
  );
}

function OrderFilters({
  search, setSearch, statusFilter, setStatusFilter
}: {
  search: string;
  setSearch: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
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
        <SelectTrigger className="w-full sm:w-[180px]">
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
  );
}

function OrdersList({
  orders, isLoading, onRefazer
}: {
  orders: Order[];
  isLoading: boolean;
  onRefazer: (order: Order) => void;
}) {
  if (isLoading) {
    return <div className="text-center py-12 text-muted-foreground">Carregando ordens...</div>;
  }
  if (orders.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-10 text-center text-muted-foreground">
          Nenhuma ordem encontrada.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {orders.map((order) => (
        <OrderCard key={order.id} order={order} onRefazer={onRefazer} />
      ))}
    </div>
  );
}
