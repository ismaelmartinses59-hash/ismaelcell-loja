import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetOrderStats, useListOrders, getListOrdersQueryKey, getGetOrderStatsQueryKey,
  OrderTipo,
  type Order
} from "@workspace/api-client-react";
import { OrderForm } from "@/components/order-form";
import { OrderCard } from "@/components/order-card";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, LogOut, Wrench, Activity, CheckCircle2, AlertTriangle, Clock, Plus, X, Store, User } from "lucide-react";
import { ListOrdersStatus } from "@workspace/api-client-react";

export default function Orders() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [tipo, setTipo] = useState<OrderTipo>(OrderTipo.lojista);

  useEffect(() => {
    if (localStorage.getItem("isLoggedIn") !== "true") {
      setLocation("/");
    }
  }, [setLocation]);

  // Reset search/filter when switching tabs
  const handleTipoChange = (newTipo: OrderTipo) => {
    setTipo(newTipo);
    setSearch("");
    setStatusFilter("all");
    setShowForm(false);
  };

  const { data: stats } = useGetOrderStats(tipo, {
    query: { queryKey: getGetOrderStatsQueryKey(tipo) }
  });

  const { data: allOrders = [] } = useListOrders(
    { tipo },
    { query: { queryKey: getListOrdersQueryKey({ tipo }) } }
  );

  const { data: orders = [], isLoading } = useListOrders(
    {
      tipo,
      search: search || undefined,
      status: statusFilter !== "all" ? (statusFilter as ListOrdersStatus) : undefined
    },
    {
      query: {
        queryKey: getListOrdersQueryKey({
          tipo,
          search: search || undefined,
          status: statusFilter !== "all" ? (statusFilter as ListOrdersStatus) : undefined
        })
      }
    }
  );

  const activeModels = allOrders
    .filter((o) => o.status !== "concluido")
    .map((o) => o.modelo);

  const handleLogout = () => {
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("userEmail");
    setLocation("/");
  };

  const isCliente = tipo === OrderTipo.cliente;

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-20 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center">
              <Wrench className="h-4 w-4 text-primary-foreground" />
            </div>
            <h1 className="font-bold text-lg tracking-tight hidden sm:block">Ismael Cell</h1>
          </div>

          {/* Tabs: Cliente / Lojista */}
          <div className="flex items-center bg-muted rounded-lg p-1 gap-1">
            <button
              onClick={() => handleTipoChange(OrderTipo.lojista)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                !isCliente
                  ? "bg-white shadow text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Store className="w-3.5 h-3.5" />
              Lojista
            </button>
            <button
              onClick={() => handleTipoChange(OrderTipo.cliente)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                isCliente
                  ? "bg-white shadow text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <User className="w-3.5 h-3.5" />
              Cliente
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              className="md:hidden flex items-center gap-1"
              onClick={() => setShowForm((v) => !v)}
            >
              {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {showForm ? "Fechar" : "Nova"}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-foreground">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline ml-2">Sair</span>
            </Button>
          </div>
        </div>

        {/* Tab indicator strip */}
        <div className={`h-0.5 transition-colors ${isCliente ? "bg-blue-500" : "bg-primary"}`} />
      </header>

      <main className="max-w-5xl mx-auto px-4 mt-4 space-y-4">

        {/* Stats */}
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
            <Card className={`shadow-md border-2 ${isCliente ? "border-blue-300" : "border-primary/30"}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-4">
                  {isCliente ? <User className="w-4 h-4 text-blue-500" /> : <Store className="w-4 h-4 text-primary" />}
                  <h2 className="font-semibold text-base">Nova OS — {isCliente ? "Cliente" : "Lojista"}</h2>
                </div>
                <OrderForm activeModels={activeModels} tipo={tipo} onSuccess={() => setShowForm(false)} />
              </CardContent>
            </Card>
          </div>
        )}

        {/* Desktop: side-by-side */}
        <div className="hidden md:grid md:grid-cols-[340px_1fr] gap-6 items-start">
          <div className="sticky top-20">
            <Card className="shadow-md">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  {isCliente ? <User className="w-4 h-4 text-blue-500" /> : <Store className="w-4 h-4 text-primary" />}
                  <h2 className="font-semibold text-base">Nova OS — {isCliente ? "Cliente" : "Lojista"}</h2>
                </div>
                <OrderForm activeModels={activeModels} tipo={tipo} />
              </CardContent>
            </Card>
          </div>
          <div className="space-y-4">
            <OrderFilters search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />
            <OrdersList orders={orders} isLoading={isLoading} />
          </div>
        </div>

        {/* Mobile: orders list */}
        <div className="md:hidden space-y-4">
          <OrderFilters search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />
          <OrdersList orders={orders} isLoading={isLoading} />
        </div>

      </main>
    </div>
  );
}

function OrderFilters({ search, setSearch, statusFilter, setStatusFilter }: {
  search: string; setSearch: (v: string) => void;
  statusFilter: string; setStatusFilter: (v: string) => void;
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

function OrdersList({ orders, isLoading }: { orders: Order[]; isLoading: boolean }) {
  if (isLoading) return <div className="text-center py-12 text-muted-foreground">Carregando ordens...</div>;
  if (orders.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-10 text-center text-muted-foreground">Nenhuma ordem encontrada.</CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {orders.map((order) => <OrderCard key={order.id} order={order} />)}
    </div>
  );
}
