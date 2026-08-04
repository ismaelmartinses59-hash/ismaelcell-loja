import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetOrderStats, useListOrders, getListOrdersQueryKey, getGetOrderStatsQueryKey,
  OrderTipo,
  type Order
} from "@workspace/api-client-react";
import { OrderForm } from "@/components/order-form";
import { OrderCard } from "@/components/order-card";
import { FaturamentoModal } from "@/components/faturamento-modal";
import { GarantiaModal } from "@/components/garantia-modal";
import { CatalogoModal } from "@/components/catalogo-modal";
import { CaixaModal } from "@/components/caixa-modal";
import { ConfiguracoesModal } from "@/components/configuracoes-modal";
import { CaixaSessaoGuard } from "@/components/caixa-sessao-guard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search, LogOut, Activity, CheckCircle2, AlertTriangle, Clock, Plus, X,
  Store, User, TrendingUp, Shield, Package, HandCoins, Wallet, Settings,
  Truck, Timer, Home, ClipboardList, MoreHorizontal, Bell, ChevronRight,
  Smartphone, ShieldAlert, Undo2
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ListOrdersStatus } from "@workspace/api-client-react";

export default function Orders() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [tipo, setTipo] = useState<OrderTipo>(OrderTipo.cliente);
  const [showFaturamento, setShowFaturamento] = useState(false);
  const [showGarantia, setShowGarantia] = useState(false);
  const [garantiaCodigo, setGarantiaCodigo] = useState<string | undefined>(undefined);
  const [showCatalogo, setShowCatalogo] = useState(false);
  const [showCaixa, setShowCaixa] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showMais, setShowMais] = useState(false);
  const [bottomTab, setBottomTab] = useState<"inicio" | "ordens" | "caixa">("inicio");
  const [catalogoTab, setCatalogoTab] = useState<"pecas" | "garantias" | "historico" | "receber" | "encomendas" | "espera" | "devolucoes">("pecas");
  const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

  interface ContaResumo { conta: { closedAt: string | null }; saldo: number }
  const { data: contasReceber = [] } = useQuery<ContaResumo[]>({
    queryKey: ["contas-receber"],
    queryFn: () => fetch(`${BASE_URL}/api/contas-receber`).then((r) => r.ok ? r.json() : []),
    refetchInterval: 30000,
  });

  interface EncomendasResumo { encomendas?: { status: string }[]; saldoTotal?: number; }
  const { data: encomendasResp } = useQuery<EncomendasResumo>({
    queryKey: ["encomendas-resumo"],
    queryFn: () => fetch(`${BASE_URL}/api/encomendas`).then((r) => r.ok ? r.json() : { encomendas: [], saldoTotal: 0 }),
    refetchInterval: 30000,
  });
  const encomendasList = Array.isArray(encomendasResp?.encomendas) ? encomendasResp!.encomendas : [];
  const totalEncomendas = encomendasList.length;
  const totalValorEncomendas = encomendasResp?.saldoTotal ?? 0;
  const contasAbertas = (Array.isArray(contasReceber) ? contasReceber : []).filter((c) => c.conta.closedAt === null && c.saldo > 0);
  const totalAReceber = contasAbertas.reduce((a, c) => a + c.saldo, 0);

  interface PecaEspera { id: number; valor: string; status: string }
  const { data: esperaItems = [] } = useQuery<PecaEspera[]>({
    queryKey: ["pecas-espera"],
    queryFn: () => fetch(`${BASE_URL}/api/espera`).then((r) => r.ok ? r.json() : []),
    refetchInterval: 30000,
  });
  const esperaAguardando = esperaItems.filter((e) => e.status === "aguardando");
  const totalEspera = esperaAguardando.reduce((a, e) => a + parseFloat(e.valor || "0"), 0);

  interface GarantiaPecaResumo { id: number; status: string }
  const { data: garantiaItems = [] } = useQuery<GarantiaPecaResumo[]>({
    queryKey: ["garantias-peca"],
    queryFn: () => fetch(`${BASE_URL}/api/garantias-peca`).then((r) => r.ok ? r.json() : []),
    refetchInterval: 60000,
  });
  const garantiasPendentes = garantiaItems.filter((g) => g.status === "pendente");

  useEffect(() => {
    if (localStorage.getItem("isLoggedIn") !== "true") setLocation("/");
  }, [setLocation]);

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
    { tipo, search: search || undefined, status: statusFilter !== "all" ? (statusFilter as ListOrdersStatus) : undefined },
    { query: { queryKey: getListOrdersQueryKey({ tipo, search: search || undefined, status: statusFilter !== "all" ? (statusFilter as ListOrdersStatus) : undefined }) } }
  );

  const activeModels = allOrders.filter((o) => o.status !== "concluido" && o.status !== "encerrado").map((o) => o.modelo);
  const showOnlyActive = statusFilter === "all" && search.length === 0;
  const displayOrders = showOnlyActive ? orders.filter((o) => o.status !== "concluido" && o.status !== "encerrado") : orders;

  const handleLogout = () => {
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("userEmail");
    setLocation("/");
  };

  const isCliente = tipo === OrderTipo.cliente;
  const handleOrderCreated = () => setShowForm(false);

  const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const statCards = stats ? [
    { icon: <ClipboardList className="w-5 h-5 text-blue-600" />, bg: "bg-blue-100", value: stats.total, label: "TOTAL", sub: "Ordens de serviço" },
    { icon: <Clock className="w-5 h-5 text-orange-500" />, bg: "bg-orange-100", value: stats.aguardando, label: "AGUARDANDO", sub: "Aguardando início" },
    { icon: <Activity className="w-5 h-5 text-blue-500" />, bg: "bg-blue-100", value: stats.emAndamento, label: "EM ANDAMENTO", sub: "Em execução" },
    { icon: <CheckCircle2 className="w-5 h-5 text-green-600" />, bg: "bg-green-100", value: stats.concluido, label: "CONCLUÍDAS", sub: "Serviços finalizados" },
    { icon: <AlertTriangle className="w-5 h-5 text-red-500" />, bg: "bg-red-100", value: stats.problema, label: "COM PROBLEMA", sub: "Aguardando ação" },
    { icon: <Shield className="w-5 h-5 text-purple-600" />, bg: "bg-purple-100", value: stats.comGarantia, label: "EM GARANTIA", sub: "Dentro da garantia" },
  ] : [];

  const filterTabs = [
    { value: "all", label: "Todos", icon: <ClipboardList className="w-3 h-3" /> },
    { value: ListOrdersStatus.aguardando, label: "Aguardando", icon: <Clock className="w-3 h-3" /> },
    { value: ListOrdersStatus.em_andamento, label: "Em andamento", icon: <Activity className="w-3 h-3" /> },
    { value: ListOrdersStatus.concluido, label: "Concluídas", icon: <CheckCircle2 className="w-3 h-3" /> },
    { value: "garantia_os", label: "Garantia", icon: <Shield className="w-3 h-3" /> },
    { value: ListOrdersStatus.problema, label: "Problema", icon: <AlertTriangle className="w-3 h-3" /> },
    { value: ListOrdersStatus.encerrado, label: "Encerrado", icon: <X className="w-3 h-3" /> },
  ];

  // Handle guarantee filter specially (it's a stats concept, not a status)
  const effectiveStatusFilter = statusFilter === "garantia_os" ? "all" : statusFilter;

  return (
    <div className="min-h-screen bg-gray-50 pb-24" style={{ fontFamily: "'Inter', sans-serif" }}>
      <CaixaSessaoGuard />
      <FaturamentoModal open={showFaturamento} onClose={() => setShowFaturamento(false)} tipo={tipo} />
      <GarantiaModal open={showGarantia} initialCodigo={garantiaCodigo} onClose={() => { setShowGarantia(false); setGarantiaCodigo(undefined); }} />
      <CatalogoModal open={showCatalogo} onClose={() => { setShowCatalogo(false); setCatalogoTab("pecas"); }} setor={isCliente ? "cliente" : "lojista"} initialTab={catalogoTab} soloTab={catalogoTab === "receber" || catalogoTab === "espera" || catalogoTab === "garantias" || catalogoTab === "devolucoes"} />
      <CaixaModal open={showCaixa} onClose={() => setShowCaixa(false)} />
      <ConfiguracoesModal open={showConfig} onClose={() => setShowConfig(false)} />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="bg-white px-4 pt-[env(safe-area-inset-top)] pb-3 flex items-center justify-between border-b border-gray-100 shadow-sm">
        {/* Logo + wordmark */}
        <div className="flex items-center gap-2.5">
          <img
            src="/pwa-192x192.png"
            alt="Ismael Cell"
            className="w-11 h-11 rounded-xl object-cover"
          />
          <div className="leading-tight">
            <div className="text-base font-extrabold tracking-tight">
              <span className="text-gray-900">ISMAEL</span>
              <span className="text-blue-600">CELL</span>
            </div>
            <div className="text-[9px] font-semibold text-gray-400 tracking-[0.18em] uppercase mt-0.5">
              Gestão de Serviços
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          {/* Bell */}
          <button
            className="relative p-1"
            onClick={() => setShowConfig(true)}
          >
            <Bell className="w-6 h-6 text-gray-500 stroke-[1.5]" />
            {garantiasPendentes.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-blue-600 text-white text-[9px] font-bold min-w-[16px] h-4 px-0.5 rounded-full flex items-center justify-center">
                {garantiasPendentes.length}
              </span>
            )}
          </button>

          {/* Avatar */}
          <button
            onClick={handleLogout}
            title="Sair"
            className="w-9 h-9 rounded-full overflow-hidden border-2 border-gray-200 shadow-sm bg-gradient-to-br from-blue-400 to-blue-700 flex items-center justify-center shrink-0"
          >
            <User className="w-5 h-5 text-white" />
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto">

        {/* ── Greeting ─────────────────────────────────────────────────────── */}
        <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Olá, Ismael! 👋</h1>
            <p className="text-sm text-gray-500 mt-0.5">Aqui está o resumo da sua loja hoje.</p>
          </div>
          <Button
            onClick={() => setShowForm(true)}
            className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-sm h-9 px-3 text-sm font-semibold"
          >
            <Plus className="w-4 h-4 mr-1" /> Nova OS
          </Button>
        </div>

        {/* ── Cliente / Lojista toggle ──────────────────────────────────────── */}
        <div className="px-4 mb-3">
          <div className="inline-flex bg-gray-100 rounded-lg p-1 gap-1">
            <button
              onClick={() => handleTipoChange(OrderTipo.cliente)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition-all ${isCliente ? "bg-white shadow text-blue-600" : "text-gray-500"}`}
            >
              <User className="w-3.5 h-3.5" /> Cliente
            </button>
            <button
              onClick={() => handleTipoChange(OrderTipo.lojista)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition-all ${!isCliente ? "bg-white shadow text-blue-600" : "text-gray-500"}`}
            >
              <Store className="w-3.5 h-3.5" /> Lojista
            </button>
          </div>
        </div>

        {/* ── Stats grid ───────────────────────────────────────────────────── */}
        {statCards.length > 0 && (
          <div className="px-4 grid grid-cols-3 gap-3 mb-3">
            {statCards.map((c, i) => (
              <div key={i} className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100">
                <div className={`w-9 h-9 rounded-full ${c.bg} flex items-center justify-center mb-2`}>
                  {c.icon}
                </div>
                <div className="text-2xl font-extrabold text-gray-800 leading-none mb-1">{c.value}</div>
                <div className="text-[10px] font-bold text-gray-700 uppercase tracking-wide leading-tight">{c.label}</div>
                <div className="text-[10px] text-gray-400 leading-tight mt-0.5">{c.sub}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Financial cards ───────────────────────────────────────────────── */}
        <div className="px-4 grid grid-cols-3 gap-2.5 mb-4">
          {/* A Receber */}
          <button
            className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100 text-left flex flex-col gap-1 active:scale-95 transition-transform"
            onClick={() => { setCatalogoTab("receber"); setShowCatalogo(true); }}
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center">
                <HandCoins className="w-3.5 h-3.5 text-green-600" />
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
            </div>
            <div className="text-[9px] font-bold text-gray-500 uppercase tracking-wide leading-tight">A RECEBER</div>
            <div className="text-sm font-extrabold text-green-600 leading-tight">{fmtBRL(totalAReceber)}</div>
            <div className="text-[9px] text-gray-400">{contasAbertas.length} contas abertas</div>
          </button>

          {/* Aguardando Chegada */}
          <button
            className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100 text-left flex flex-col gap-1 active:scale-95 transition-transform"
            onClick={() => { setCatalogoTab("encomendas"); setShowCatalogo(true); }}
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center">
                <Truck className="w-3.5 h-3.5 text-blue-600" />
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
            </div>
            <div className="text-[9px] font-bold text-gray-500 uppercase tracking-wide leading-tight">AGUARDANDO CHEGADA</div>
            <div className="text-sm font-extrabold text-blue-600 leading-tight">{fmtBRL(totalValorEncomendas)}</div>
            <div className="text-[9px] text-gray-400">{totalEncomendas} encomenda{totalEncomendas !== 1 ? "s" : ""}</div>
          </button>

          {/* Modo Espera */}
          <button
            className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100 text-left flex flex-col gap-1 active:scale-95 transition-transform"
            onClick={() => { setCatalogoTab("espera"); setShowCatalogo(true); }}
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center">
                <Timer className="w-3.5 h-3.5 text-amber-600" />
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
            </div>
            <div className="text-[9px] font-bold text-gray-500 uppercase tracking-wide leading-tight">MODO ESPERA</div>
            <div className="text-sm font-extrabold text-amber-600 leading-tight">{fmtBRL(totalEspera)}</div>
            <div className="text-[9px] text-gray-400">{esperaAguardando.length} peça{esperaAguardando.length !== 1 ? "s" : ""} aguardando</div>
          </button>
        </div>

        {/* ── New OS form (inline when open) ───────────────────────────────── */}
        {showForm && (
          <div className="px-4 mb-4">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  {isCliente ? <User className="w-4 h-4 text-blue-500" /> : <Store className="w-4 h-4 text-blue-600" />}
                  <h2 className="font-bold text-base text-gray-800">Nova OS — {isCliente ? "Cliente" : "Lojista"}</h2>
                </div>
                <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <OrderForm activeModels={activeModels} tipo={tipo} onSuccess={handleOrderCreated} />
            </div>
          </div>
        )}

        {/* ── Search ───────────────────────────────────────────────────────── */}
        <div className="px-4 mb-3">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Pesquisar por código, modelo, serviço ou cliente..."
              className="pl-10 pr-10 rounded-2xl border-gray-200 bg-white shadow-sm h-11 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400" onClick={() => setSearch("")}>
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* ── Filter chips ─────────────────────────────────────────────────── */}
        <div className="px-4 mb-4">
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {filterTabs.map((tab) => {
              const active = statusFilter === tab.value;
              return (
                <button
                  key={tab.value}
                  onClick={() => setStatusFilter(tab.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all shrink-0 border ${
                    active
                      ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                      : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Orders list ──────────────────────────────────────────────────── */}
        <div className="px-4 pb-4">
          {isLoading ? (
            <div className="text-center py-12 text-gray-400 text-sm">Carregando ordens...</div>
          ) : displayOrders.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 py-12 px-6 text-center">
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <ClipboardList className="w-8 h-8 text-blue-300" />
              </div>
              <p className="font-semibold text-gray-600 mb-1">Nenhuma ordem ativa no momento.</p>
              <p className="text-sm text-gray-400 mb-5">Use o botão acima para criar uma nova OS.</p>
              <Button
                onClick={() => setShowForm(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl"
              >
                <Plus className="w-4 h-4 mr-1.5" /> Criar Nova OS
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {displayOrders.map((order) => (
                <OrderCard key={order.id} order={order} onRegistrarGarantia={(codigo) => { setGarantiaCodigo(codigo); setShowGarantia(true); }} />
              ))}
            </div>
          )}
        </div>

      </div>

      {/* ── Bottom Navigation ────────────────────────────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 shadow-lg pb-[env(safe-area-inset-bottom)] z-30">
        <div className="max-w-lg mx-auto flex items-end justify-around px-4 h-16">
          {/* Início */}
          <button
            onClick={() => { setBottomTab("inicio"); setShowForm(false); setSearch(""); setStatusFilter("all"); }}
            className="flex flex-col items-center gap-0.5 pt-2"
          >
            <Home className={`w-5 h-5 ${bottomTab === "inicio" ? "text-blue-600" : "text-gray-400"}`} />
            <span className={`text-[10px] font-semibold ${bottomTab === "inicio" ? "text-blue-600" : "text-gray-400"}`}>Início</span>
          </button>

          {/* Ordens */}
          <button
            onClick={() => setBottomTab("ordens")}
            className="flex flex-col items-center gap-0.5 pt-2"
          >
            <ClipboardList className={`w-5 h-5 ${bottomTab === "ordens" ? "text-blue-600" : "text-gray-400"}`} />
            <span className={`text-[10px] font-semibold ${bottomTab === "ordens" ? "text-blue-600" : "text-gray-400"}`}>Ordens</span>
          </button>

          {/* Nova OS (FAB center) */}
          <button
            onClick={() => setShowForm((v) => !v)}
            className="relative -top-4 w-14 h-14 bg-blue-600 hover:bg-blue-700 rounded-full flex items-center justify-center shadow-lg transition-colors"
          >
            {showForm ? <X className="w-6 h-6 text-white" /> : <Plus className="w-6 h-6 text-white" />}
            <span className="sr-only">Nova OS</span>
          </button>

          {/* Caixa */}
          <button
            onClick={() => { setShowCaixa(true); setBottomTab("caixa"); }}
            className="flex flex-col items-center gap-0.5 pt-2"
          >
            <Wallet className={`w-5 h-5 ${bottomTab === "caixa" ? "text-blue-600" : "text-gray-400"}`} />
            <span className={`text-[10px] font-semibold ${bottomTab === "caixa" ? "text-blue-600" : "text-gray-400"}`}>Caixa</span>
          </button>

          {/* Mais */}
          <button
            onClick={() => setShowMais(true)}
            className="flex flex-col items-center gap-0.5 pt-2 relative"
          >
            <MoreHorizontal className="w-5 h-5 text-gray-400" />
            <span className="text-[10px] font-semibold text-gray-400">Mais</span>
          </button>
        </div>
      </nav>

      {/* ── "Mais" bottom sheet ───────────────────────────────────────────── */}
      {showMais && (
        <div className="fixed inset-0 z-50 flex items-end" onClick={() => setShowMais(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white w-full rounded-t-3xl p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] z-10 max-w-lg mx-auto" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />
            <div className="grid grid-cols-3 gap-3">
              {[
                { icon: <Package className="w-5 h-5 text-blue-600" />, bg: "bg-blue-50", label: "Peças", action: () => { setCatalogoTab("pecas"); setShowCatalogo(true); setShowMais(false); } },
                { icon: <Timer className="w-5 h-5 text-amber-600" />, bg: "bg-amber-50", label: "Espera", badge: esperaAguardando.length, action: () => { setCatalogoTab("espera"); setShowCatalogo(true); setShowMais(false); } },
                { icon: <ShieldAlert className="w-5 h-5 text-amber-700" />, bg: "bg-amber-50", label: "Garantia Peças", badge: garantiasPendentes.length, action: () => { setCatalogoTab("garantias"); setShowCatalogo(true); setShowMais(false); } },
                { icon: <Shield className="w-5 h-5 text-purple-600" />, bg: "bg-purple-50", label: "Garantia OS", action: () => { setShowGarantia(true); setShowMais(false); } },
                { icon: <TrendingUp className="w-5 h-5 text-green-600" />, bg: "bg-green-50", label: "Faturamento", action: () => { setShowFaturamento(true); setShowMais(false); } },
                { icon: <Undo2 className="w-5 h-5 text-orange-600" />, bg: "bg-orange-50", label: "Devoluções", action: () => { setCatalogoTab("devolucoes"); setShowCatalogo(true); setShowMais(false); } },
                { icon: <Settings className="w-5 h-5 text-gray-600" />, bg: "bg-gray-100", label: "Config.", action: () => { setShowConfig(true); setShowMais(false); } },
                { icon: <LogOut className="w-5 h-5 text-red-500" />, bg: "bg-red-50", label: "Sair", action: () => { handleLogout(); setShowMais(false); } },
              ].map((item, i) => (
                <button
                  key={i}
                  onClick={item.action}
                  className="relative flex flex-col items-center gap-2 bg-gray-50 hover:bg-gray-100 rounded-2xl py-4 px-2 transition-colors"
                >
                  <div className={`w-11 h-11 ${item.bg} rounded-full flex items-center justify-center`}>
                    {item.icon}
                  </div>
                  <span className="text-xs font-semibold text-gray-700 text-center leading-tight">{item.label}</span>
                  {(item as { badge?: number }).badge !== undefined && (item as { badge?: number }).badge! > 0 && (
                    <span className="absolute top-2 right-2 bg-blue-600 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                      {(item as { badge?: number }).badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
