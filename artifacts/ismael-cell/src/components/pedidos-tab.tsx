import { useEffect, useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Mic, Square, Plus, Trash2, Check, Share2, Pencil, ShoppingCart, Loader2, ArrowLeft, PackageCheck } from "lucide-react";
import { FORNECEDORES } from "./encomendas-tab";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try {
      const err = await res.json();
      msg = err.error || err.message || msg;
    } catch {
      // Ignore
    }
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

interface PedidoItem {
  id: number;
  modelo: string;
  quantidade: number;
  setor?: string | null;
  qualidade?: string | null;
  observacao?: string | null;
  status: "pendente" | "comprado";
  createdAt: string;
}

interface AudioParsedItem {
  id: string;
  modelo: string;
  quantidade: number;
  setor?: string;
  qualidade?: string;
  observacao?: string;
}

// ── Componentes Internos ───────────────────────────────────────────────────

function PedidoForm({ initial, onSave, onCancel, isSaving }: { initial?: PedidoItem; onSave: (d: any) => void; onCancel: () => void; isSaving: boolean }) {
  const [modelo, setModelo] = useState(initial?.modelo || "");
  const [quantidade, setQuantidade] = useState(String(initial?.quantidade || 1));
  const [setor, setSetor] = useState(initial?.setor || "sem-setor");
  const [qualidade, setQualidade] = useState(initial?.qualidade || "");
  const [observacao, setObservacao] = useState(initial?.observacao || "");

  const submit = () => {
    if (!modelo.trim()) return;
    onSave({
      modelo: modelo.trim(),
      quantidade: parseInt(quantidade, 10) || 1,
      setor: setor === "sem-setor" ? "" : setor,
      qualidade: qualidade.trim(),
      observacao: observacao.trim()
    });
  };

  return (
    <div className="space-y-3 p-4 bg-gray-50 rounded-xl border border-gray-100">
      <div>
        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1 block">Modelo / Peça *</label>
        <Input data-testid="input-pedido-modelo" placeholder="Ex: Tela A03 Core..." value={modelo} onChange={(e) => setModelo(e.target.value)} className="bg-white" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1 block">Quantidade *</label>
          <Input data-testid="input-pedido-quantidade" type="number" min={1} value={quantidade} onChange={(e) => setQuantidade(e.target.value)} className="bg-white" />
        </div>
        <div>
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1 block">Qualidade</label>
          <Input data-testid="input-pedido-qualidade" placeholder="Ex: Original" value={qualidade} onChange={(e) => setQualidade(e.target.value)} className="bg-white" />
        </div>
      </div>
      <div>
        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1 block">Setor</label>
        <Select value={setor} onValueChange={setSetor}>
          <SelectTrigger data-testid="select-pedido-setor" className="bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sem-setor">Não informado</SelectItem>
            <SelectItem value="cliente">Cliente</SelectItem>
            <SelectItem value="lojista">Lojista</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1 block">Observação</label>
        <Textarea data-testid="input-pedido-observacao" placeholder="Detalhes adicionais..." value={observacao} onChange={(e) => setObservacao(e.target.value)} className="h-16 bg-white" />
      </div>
      <div className="flex gap-2 justify-end pt-2">
        <Button data-testid="button-cancelar-pedido" variant="ghost" size="sm" onClick={onCancel} disabled={isSaving}>Cancelar</Button>
        <Button data-testid="button-salvar-pedido" size="sm" onClick={submit} disabled={!modelo.trim() || isSaving} className="bg-blue-600 hover:bg-blue-700 text-white">
          {isSaving ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </div>
  );
}

function AudioPreviewForm({ items, onSave, onCancel }: { items: AudioParsedItem[]; onSave: (items: AudioParsedItem[]) => void; onCancel: () => void; }) {
  const [list, setList] = useState(items);
  
  const update = (id: string, field: string, val: string) => {
    setList(list.map(it => it.id === id ? { ...it, [field]: val } : it));
  };

  const remove = (id: string) => {
    setList(list.filter(it => it.id !== id));
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-gray-800">Itens Reconhecidos</span>
        <Button variant="ghost" size="sm" onClick={onCancel} className="h-8 text-gray-500 hover:text-gray-800">Descartar</Button>
      </div>
      
      <div className="flex-1 overflow-y-auto space-y-3 pb-20">
        {list.map((it) => (
          <div key={it.id} className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm relative">
            <button onClick={() => remove(it.id)} className="absolute top-2 right-2 p-1 text-red-400 hover:text-red-600 bg-red-50 hover:bg-red-100 rounded-md transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <div className="grid grid-cols-[60px_1fr] gap-2 mb-2 pr-8">
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Qtd</label>
                <Input type="number" min={1} value={it.quantidade} onChange={e => update(it.id, 'quantidade', e.target.value)} className="h-8 text-sm font-bold text-center" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Modelo</label>
                <Input value={it.modelo} onChange={e => update(it.id, 'modelo', e.target.value)} className="h-8 text-sm font-semibold" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Input placeholder="Qualidade" value={it.qualidade || ""} onChange={e => update(it.id, 'qualidade', e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <Select value={it.setor || "sem-setor"} onValueChange={(value) => update(it.id, "setor", value === "sem-setor" ? "" : value)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sem-setor">Sem setor</SelectItem>
                    <SelectItem value="cliente">Cliente</SelectItem>
                    <SelectItem value="lojista">Lojista</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-2">
              <Input placeholder="Observação" value={it.observacao || ""} onChange={e => update(it.id, 'observacao', e.target.value)} className="h-8 text-xs" />
            </div>
          </div>
        ))}
        {list.length === 0 && (
          <div className="text-center text-sm text-gray-400 py-8">Nenhum item restante.</div>
        )}
      </div>

      <div className="pt-3 border-t">
        <Button className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-sm" onClick={() => onSave(list)} disabled={list.length === 0}>
          <Check className="w-4 h-4 mr-2 stroke-[3]" /> Salvar {list.length} {list.length === 1 ? 'item' : 'itens'}
        </Button>
      </div>
    </div>
  );
}

function FornecedorSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const fixos = FORNECEDORES.filter((f) => f !== "OUTROS");
  const [escolha, setEscolha] = useState<string>(() => value === "" ? "" : fixos.includes(value) ? value : "OUTROS");
  
  return (
    <div className="space-y-2">
      <Select value={escolha} onValueChange={(v) => { setEscolha(v); onChange(v === "OUTROS" ? "" : v); }}>
        <SelectTrigger className="h-9 bg-white"><SelectValue placeholder="Escolha o fornecedor" /></SelectTrigger>
        <SelectContent>
          {FORNECEDORES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
        </SelectContent>
      </Select>
      {escolha === "OUTROS" && (
        <Input placeholder="Nome do fornecedor" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 bg-white" />
      )}
    </div>
  );
}

function ConvertForm({ selectedItems, onConfirm, onCancel, isConverting }: { selectedItems: PedidoItem[]; onConfirm: (data: any) => void; onCancel: () => void; isConverting: boolean }) {
  const [fornecedor, setFornecedor] = useState("");
  const [formaInvest, setFormaInvest] = useState<"dinheiro" | "pix">("dinheiro");
  const [itemsData, setItemsData] = useState<Record<number, any>>(() => {
    const init: any = {};
    selectedItems.forEach(it => {
      init[it.id] = { qualidade: it.qualidade || "", valorCusto: "", valorCliente: "", valorLojista: "" };
    });
    return init;
  });

  const update = (id: number, field: string, val: string) => {
    setItemsData(prev => ({ ...prev, [id]: { ...prev[id], [field]: val } }));
  };

  const submit = () => {
    if (!fornecedor.trim()) {
      alert("Informe o fornecedor");
      return;
    }
    const invalidItems = selectedItems.filter(it =>
      !itemsData[it.id].valorCusto ||
      !itemsData[it.id].valorCliente ||
      !itemsData[it.id].valorLojista
    );
    if (invalidItems.length > 0) {
      alert("Informe custo, preço de cliente e preço de lojista para todos os itens");
      return;
    }
    
    const itens = selectedItems.map(it => ({
      id: it.id,
      modelo: it.modelo,
      quantidade: it.quantidade,
      qualidade: itemsData[it.id].qualidade,
      valorCusto: itemsData[it.id].valorCusto,
      valorCliente: itemsData[it.id].valorCliente,
      valorLojista: itemsData[it.id].valorLojista,
    }));
    
    onConfirm({
      itemIds: selectedItems.map(i => i.id),
      fornecedor,
      formaInvestimento: formaInvest,
      itens
    });
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full" onClick={onCancel}><ArrowLeft className="w-4 h-4" /></Button>
        <span className="font-bold text-sm text-gray-800">Converter em Encomenda</span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pb-20">
        <div className="space-y-3 bg-gray-50 p-4 rounded-xl border border-gray-100">
          <div>
            <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1 block">Fornecedor *</label>
            <FornecedorSelect value={fornecedor} onChange={setFornecedor} />
          </div>
          <div>
            <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1 block">Forma de Pagamento</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setFormaInvest("dinheiro")} className={`h-9 rounded-lg border text-sm font-semibold transition-colors ${formaInvest === "dinheiro" ? "bg-blue-600 text-white border-blue-600 shadow-sm" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"}`}>Dinheiro</button>
              <button type="button" onClick={() => setFormaInvest("pix")} className={`h-9 rounded-lg border text-sm font-semibold transition-colors ${formaInvest === "pix" ? "bg-blue-600 text-white border-blue-600 shadow-sm" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"}`}>PIX</button>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Preços dos {selectedItems.length} Itens</p>
          {selectedItems.map(it => (
            <div key={it.id} className="p-3 bg-white border border-gray-200 rounded-xl space-y-3 shadow-sm">
              <div className="font-bold text-sm text-gray-800 flex items-center gap-2">
                <span className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded text-xs">{it.quantidade}x</span>
                {it.modelo}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1 block">Custo (R$) *</label>
                  <Input placeholder="Ex: 50,00" value={itemsData[it.id].valorCusto} onChange={e => update(it.id, 'valorCusto', e.target.value)} className="h-8 text-sm" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1 block">Qualidade</label>
                  <Input placeholder="Ex: Original" value={itemsData[it.id].qualidade} onChange={e => update(it.id, 'qualidade', e.target.value)} className="h-8 text-sm" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1 block">Venda Cliente (R$)</label>
                  <Input placeholder="Ex: 120,00" value={itemsData[it.id].valorCliente} onChange={e => update(it.id, 'valorCliente', e.target.value)} className="h-8 text-sm" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1 block">Venda Lojista (R$)</label>
                  <Input placeholder="Ex: 80,00" value={itemsData[it.id].valorLojista} onChange={e => update(it.id, 'valorLojista', e.target.value)} className="h-8 text-sm" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="pt-3 border-t">
        <Button className="w-full h-11 bg-amber-500 hover:bg-amber-600 text-white font-bold shadow-sm" onClick={submit} disabled={isConverting}>
          {isConverting ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <PackageCheck className="w-5 h-5 mr-2" />}
          Confirmar {selectedItems.length} {selectedItems.length === 1 ? 'Encomenda' : 'Encomendas'}
        </Button>
      </div>
    </div>
  );
}

// ── Aba Principal ──────────────────────────────────────────────────────────

export function PedidosTab({ open }: { open: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"pendente" | "comprado" | "todos">("pendente");
  const [mode, setMode] = useState<"list" | "manual-add" | "manual-edit" | "audio-preview" | "convert">("list");
  
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [editingItem, setEditingItem] = useState<PedidoItem | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const [audioItems, setAudioItems] = useState<AudioParsedItem[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (recordingTimeoutRef.current) window.clearTimeout(recordingTimeoutRef.current);
      const recorder = mediaRecorderRef.current;
      if (recorder?.state === "recording") {
        recorder.stream.getTracks().forEach((track) => track.stop());
        recorder.stop();
      }
    };
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["pedidos", filter],
    queryFn: () => apiFetch(`/api/pedidos?status=${filter}`),
    enabled: open && mode === "list",
  });
  
  const pedidos: PedidoItem[] = data?.itens ?? [];

  const createMutation = useMutation({
    mutationFn: (payload: any) => apiFetch("/api/pedidos", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pedidos"] }),
    onError: (error) => toast({ title: "Não foi possível salvar", description: error instanceof Error ? error.message : undefined, variant: "destructive" }),
  });

  const saveBatchMutation = useMutation({
    mutationFn: (items: AudioItem[]) =>
      apiFetch("/api/pedidos/batch", {
        method: "POST",
        body: JSON.stringify({
          itens: items.map((item) => ({
            modelo: item.modelo,
            quantidade: Number(item.quantidade),
            setor: item.setor,
            qualidade: item.qualidade,
            observacao: item.observacao,
          })),
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pedidos"] }),
    onError: (error) =>
      toast({
        title: "Não foi possível salvar a lista",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      }),
  });
  
  const updateMutation = useMutation({
    mutationFn: (payload: { id: number; data: any }) => apiFetch(`/api/pedidos/${payload.id}`, { method: "PATCH", body: JSON.stringify(payload.data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pedidos"] }),
    onError: (error) => toast({ title: "Não foi possível editar", description: error instanceof Error ? error.message : undefined, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/pedidos/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pedidos"] }),
    onError: (error) => toast({ title: "Não foi possível excluir", description: error instanceof Error ? error.message : undefined, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: (payload: { id: number; status: string }) => apiFetch(`/api/pedidos/${payload.id}/status`, { method: "POST", body: JSON.stringify({ status: payload.status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pedidos"] }),
    onError: (error) => toast({ title: "Não foi possível alterar", description: error instanceof Error ? error.message : undefined, variant: "destructive" }),
  });

  const convertMutation = useMutation({
    mutationFn: (payload: any) => apiFetch("/api/pedidos/convert-encomenda", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pedidos"] });
      qc.invalidateQueries({ queryKey: ["encomendas"] });
      setMode("list");
      setSelectedIds(new Set());
      toast({ title: "Convertido", description: "Itens convertidos para Encomenda com sucesso." });
    },
    onError: (error) => toast({ title: "Erro", description: error instanceof Error ? error.message : "Falha ao converter para Encomenda.", variant: "destructive" })
  });

  const startAudio = async () => {
    if (isRecording || isProcessingAudio) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        if (recordingTimeoutRef.current) window.clearTimeout(recordingTimeoutRef.current);
        recordingTimeoutRef.current = null;
        stream.getTracks().forEach(t => t.stop());
        setIsProcessingAudio(true);
        const chunks = [...chunksRef.current];
        chunksRef.current = [];
        const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
        
        try {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const res = reader.result as string;
              resolve(res.split(",")[1]);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          
          const res = await apiFetch("/api/pedidos/audio", {
            method: "POST",
            body: JSON.stringify({ audioBase64: base64, mimeType: mr.mimeType || "audio/webm" })
          });
          
          if (res.itens && res.itens.length > 0) {
            setAudioItems(res.itens.map((it: any) => ({ ...it, id: Math.random().toString() })));
            setMode("audio-preview");
          } else {
            toast({ title: "Aviso", description: "Nenhum item compreendido." });
          }
        } catch (error) {
          toast({
            title: "Erro",
            description: error instanceof Error ? error.message : "Falha ao processar áudio.",
            variant: "destructive",
          });
        } finally {
          setIsProcessingAudio(false);
        }
      };

      mr.start();
      setIsRecording(true);
      recordingTimeoutRef.current = window.setTimeout(() => {
        if (mr.state === "recording") {
          setIsProcessingAudio(true);
          mr.stop();
          setIsRecording(false);
          toast({ title: "Gravação encerrada", description: "O limite de 60 segundos foi atingido." });
        }
      }, 60_000);
    } catch (err) {
      setIsRecording(false);
      setIsProcessingAudio(false);
      toast({ title: "Erro", description: "Não foi possível acessar o microfone", variant: "destructive" });
    }
  };

  const stopAudio = () => {
    if (mediaRecorderRef.current && isRecording) {
      if (recordingTimeoutRef.current) window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
      setIsProcessingAudio(true);
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const shareList = () => {
    const list = pedidos.filter(p => p.status === "pendente");
    if (list.length === 0) {
      toast({ title: "Lista Vazia", description: "Não há pedidos pendentes." });
      return;
    }
    const text = "*Lista de Compras - Ismael Cell*\n\n" + list.map(p => 
      `▪ ${p.quantidade}x ${p.modelo}${p.qualidade ? ` (${p.qualidade})` : ''}${p.setor ? ` - ${p.setor}` : ''}${p.observacao ? `\n   Obs: ${p.observacao}` : ''}`
    ).join("\n\n");
    
    if (navigator.share) {
      navigator.share({ title: "Lista de Compras", text }).catch(()=>{});
    } else {
      navigator.clipboard.writeText(text);
      toast({ title: "Copiado", description: "Copiado para a área de transferência." });
    }
  };

  const toggleSelection = (id: number) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  if (mode === "manual-add") {
    return (
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full" onClick={() => setMode("list")}><ArrowLeft className="w-4 h-4" /></Button>
          <span className="font-bold text-sm text-gray-800">Novo Pedido Manual</span>
        </div>
        <PedidoForm 
          isSaving={createMutation.isPending}
          onSave={async (d) => {
            await createMutation.mutateAsync(d);
            setMode("list");
            toast({ title: "Salvo", description: "Pedido adicionado com sucesso." });
          }}
          onCancel={() => setMode("list")}
        />
      </div>
    );
  }

  if (mode === "manual-edit" && editingItem) {
    return (
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full" onClick={() => setMode("list")}><ArrowLeft className="w-4 h-4" /></Button>
          <span className="font-bold text-sm text-gray-800">Editar Pedido</span>
        </div>
        <PedidoForm 
          initial={editingItem}
          isSaving={updateMutation.isPending}
          onSave={async (d) => {
            await updateMutation.mutateAsync({ id: editingItem.id, data: d });
            setMode("list");
            setEditingItem(null);
            toast({ title: "Salvo", description: "Pedido atualizado." });
          }}
          onCancel={() => { setMode("list"); setEditingItem(null); }}
        />
      </div>
    );
  }

  if (mode === "audio-preview") {
    return (
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-4">
        <AudioPreviewForm 
          items={audioItems}
          onSave={async (items) => {
            try {
              await saveBatchMutation.mutateAsync(items);
              toast({ title: "Sucesso", description: "Itens de áudio salvos." });
              setMode("list");
            } catch {
              // A prévia permanece aberta para o usuário corrigir ou tentar novamente.
            }
          }}
          onCancel={() => setMode("list")}
        />
      </div>
    );
  }

  if (mode === "convert") {
    const selectedList = pedidos.filter(p => selectedIds.has(p.id));
    return (
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-4">
        <ConvertForm 
          selectedItems={selectedList}
          isConverting={convertMutation.isPending}
          onConfirm={async (data) => {
            await convertMutation.mutateAsync(data);
          }}
          onCancel={() => setMode("list")}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50/50">
      <div className="px-4 pt-3 pb-2 space-y-3 bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="flex gap-2">
          <Button 
            className={`flex-1 h-12 text-sm font-bold shadow-sm transition-all ${isRecording ? 'bg-red-500 hover:bg-red-600 animate-pulse text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
            onClick={isRecording ? stopAudio : startAudio}
            disabled={isProcessingAudio}
            data-testid={isRecording ? "btn-stop-audio" : "btn-record-audio"}
          >
            {isProcessingAudio ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : 
             isRecording ? <Square className="w-5 h-5 mr-2 fill-current" /> : <Mic className="w-5 h-5 mr-2" />}
            {isProcessingAudio ? "Processando..." : isRecording ? "Gravando (Parar)" : "Falar Pedidos"}
          </Button>
          <Button 
            variant="outline" 
            className="h-12 w-12 shrink-0 border-gray-200 text-gray-700 shadow-sm bg-white hover:bg-gray-50"
            onClick={() => setMode("manual-add")}
            data-testid="btn-add-pedido"
          >
            <Plus className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex bg-gray-100/80 rounded-lg p-1">
            {(["pendente", "comprado", "todos"] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wide transition-all ${filter === f ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                data-testid={`tab-filter-${f}`}
              >
                {f}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="h-8 px-2 text-gray-500 hover:text-blue-600 font-semibold text-xs" onClick={shareList} data-testid="btn-share-list">
            <Share2 className="w-4 h-4 mr-1.5" /> Compartilhar
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {isLoading ? (
          <div className="text-center py-10 text-muted-foreground text-sm flex flex-col items-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin opacity-50" /> Carregando...
          </div>
        ) : pedidos.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm flex flex-col items-center gap-3">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-1">
              <ShoppingCart className="w-6 h-6 text-gray-300" />
            </div>
            <p className="font-medium text-gray-600">Nenhum pedido encontrado.</p>
            <p className="text-xs opacity-70">Toque em "Falar Pedidos" para adicionar.</p>
          </div>
        ) : (
          pedidos.map(p => {
            const isSelected = selectedIds.has(p.id);
            const isComprado = p.status === "comprado";
            return (
              <div key={p.id} className={`p-3 rounded-xl border transition-all ${isSelected ? 'border-amber-400 bg-amber-50/50 shadow-sm' : isComprado ? 'border-gray-200 bg-gray-50/80' : 'border-gray-200 bg-white shadow-sm'}`}>
                <div className="flex items-start gap-3">
                   {!isComprado && (
                     <button 
                       className={`shrink-0 w-6 h-6 mt-0.5 rounded-md border flex items-center justify-center transition-colors ${isSelected ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-gray-300 text-transparent hover:border-gray-400'}`}
                       onClick={() => toggleSelection(p.id)}
                       data-testid={`check-pedido-${p.id}`}
                     >
                       <Check className="w-4 h-4 stroke-[3]" />
                     </button>
                   )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="font-bold text-gray-800 leading-tight">
                        <span className={`inline-flex items-center justify-center bg-blue-100 text-blue-700 font-extrabold px-1.5 py-0.5 rounded text-sm mr-2 ${isComprado ? 'opacity-60' : ''}`}>{p.quantidade}x</span>
                        <span className={isComprado ? 'line-through text-gray-500' : ''}>{p.modelo}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 bg-gray-100 rounded-lg p-0.5">
                         {!isComprado && <button className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-blue-600 rounded-md transition-colors" onClick={() => { setEditingItem(p); setMode("manual-edit"); }} data-testid={`btn-edit-${p.id}`}><Pencil className="w-3.5 h-3.5" /></button>}
                        <button className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-600 rounded-md transition-colors" onClick={() => {
                          if(confirm("Excluir este pedido?")) deleteMutation.mutate(p.id);
                        }} data-testid={`btn-del-${p.id}`}><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {p.qualidade && <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-[10px] font-semibold">{p.qualidade}</span>}
                      {p.setor && <span className="bg-indigo-50 text-indigo-600 border border-indigo-100 px-1.5 py-0.5 rounded text-[10px] font-semibold">{p.setor}</span>}
                    </div>
                    {p.observacao && <p className="text-[11px] text-gray-500 leading-snug mb-2 italic">Obs: {p.observacao}</p>}

                    <button 
                      onClick={() => statusMutation.mutate({ id: p.id, status: isComprado ? "pendente" : "comprado" })}
                      className={`text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 w-max transition-colors ${isComprado ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      data-testid={`btn-status-${p.id}`}
                    >
                      {isComprado ? <Check className="w-3 h-3" /> : <ShoppingCart className="w-3 h-3" />}
                      {isComprado ? "Comprado" : "Marcar como comprado"}
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {selectedIds.size > 0 && (
        <div className="p-3 bg-white border-t border-gray-200 shadow-[0_-4px_15px_rgba(0,0,0,0.05)] sticky bottom-0 z-20">
          <Button className="w-full h-11 bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm" onClick={() => setMode("convert")} data-testid="btn-convert-encomenda">
            <PackageCheck className="w-5 h-5 mr-2" />
            Converter {selectedIds.size} {selectedIds.size === 1 ? 'item' : 'itens'}
          </Button>
        </div>
      )}
    </div>
  );
}
