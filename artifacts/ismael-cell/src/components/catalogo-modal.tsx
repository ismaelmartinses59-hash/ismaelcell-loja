import { useState, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Pencil, Trash2, Check, X, Share2, Package, AlertTriangle } from "lucide-react";
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
    let preco = c <= 55 ? c + 25 : c <= 80 ? c + 35 : c + 50;
    preco = Math.round(preco / 5) * 5;
    setPrecoSugerido(preco);
  };

  const aplicarSugestao = () => {
    if (precoSugerido !== null) {
      setValor(String(precoSugerido).replace(".", ","));
    }
  };

  const submit = () => {
    if (!modelo.trim() || !qualidade || !valor.trim()) return;
    const qtd = parseInt(quantidade) || 0;
    if (qtd < 1) return;
    onSave({ modelo: modelo.trim(), qualidade, valor: valor.trim(), quantidade: qtd });
  };

  // Troca as opções de qualidade de acordo com o modelo digitado
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
            onChange={(e) => {
              setModelo(e.target.value);
              setQualidade("");
            }}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Qualidade</label>
          <Select value={qualidade} onValueChange={setQualidade}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {qualidadesAtivas.map((q) => (
                <SelectItem key={q} value={q}>{q}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Quantidade em Estoque</label>
          <Input
            type="number"
            min={1}
            placeholder="1"
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
          />
        </div>

        {/* Calculadora de preço */}
        <div className="col-span-2 bg-white border border-dashed border-primary/30 rounded-lg p-3 space-y-2">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide">Calculadora de Preço</p>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Meu custo (R$)</label>
              <Input
                placeholder="Ex: 60,00"
                value={custo}
                onChange={(e) => { setCusto(e.target.value); calcularSugestao(e.target.value); }}
              />
            </div>
            {precoSugerido !== null && (
              <button
                type="button"
                onClick={aplicarSugestao}
                className="shrink-0 flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-800 text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
              >
                💡 R$ {precoSugerido} — usar
              </button>
            )}
          </div>
          {precoSugerido !== null && (
            <p className="text-xs text-muted-foreground">
              Margem aplicada: custo {custo} → venda sugerida <strong>R$ {precoSugerido}</strong> (arredondado para R$5)
            </p>
          )}
        </div>

        <div className="col-span-2">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Valor de Venda (R$)</label>
          <Input
            placeholder="120,00"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={loading}>
          <X className="w-4 h-4 mr-1" /> Cancelar
        </Button>
        <Button size="sm" onClick={submit} disabled={loading || !modelo.trim() || !qualidade || !valor.trim() || parseInt(quantidade) < 1}>
          <Check className="w-4 h-4 mr-1" /> {loading ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </div>
  );
}

interface CatalogoModalProps {
  open: boolean;
  onClose: () => void;
}

export function CatalogoModal({ open, onClose }: CatalogoModalProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [sharingPeca, setSharingPeca] = useState<Peca | null>(null);
  const shareRef = useRef<HTMLDivElement>(null);

  const { data: pecas = [], isLoading } = useQuery<Peca[]>({
    queryKey: ["pecas", search],
    queryFn: () => apiFetch(`/api/pecas${search ? `?search=${encodeURIComponent(search)}` : ""}`),
    enabled: open,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["pecas"] });

  const addMutation = useMutation({
    mutationFn: (data: Omit<Peca, "id">) => apiFetch("/api/pecas", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { invalidate(); setShowAdd(false); toast({ title: "Peça adicionada!" }); },
    onError: () => toast({ title: "Erro ao salvar", variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Omit<Peca, "id"> }) =>
      apiFetch(`/api/pecas/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => { invalidate(); setEditingId(null); toast({ title: "Peça atualizada!" }); },
    onError: () => toast({ title: "Erro ao salvar", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/pecas/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); setDeletingId(null); toast({ title: "Peça removida" }); },
    onError: () => toast({ title: "Erro ao remover", variant: "destructive" }),
  });

  const handleShare = useCallback(async (peca: Peca) => {
    setSharingPeca(peca);
    await new Promise((r) => setTimeout(r, 80)); // aguarda render do div oculto
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

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg w-full max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            Catálogo de Peças
          </DialogTitle>

          {/* Low stock alert */}
          {lowStock.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span><strong>{lowStock.length}</strong> {lowStock.length === 1 ? "peça com estoque mínimo" : "peças com estoque mínimo"} (1 unidade — hora de comprar!)</span>
            </div>
          )}
        </DialogHeader>

        <div className="px-4 pt-3 pb-2 shrink-0 space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Buscar modelo ou qualidade..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button size="sm" onClick={() => { setShowAdd(true); setEditingId(null); }}>
              <Plus className="w-4 h-4 mr-1" /> Nova
            </Button>
          </div>

          {showAdd && (
            <PecaForm
              onSave={(data) => addMutation.mutate(data)}
              onCancel={() => setShowAdd(false)}
              loading={addMutation.isPending}
            />
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
          {isLoading && (
            <div className="text-center py-8 text-muted-foreground text-sm">Carregando...</div>
          )}
          {!isLoading && pecas.length === 0 && (
            <div className="text-center py-10 text-muted-foreground text-sm">
              Nenhuma peça cadastrada ainda.
            </div>
          )}
          {pecas.map((peca) => (
            <div key={peca.id}>
              {editingId === peca.id ? (
                <PecaForm
                  initial={peca}
                  onSave={(data) => editMutation.mutate({ id: peca.id, data })}
                  onCancel={() => setEditingId(null)}
                  loading={editMutation.isPending}
                />
              ) : deletingId === peca.id ? (
                <div className="border border-red-200 bg-red-50 rounded-xl p-3 flex items-center justify-between gap-3">
                  <span className="text-sm text-red-700">Remover <strong>{peca.modelo}</strong>?</span>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => setDeletingId(null)}>Não</Button>
                    <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate(peca.id)} disabled={deleteMutation.isPending}>
                      {deleteMutation.isPending ? "..." : "Sim"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className={`border rounded-xl p-3 flex items-center gap-3 bg-white ${peca.quantidade <= 1 ? "border-amber-300 bg-amber-50/40" : ""}`}>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{peca.modelo}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">{peca.qualidade}</span>
                      <span className="text-xs text-muted-foreground font-semibold">{formatMoney(peca.valor)}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-lg font-bold ${peca.quantidade <= 1 ? "text-amber-600" : "text-green-600"}`}>
                      {peca.quantidade}
                    </div>
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
              )}
            </div>
          ))}
        </div>

        {/* Card oculto para gerar imagem de compartilhamento */}
        {sharingPeca && (
          <div style={{ position: "fixed", left: "-9999px", top: 0 }}>
            <div ref={shareRef} style={{
              width: 480,
              background: "#ffffff",
              fontFamily: "Inter, sans-serif",
              padding: 32,
              borderRadius: 16,
            }}>
              {/* Header */}
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

              {/* Peça */}
              <div style={{ background: "#f0f7ff", borderRadius: 12, padding: "20px 24px", marginBottom: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 22, color: "#111827", marginBottom: 6 }}>{sharingPeca.modelo}</div>
                <div style={{ display: "inline-block", background: "#dbeafe", color: "#1d4ed8", fontSize: 13, fontWeight: 600, padding: "3px 12px", borderRadius: 20 }}>
                  {sharingPeca.qualidade}
                </div>
              </div>
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 4 }}>Valor</div>
                <div style={{ fontWeight: 800, fontSize: 40, color: "#16a34a", letterSpacing: "-1px" }}>
                  {formatMoney(sharingPeca.valor)}
                </div>
              </div>

              {/* Footer */}
              <div style={{ paddingTop: 14, borderTop: "1px solid #e5e7eb", fontSize: 12, color: "#9ca3af", textAlign: "center" }}>
                Ismael Cell · Assistência Técnica · {new Date().toLocaleDateString("pt-BR")}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
