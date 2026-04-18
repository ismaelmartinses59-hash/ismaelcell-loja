import { useState, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Pencil, Trash2, Check, X, Share2, Package, AlertTriangle, ShieldAlert, Clock, RefreshCw, XCircle, ShoppingBag } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const QUALIDADES = ["Diamond", "Gold Pro", "NN", "WEFIX", "INCELL", "ORI CHINA"];
const QUALIDADES_BATERIA = ["Skaiky", "Foxcomm", "Original China"];
const SUGESTOES_QUALIDADE: Array<{ palavra: string; opcoes: string[] }> = [
  { palavra: "bateria", opcoes: QUALIDADES_BATERIA },
];

interface Peca {
  id: number;
  modelo: string;
  qualidade: string;
  valor: string;
  quantidade: number;
}

interface GarantiaPeca {
  id: number;
  modelo: string;
  qualidade: string;
  lojista: string;
  motivo: string;
  status: string;
  createdAt: string;
}

interface Venda {
  id: number;
  pecaId: number;
  modelo: string;
  qualidade: string;
  valor: string;
  createdAt: string;
}

interface VendasResumo {
  vendas: Venda[];
  total: number;
  quantidade: number;
}

function apiFetch(path: string, opts?: RequestInit) {
  return fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  }).then((r) => {
    if (!r.ok) throw new Error(`Erro ${r.status}`);
    if (r.status === 204) return null;
    return r.json();
  });
}

function formatMoney(val: string) {
  const n = parseFloat(val.replace(",", "."));
  if (isNaN(n)) return val;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

// ─── Peca Form ────────────────────────────────────────────────────────────────

interface PecaFormProps {
  initial?: Partial<Peca>;
  onSave: (data: Omit<Peca, "id">) => void;
  onCancel: () => void;
  loading: boolean;
}

function PecaForm({ initial, onSave, onCancel, loading }: PecaFormProps) {
  const [modelo, setModelo] = useState(initial?.modelo ?? "");
  const [qualidade, setQualidade] = useState(initial?.qualidade ?? "");
  const [valor, setValor] = useState(initial?.valor ?? "");
  const [quantidade, setQuantidade] = useState(String(initial?.quantidade ?? 1));
  const [custo, setCusto] = useState("");
  const [precoSugerido, setPrecoSugerido] = useState<number | null>(null);

  const calcularSugestao = (custoStr: string) => {
    const c = parseFloat(custoStr.replace(",", "."));
    if (isNaN(c) || c <= 0) { setPrecoSugerido(null); return; }
    const maoDeObra = c <= 90 ? 40 : 30;
    let preco = c * 2 + maoDeObra;
    preco = Math.round(preco / 5) * 5;
    setPrecoSugerido(preco);
  };

  const aplicarSugestao = () => {
    if (precoSugerido !== null) setValor(String(precoSugerido).replace(".", ","));
  };

  const submit = () => {
    if (!modelo.trim() || !qualidade || !valor.trim()) return;
    const qtd = parseInt(quantidade) || 0;
    if (qtd < 1) return;
    onSave({ modelo: modelo.trim(), qualidade, valor: valor.trim(), quantidade: qtd });
  };

  const lower = modelo.toLowerCase();
  const match = SUGESTOES_QUALIDADE.find((s) => lower.includes(s.palavra));
  const qualidadesAtivas = match ? match.opcoes : QUALIDADES;

  return (
    <div className="bg-muted/40 rounded-xl p-4 space-y-3 border">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Modelo / Peça</label>
          <Input
            placeholder="Ex: Tela A03 Core, Bateria S21..."
            value={modelo}
            onChange={(e) => { setModelo(e.target.value); setQualidade(""); }}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Qualidade</label>
          <Select value={qualidade} onValueChange={setQualidade}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              {qualidadesAtivas.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Quantidade em Estoque</label>
          <Input type="number" min={1} placeholder="1" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
        </div>
        <div className="col-span-2 bg-white border border-dashed border-primary/30 rounded-lg p-3 space-y-2">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide">Calculadora de Preço</p>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Meu custo (R$)</label>
              <Input placeholder="Ex: 60,00" value={custo} onChange={(e) => { setCusto(e.target.value); calcularSugestao(e.target.value); }} />
            </div>
            {precoSugerido !== null && (
              <button type="button" onClick={aplicarSugestao} className="shrink-0 flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-800 text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
                💡 R$ {precoSugerido} — usar
              </button>
            )}
          </div>
          {precoSugerido !== null && (
            <p className="text-xs text-muted-foreground">Custo {custo} → venda sugerida <strong>R$ {precoSugerido}</strong></p>
          )}
        </div>
        <div className="col-span-2">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Valor de Venda (R$)</label>
          <Input placeholder="120,00" value={valor} onChange={(e) => setValor(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={loading}><X className="w-4 h-4 mr-1" /> Cancelar</Button>
        <Button size="sm" onClick={submit} disabled={loading || !modelo.trim() || !qualidade || !valor.trim() || parseInt(quantidade) < 1}>
          <Check className="w-4 h-4 mr-1" /> {loading ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </div>
  );
}

// ─── Garantia Form ────────────────────────────────────────────────────────────

interface GarantiaFormProps {
  onSave: (data: { modelo: string; qualidade: string; lojista: string; motivo: string }) => void;
  onCancel: () => void;
  loading: boolean;
}

function GarantiaForm({ onSave, onCancel, loading }: GarantiaFormProps) {
  const [modelo, setModelo] = useState("");
  const [qualidade, setQualidade] = useState("");
  const [lojista, setLojista] = useState("");
  const [motivo, setMotivo] = useState("");

  const lower = modelo.toLowerCase();
  const match = SUGESTOES_QUALIDADE.find((s) => lower.includes(s.palavra));
  const qualidadesAtivas = match ? match.opcoes : QUALIDADES;

  const submit = () => {
    if (!modelo.trim() || !qualidade || !lojista.trim() || !motivo.trim()) return;
    onSave({ modelo: modelo.trim(), qualidade, lojista: lojista.trim(), motivo: motivo.trim() });
  };

  return (
    <div className="bg-muted/40 rounded-xl p-4 space-y-3 border border-amber-200 bg-amber-50/30">
      <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide flex items-center gap-1.5">
        <ShieldAlert className="w-3.5 h-3.5" /> Registrar Devolução
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Modelo / Peça devolvida</label>
          <Input placeholder="Ex: Tela A03 Core..." value={modelo} onChange={(e) => { setModelo(e.target.value); setQualidade(""); }} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Qualidade</label>
          <Select value={qualidade} onValueChange={setQualidade}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              {qualidadesAtivas.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Nome do Lojista</label>
          <Input placeholder="Nome do lojista" value={lojista} onChange={(e) => setLojista(e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Motivo da devolução</label>
          <Textarea placeholder="Descreva o problema relatado..." value={motivo} onChange={(e) => setMotivo(e.target.value)} className="resize-none h-20" />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={loading}><X className="w-4 h-4 mr-1" /> Cancelar</Button>
        <Button size="sm" onClick={submit} disabled={loading || !modelo.trim() || !qualidade || !lojista.trim() || !motivo.trim()} className="bg-amber-600 hover:bg-amber-700 text-white">
          <Check className="w-4 h-4 mr-1" /> {loading ? "Salvando..." : "Registrar"}
        </Button>
      </div>
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  pendente: { label: "Pendente", className: "bg-amber-100 text-amber-700 border-amber-300", icon: <Clock className="w-3 h-3" /> },
  trocado:  { label: "Trocado",  className: "bg-green-100 text-green-700 border-green-300",  icon: <RefreshCw className="w-3 h-3" /> },
  recusado: { label: "Recusado", className: "bg-red-100 text-red-700 border-red-300",         icon: <XCircle className="w-3 h-3" /> },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pendente;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.className}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

interface CatalogoModalProps {
  open: boolean;
  onClose: () => void;
  setor: "cliente" | "lojista";
}

export function CatalogoModal({ open, onClose, setor }: CatalogoModalProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [aba, setAba] = useState<"pecas" | "garantias" | "historico">("pecas");
  const [periodo, setPeriodo] = useState<"dia" | "semana" | "mes">("dia");

  // Peças state
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [sharingPeca, setSharingPeca] = useState<Peca | null>(null);
  const [shareDate, setShareDate] = useState("");
  const shareRef = useRef<HTMLDivElement>(null);

  // Garantias state
  const [showGarantiaForm, setShowGarantiaForm] = useState(false);
  const [deletingGarantiaId, setDeletingGarantiaId] = useState<number | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: pecas = [], isLoading: pecasLoading } = useQuery<Peca[]>({
    queryKey: ["pecas", setor, search],
    queryFn: () => {
      const params = new URLSearchParams({ setor });
      if (search) params.set("search", search);
      return apiFetch(`/api/pecas?${params}`);
    },
    enabled: open,
  });

  const { data: garantias = [], isLoading: garantiasLoading } = useQuery<GarantiaPeca[]>({
    queryKey: ["garantias-peca"],
    queryFn: () => apiFetch("/api/garantias-peca"),
    enabled: open,
  });

  const { data: vendasData, isLoading: vendasLoading } = useQuery<VendasResumo>({
    queryKey: ["vendas", periodo],
    queryFn: () => apiFetch(`/api/vendas?periodo=${periodo}`),
    enabled: open && aba === "historico",
    refetchInterval: aba === "historico" ? 30000 : false,
  });

  const invalidatePecas = () => qc.invalidateQueries({ queryKey: ["pecas"] });
  const invalidateGarantias = () => qc.invalidateQueries({ queryKey: ["garantias-peca"] });

  // ── Peça mutations ────────────────────────────────────────────────────────────
  const addMutation = useMutation({
    mutationFn: (data: Omit<Peca, "id">) => apiFetch("/api/pecas", { method: "POST", body: JSON.stringify({ ...data, setor }) }),
    onSuccess: () => { invalidatePecas(); setShowAdd(false); toast({ title: "Peça adicionada!" }); },
    onError: () => toast({ title: "Erro ao salvar", variant: "destructive" }),
  });
  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Omit<Peca, "id"> }) =>
      apiFetch(`/api/pecas/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => { invalidatePecas(); setEditingId(null); toast({ title: "Peça atualizada!" }); },
    onError: () => toast({ title: "Erro ao salvar", variant: "destructive" }),
  });
  const deletePecaMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/pecas/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidatePecas(); setDeletingId(null); toast({ title: "Peça removida" }); },
    onError: () => toast({ title: "Erro ao remover", variant: "destructive" }),
  });

  const venderMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/pecas/${id}/vender`, { method: "POST" }),
    onSuccess: (peca: Peca) => {
      invalidatePecas();
      if (peca.quantidade === 0) {
        toast({ title: "✅ Vendida! Estoque esgotado.", description: `${peca.modelo} — sem unidades restantes.` });
      } else {
        toast({ title: `✅ Vendida! Restam ${peca.quantidade} un.`, description: peca.modelo });
      }
    },
    onError: () => toast({ title: "Sem estoque disponível", variant: "destructive" }),
  });

  // ── Garantia mutations ────────────────────────────────────────────────────────
  const addGarantiaMutation = useMutation({
    mutationFn: (data: { modelo: string; qualidade: string; lojista: string; motivo: string }) =>
      apiFetch("/api/garantias-peca", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { invalidateGarantias(); setShowGarantiaForm(false); toast({ title: "Devolução registrada!" }); },
    onError: () => toast({ title: "Erro ao registrar", variant: "destructive" }),
  });
  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiFetch(`/api/garantias-peca/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => { invalidateGarantias(); toast({ title: "Status atualizado!" }); },
    onError: () => toast({ title: "Erro ao atualizar", variant: "destructive" }),
  });
  const deleteGarantiaMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/garantias-peca/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidateGarantias(); setDeletingGarantiaId(null); toast({ title: "Registro removido" }); },
    onError: () => toast({ title: "Erro ao remover", variant: "destructive" }),
  });

  // ── Share ─────────────────────────────────────────────────────────────────────
  const handleShare = useCallback(async (peca: Peca) => {
    setShareDate(new Date().toLocaleDateString("pt-BR"));
    setSharingPeca(peca);
    await new Promise((r) => setTimeout(r, 80));
    const el = shareRef.current;
    if (!el) return;
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(el, { backgroundColor: "#ffffff", scale: 2 });
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const file = new File([blob], `${peca.modelo.replace(/\s+/g, "-")}.png`, { type: "image/png" });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: `${peca.modelo} — Ismael Cell` });
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = file.name; a.click();
          URL.revokeObjectURL(url);
        }
        setSharingPeca(null);
      }, "image/png");
    } catch {
      setSharingPeca(null);
      toast({ title: "Não foi possível gerar a imagem", variant: "destructive" });
    }
  }, [toast]);

  const lowStock = pecas.filter((p) => p.quantidade <= 1);
  const pendentes = garantias.filter((g) => g.status === "pendente");

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg w-full max-h-[90vh] flex flex-col p-0 gap-0">

        {/* Header */}
        <DialogHeader className="px-4 pt-4 pb-0 shrink-0">
          <DialogTitle className="flex items-center gap-2 mb-3">
            <Package className="w-5 h-5 text-primary" />
            Catálogo de Peças
          </DialogTitle>

          {/* Tabs */}
          <div className="flex gap-1 bg-muted rounded-lg p-1">
            <button
              onClick={() => setAba("pecas")}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${aba === "pecas" ? "bg-white shadow text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Package className="w-3.5 h-3.5" /> Peças
              {lowStock.length > 0 && (
                <span className="bg-amber-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">{lowStock.length}</span>
              )}
            </button>
            <button
              onClick={() => setAba("garantias")}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${aba === "garantias" ? "bg-white shadow text-amber-600" : "text-muted-foreground hover:text-foreground"}`}
            >
              <ShieldAlert className="w-3.5 h-3.5" /> Garantias
              {pendentes.length > 0 && (
                <span className="bg-amber-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">{pendentes.length}</span>
              )}
            </button>
            <button
              onClick={() => setAba("historico")}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${aba === "historico" ? "bg-white shadow text-green-700" : "text-muted-foreground hover:text-foreground"}`}
            >
              <ShoppingBag className="w-3.5 h-3.5" /> Histórico
            </button>
          </div>
        </DialogHeader>

        {/* ── ABA PEÇAS ──────────────────────────────────────────────────────── */}
        {aba === "pecas" && (
          <>
            <div className="px-4 pt-3 pb-2 shrink-0 space-y-2">
              {lowStock.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span><strong>{lowStock.length}</strong> {lowStock.length === 1 ? "peça com estoque mínimo" : "peças com estoque mínimo"} (1 unidade — hora de comprar!)</span>
                </div>
              )}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Buscar modelo ou qualidade..." value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <Button size="sm" onClick={() => { setShowAdd(true); setEditingId(null); }}>
                  <Plus className="w-4 h-4 mr-1" /> Nova
                </Button>
              </div>
              {showAdd && (
                <PecaForm onSave={(data) => addMutation.mutate(data)} onCancel={() => setShowAdd(false)} loading={addMutation.isPending} />
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
              {!search.trim() && (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">Digite para pesquisar</p>
                  <p className="text-xs mt-1 opacity-70">Ex: "Tela A03", "Bateria S21"...</p>
                </div>
              )}
              {search.trim() && pecasLoading && <div className="text-center py-8 text-muted-foreground text-sm">Carregando...</div>}
              {search.trim() && !pecasLoading && pecas.length === 0 && <div className="text-center py-10 text-muted-foreground text-sm">Nenhuma peça encontrada para "<strong>{search}</strong>".</div>}
              {search.trim() && pecas.map((peca) => (
                <div key={peca.id}>
                  {editingId === peca.id ? (
                    <PecaForm initial={peca} onSave={(data) => editMutation.mutate({ id: peca.id, data })} onCancel={() => setEditingId(null)} loading={editMutation.isPending} />
                  ) : deletingId === peca.id ? (
                    <div className="border border-red-200 bg-red-50 rounded-xl p-3 flex items-center justify-between gap-3">
                      <span className="text-sm text-red-700">Remover <strong>{peca.modelo}</strong>?</span>
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => setDeletingId(null)}>Não</Button>
                        <Button size="sm" variant="destructive" onClick={() => deletePecaMutation.mutate(peca.id)} disabled={deletePecaMutation.isPending}>
                          {deletePecaMutation.isPending ? "..." : "Sim"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className={`border rounded-xl p-3 bg-white space-y-2 ${peca.quantidade === 0 ? "border-gray-300 opacity-70" : peca.quantidade <= 1 ? "border-amber-300 bg-amber-50/40" : ""}`}>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm truncate flex items-center gap-2">
                            {peca.modelo}
                            {peca.quantidade === 0 && (
                              <span className="text-[10px] font-bold uppercase bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">Esgotado</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">{peca.qualidade}</span>
                            <span className="text-xs text-muted-foreground font-semibold">{formatMoney(peca.valor)}</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-lg font-bold ${peca.quantidade === 0 ? "text-gray-400" : peca.quantidade <= 1 ? "text-amber-600" : "text-green-600"}`}>{peca.quantidade}</div>
                          <div className="text-xs text-muted-foreground">un. estoque</div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50" onClick={() => handleShare(peca)} title="Compartilhar">
                            <Share2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingId(peca.id); setShowAdd(false); }}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => setDeletingId(peca.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                      {search.trim() && (
                        <Button
                          size="sm"
                          disabled={peca.quantidade === 0 || venderMutation.isPending}
                          onClick={() => venderMutation.mutate(peca.id)}
                          className="w-full h-8 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white disabled:opacity-40"
                        >
                          <ShoppingBag className="w-3.5 h-3.5 mr-1.5" />
                          {peca.quantidade === 0 ? "Sem estoque" : "Registrar Venda (-1 un.)"}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── ABA GARANTIAS ──────────────────────────────────────────────────── */}
        {aba === "garantias" && (
          <>
            <div className="px-4 pt-3 pb-2 shrink-0 space-y-2">
              <div className="flex justify-between items-center">
                <p className="text-xs text-muted-foreground">
                  {garantias.length === 0 ? "Nenhuma devolução registrada" : `${garantias.length} registro${garantias.length > 1 ? "s" : ""} · ${pendentes.length} pendente${pendentes.length !== 1 ? "s" : ""}`}
                </p>
                <Button size="sm" onClick={() => setShowGarantiaForm(true)} className="bg-amber-600 hover:bg-amber-700 text-white">
                  <Plus className="w-4 h-4 mr-1" /> Registrar
                </Button>
              </div>
              {showGarantiaForm && (
                <GarantiaForm onSave={(data) => addGarantiaMutation.mutate(data)} onCancel={() => setShowGarantiaForm(false)} loading={addGarantiaMutation.isPending} />
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
              {garantiasLoading && <div className="text-center py-8 text-muted-foreground text-sm">Carregando...</div>}
              {!garantiasLoading && garantias.length === 0 && (
                <div className="text-center py-10 text-muted-foreground text-sm">
                  Nenhuma devolução registrada ainda.<br />
                  <span className="text-xs">Quando um lojista devolver uma peça, registre aqui.</span>
                </div>
              )}
              {garantias.map((g) => (
                <div key={g.id}>
                  {deletingGarantiaId === g.id ? (
                    <div className="border border-red-200 bg-red-50 rounded-xl p-3 flex items-center justify-between gap-3">
                      <span className="text-sm text-red-700">Remover este registro?</span>
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => setDeletingGarantiaId(null)}>Não</Button>
                        <Button size="sm" variant="destructive" onClick={() => deleteGarantiaMutation.mutate(g.id)} disabled={deleteGarantiaMutation.isPending}>
                          {deleteGarantiaMutation.isPending ? "..." : "Sim"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="border rounded-xl p-3 bg-white space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm truncate">{g.modelo}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">{g.qualidade}</span>
                            <span className="text-xs text-muted-foreground">Lojista: <strong>{g.lojista}</strong></span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <StatusBadge status={g.status} />
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => setDeletingGarantiaId(g.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2 italic">"{g.motivo}"</p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">{formatDate(g.createdAt)}</span>
                        {g.status === "pendente" && (
                          <div className="flex gap-1.5">
                            <Button size="sm" variant="outline" className="h-7 text-xs text-green-700 border-green-300 hover:bg-green-50"
                              onClick={() => updateStatusMutation.mutate({ id: g.id, status: "trocado" })} disabled={updateStatusMutation.isPending}>
                              <RefreshCw className="w-3 h-3 mr-1" /> Trocado
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 border-red-300 hover:bg-red-50"
                              onClick={() => updateStatusMutation.mutate({ id: g.id, status: "recusado" })} disabled={updateStatusMutation.isPending}>
                              <XCircle className="w-3 h-3 mr-1" /> Recusar
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── ABA HISTÓRICO ──────────────────────────────────────────────── */}
        {aba === "historico" && (
          <>
            <div className="px-4 pt-3 pb-2 shrink-0 space-y-3">
              {/* Filtros de período */}
              <div className="flex gap-1.5">
                {(["dia", "semana", "mes"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriodo(p)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${periodo === p ? "bg-green-600 text-white border-green-600" : "bg-white text-muted-foreground border-border hover:border-green-400"}`}
                  >
                    {p === "dia" ? "Hoje" : p === "semana" ? "Semana" : "Mês"}
                  </button>
                ))}
              </div>

              {/* Card de resumo */}
              {vendasData && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                    <div className="text-2xl font-bold text-green-700">{vendasData.quantidade}</div>
                    <div className="text-xs text-green-600 font-medium">
                      {vendasData.quantidade === 1 ? "peça vendida" : "peças vendidas"}
                    </div>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                    <div className="text-2xl font-bold text-green-700">
                      {vendasData.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </div>
                    <div className="text-xs text-green-600 font-medium">em vendas</div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
              {vendasLoading && <div className="text-center py-8 text-muted-foreground text-sm">Carregando...</div>}
              {!vendasLoading && vendasData?.vendas.length === 0 && (
                <div className="text-center py-10 text-muted-foreground text-sm">
                  <ShoppingBag className="w-8 h-8 mx-auto mb-3 opacity-20" />
                  <p className="font-medium">Nenhuma venda {periodo === "dia" ? "hoje" : periodo === "semana" ? "esta semana" : "este mês"}</p>
                </div>
              )}
              {vendasData?.vendas.map((v) => {
                const hora = new Date(v.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                const dia = new Date(v.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
                const valorFmt = parseFloat(v.valor.replace(",", ".")).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
                return (
                  <div key={v.id} className="border rounded-xl px-3 py-2.5 bg-white flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                      <ShoppingBag className="w-4 h-4 text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">{v.modelo}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">{v.qualidade}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-green-600 text-sm">{valorFmt}</div>
                      <div className="text-xs text-muted-foreground">{periodo === "dia" ? hora : `${dia} ${hora}`}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Card oculto para gerar imagem de compartilhamento */}
        {sharingPeca && (
          <div style={{ position: "fixed", left: "-9999px", top: 0 }}>
            <div ref={shareRef} style={{ width: 480, background: "#ffffff", fontFamily: "Inter, sans-serif", padding: 32, borderRadius: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28, paddingBottom: 16, borderBottom: "2px solid #2563eb" }}>
                <div style={{ width: 44, height: 44, background: "#2563eb", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 18, color: "#111827" }}>Ismael Cell</div>
                  <div style={{ fontSize: 13, color: "#6b7280" }}>Preço para Revenda</div>
                </div>
              </div>
              <div style={{ background: "#f0f7ff", borderRadius: 12, padding: "20px 24px", marginBottom: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 22, color: "#111827", marginBottom: 6 }}>{sharingPeca.modelo}</div>
                <div style={{ display: "inline-block", background: "#dbeafe", color: "#1d4ed8", fontSize: 13, fontWeight: 600, padding: "3px 12px", borderRadius: 20 }}>
                  LINHA-{sharingPeca.qualidade.toUpperCase()}
                </div>
              </div>
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 4 }}>Valor</div>
                <div style={{ fontWeight: 800, fontSize: 40, color: "#16a34a", letterSpacing: "-1px" }}>{formatMoney(sharingPeca.valor)}</div>
              </div>
              <div style={{ paddingTop: 14, borderTop: "1px solid #e5e7eb", fontSize: 12, color: "#9ca3af", textAlign: "center" }}>
                Ismael Cell · Assistência Técnica · {shareDate}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
