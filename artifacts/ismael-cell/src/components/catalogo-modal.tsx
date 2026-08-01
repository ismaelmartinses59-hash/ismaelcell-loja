import { useState, useCallback, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Pencil, Trash2, Check, X, Share2, Package, AlertTriangle, ShieldAlert, Clock, RefreshCw, XCircle, ShoppingBag, HandCoins, DollarSign, User, Store, Wallet, Undo2, CreditCard, Truck, Shuffle, Timer, BookOpen } from "lucide-react";
import { type FormaCartao, type FormaPagamento, TAXAS_CARTAO, LABELS_FORMA, liquidoCartao, isCartaoForma } from "../lib/formas-pagamento";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { generateExtratoBlob } from "@/lib/extrato-image";
import { EncomendasTab, FORNECEDORES } from "@/components/encomendas-tab";

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
  valorCusto?: string;
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

async function apiFetch(path: string, opts?: RequestInit) {
  const r = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const j = await r.json(); msg = j?.error ?? j?.message ?? msg; } catch {}
    throw new Error(msg);
  }
  if (r.status === 204) return null;
  return r.json();
}

// Parse pt-BR money text ("1.234,56" → 1234.56) robustly, matching the backend.
function parsePtBR(val: string | null | undefined): number {
  let s = String(val ?? "").replace(/[^\d.,-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function formatMoney(val: string) {
  const n = parsePtBR(val);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

// Normaliza nome p/ comparação: minúsculo, sem acento, espaços únicos
function normNome(s: string): string {
  return (s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// Considera nomes "parecidos" p/ sugerir juntar numa conta só
function nomeSimilar(a: string, b: string): boolean {
  const x = normNome(a), y = normNome(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 3 && (y.includes(x) || x.includes(y))) return true;
  const xf = x.split(" ")[0], yf = y.split(" ")[0];
  if (xf.length >= 3 && xf === yf) return true;
  return levenshtein(x, y) <= 2 && Math.min(x.length, y.length) >= 4;
}

// ─── Peca Form ────────────────────────────────────────────────────────────────

type FormaInvest = "dinheiro" | "pix";

// Botão dinheiro/pix para dizer como o investimento (custo) foi pago.
function InvestimentoToggle({ value, onChange }: { value: FormaInvest; onChange: (f: FormaInvest) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {(["dinheiro", "pix"] as const).map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => onChange(f)}
          className={`h-9 rounded-lg border text-sm font-semibold transition ${
            value === f
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-white text-muted-foreground border-input hover:bg-muted"
          }`}
        >
          {f === "dinheiro" ? "💵 Dinheiro" : "📱 PIX"}
        </button>
      ))}
    </div>
  );
}

// Destino do cadastro: vai direto pro estoque (já chegou) ou fica aguardando (encomenda).
type Destino = "estoque" | "encomenda";

// Payload de salvar peça — quando destino=encomenda carrega fornecedor + os dois preços.
type PecaSavePayload = Omit<Peca, "id"> & {
  formaInvestimento?: FormaInvest;
  destino?: Destino;
  fornecedor?: string;
  valorCliente?: string;
  valorLojista?: string;
};

// Escolha do fornecedor (lista fixa + OUTROS por texto livre).
function FornecedorSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const fixos = FORNECEDORES.filter((f) => f !== "OUTROS");
  const [escolha, setEscolha] = useState<string>(() =>
    value === "" ? "" : fixos.includes(value) ? value : "OUTROS",
  );
  return (
    <div className="space-y-2">
      <Select
        value={escolha}
        onValueChange={(v) => { setEscolha(v); onChange(v === "OUTROS" ? "" : v); }}
      >
        <SelectTrigger className="h-9"><SelectValue placeholder="Escolha o fornecedor" /></SelectTrigger>
        <SelectContent>
          {FORNECEDORES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
        </SelectContent>
      </Select>
      {escolha === "OUTROS" && (
        <Input placeholder="Nome do fornecedor" value={value} onChange={(e) => onChange(e.target.value)} className="h-9" />
      )}
    </div>
  );
}

// Botão "Já chegou" (estoque) vs "Encomenda" (aguardando).
function DestinoToggle({ value, onChange }: { value: Destino; onChange: (d: Destino) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {([["estoque", "✅ Já chegou"], ["encomenda", "🚚 Encomenda"]] as const).map(([d, label]) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          className={`h-10 rounded-lg border text-sm font-semibold transition ${
            value === d
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-white text-muted-foreground border-input hover:bg-muted"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

interface PecaFormProps {
  initial?: Partial<Peca>;
  onSave: (data: PecaSavePayload) => void;
  onCancel: () => void;
  loading: boolean;
  pedirInvestimento?: boolean;
  existentes?: Peca[];
  onAdicionarEstoque?: (peca: Peca, qtd: number, custo: string, forma: string) => void;
  adicionandoEstoque?: boolean;
}

function PecaForm({ initial, onSave, onCancel, loading, pedirInvestimento, existentes = [], onAdicionarEstoque, adicionandoEstoque }: PecaFormProps) {
  const [modelo, setModelo] = useState(initial?.modelo ?? "");
  const [qualidade, setQualidade] = useState(initial?.qualidade ?? "");
  const [valor, setValor] = useState(initial?.valor ?? "");
  const [quantidade, setQuantidade] = useState(String(initial?.quantidade ?? 1));
  const [custo, setCusto] = useState(initial?.valorCusto ?? "");
  const [precoSugerido, setPrecoSugerido] = useState<number | null>(null);
  // Estado para modo "adicionar ao estoque de existente"
  const [adQtd, setAdQtd] = useState("1");
  const [adCusto, setAdCusto] = useState("");
  const [adForma, setAdForma] = useState<FormaInvest>("dinheiro");
  const [formaInvest, setFormaInvest] = useState<FormaInvest>("dinheiro");
  const [destino, setDestino] = useState<Destino>("estoque");
  const [fornecedor, setFornecedor] = useState("");
  const [valorLojista, setValorLojista] = useState("");

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

  // Bloqueia cadastro de modelo+qualidade duplicado.
  const normalizar = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  const modeloNorm = normalizar(modelo);
  const modeloOriginalNorm = normalizar(initial?.modelo ?? "");
  const isEdicao = !!initial?.id;

  // Duplicado real = mesmo modelo E mesma qualidade já cadastrados
  const duplicada = modeloNorm.length >= 3 && qualidade
    ? existentes.find((p) => {
        if (isEdicao && p.id === initial!.id) return false;
        if (modeloOriginalNorm && normalizar(p.modelo) === modeloOriginalNorm) return false;
        return normalizar(p.modelo) === modeloNorm && p.qualidade === qualidade;
      })
    : undefined;

  // Aviso suave = mesmo modelo mas qualidade diferente (não bloqueia)
  const mesmoModeloOutraQual = modeloNorm.length >= 3 && !duplicada
    ? existentes.filter((p) => {
        if (isEdicao && p.id === initial!.id) return false;
        if (modeloOriginalNorm && normalizar(p.modelo) === modeloOriginalNorm) return false;
        return normalizar(p.modelo) === modeloNorm;
      })
    : [];

  // Sugestões de modelos existentes para o autocomplete
  const modeloSugestoes = modeloNorm.length >= 2 && !duplicada
    ? [...new Map(
        existentes
          .filter((p) => {
            if (isEdicao && p.id === initial!.id) return false;
            const pn = normalizar(p.modelo);
            return pn.includes(modeloNorm) || modeloNorm.includes(pn.slice(0, modeloNorm.length));
          })
          .map((p) => [normalizar(p.modelo), p])
      ).values()]
      .slice(0, 5)
    : [];

    const submit = () => {
      if (duplicada) return;
      if (!modelo.trim() || !qualidade || !valor.trim()) return;
      const qtd = parseInt(quantidade) || 0;
    if (qtd < 1) return;
    if (pedirInvestimento && destino === "encomenda" && (!fornecedor.trim() || !valorLojista.trim())) return;
    onSave({
      modelo: modelo.trim(),
      qualidade,
      valor: valor.trim(),
      valorCusto: custo.trim(),
      quantidade: qtd,
      ...(pedirInvestimento ? { formaInvestimento: formaInvest, destino, fornecedor: fornecedor.trim(), valorLojista: valorLojista.trim() } : {}),
    });
  };
  const lower = modelo.toLowerCase();
  const match = SUGESTOES_QUALIDADE.find((s) => lower.includes(s.palavra));
  const qualidadesAtivas = match ? match.opcoes : QUALIDADES;

  return (
    <div className="bg-muted/40 rounded-xl p-4 space-y-3 border">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Modelo / Peça</label>
          <div className="relative">
            <Input
              placeholder="Ex: Tela A03 Core, Bateria S21..."
              value={modelo}
              onChange={(e) => { setModelo(e.target.value); setQualidade(""); }}
            />
            {modeloSugestoes.length > 0 && (
              <div className="absolute z-50 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg overflow-hidden">
                {modeloSugestoes.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { setModelo(p.modelo); setQualidade(p.qualidade); }}
                    className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between gap-2"
                  >
                    <span className="text-xs font-medium">{p.modelo}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0">{p.qualidade} · {p.quantidade} un.</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {duplicada && (
            <div className="mt-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 space-y-2">
              <div className="flex items-center gap-1.5">
                <Package className="w-4 h-4 text-blue-600 shrink-0" />
                <p className="text-xs text-blue-800 font-semibold">
                  {duplicada.modelo} — {duplicada.qualidade} já tem {duplicada.quantidade} un. em estoque.
                </p>
              </div>
              <p className="text-[11px] text-blue-700">Adicionar mais unidades a essa peça:</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-medium text-blue-700">Qtd a adicionar</label>
                  <Input type="number" min={1} value={adQtd} onChange={(e) => setAdQtd(e.target.value)} className="h-8 text-sm mt-0.5" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-blue-700">Custo unit. (R$)</label>
                  <Input inputMode="decimal" placeholder="Ex: 60,00" value={adCusto} onChange={(e) => setAdCusto(e.target.value)} className="h-8 text-sm mt-0.5" />
                </div>
              </div>
              {adCusto.trim() && (
                <div>
                  <label className="text-[10px] font-medium text-blue-700 mb-1 block">Paguei em</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(["dinheiro", "pix"] as FormaInvest[]).map((f) => (
                      <button key={f} type="button" onClick={() => setAdForma(f)}
                        className={`flex items-center justify-center gap-1 rounded-lg border py-1 text-xs font-semibold transition-colors ${adForma === f ? "bg-blue-600 text-white border-blue-600" : "bg-white text-blue-700 border-blue-300 hover:bg-blue-50"}`}>
                        {f === "dinheiro" ? "💵 Dinheiro" : "📲 PIX"}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-blue-600 mt-1">Vai lançar o custo como saída no caixa.</p>
                </div>
              )}
              <button
                type="button"
                disabled={adicionandoEstoque}
                onClick={() => onAdicionarEstoque?.(duplicada, parseInt(adQtd) || 1, adCusto.trim(), adCusto.trim() ? adForma : "")}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {adicionandoEstoque ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Salvando...</> : <>📦 Adicionar {adQtd || 1} un. ao estoque</>}
              </button>
            </div>
          )}
          {mesmoModeloOutraQual.length > 0 && (
            <div className="mt-1.5 flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
              <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">
                <b>Já existe este modelo no estoque</b> com outra qualidade:{" "}
                {mesmoModeloOutraQual.map((p) => `${p.qualidade} (${p.quantidade} un.)`).join(", ")}.
                Você pode cadastrar uma qualidade diferente.
              </p>
            </div>
          )}
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
          {pedirInvestimento && (
            <div className="pt-1 border-t border-dashed border-primary/20 space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Paguei esse custo em</label>
                <InvestimentoToggle value={formaInvest} onChange={setFormaInvest} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Esse pedido chegou?</label>
                <DestinoToggle value={destino} onChange={setDestino} />
              </div>
              {destino === "encomenda" ? (
                <div className="space-y-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                  <p className="text-[11px] text-amber-700 font-medium">A saída será lançada no caixa quando você confirmar a chegada.</p>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Fornecedor</label>
                    <FornecedorSelect value={fornecedor} onChange={setFornecedor} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Preço lojista (R$)</label>
                    <Input placeholder="Ex: 85,00" value={valorLojista} onChange={(e) => setValorLojista(e.target.value)} className="h-9" />
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">Vai lançar o custo como <b>saída</b> no caixa agora.</p>
              )}
            </div>
          )}
        </div>
        <div className="col-span-2">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Valor de Venda (R$)</label>
          <Input placeholder="120,00" value={valor} onChange={(e) => setValor(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={loading}><X className="w-4 h-4 mr-1" /> Cancelar</Button>
        <Button size="sm" onClick={submit} disabled={loading || !!duplicada || !modelo.trim() || !qualidade || !valor.trim() || parseInt(quantidade) < 1 || (pedirInvestimento && destino === "encomenda" && (!fornecedor.trim() || !valorLojista.trim()))}>
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

// ─── Preview Lojista Dialog ───────────────────────────────────────────────────

interface PreviewLojistaDialogProps {
  open: boolean;
  data: Omit<Peca, "id"> | null;
  onConfirm: (precoLojista: string) => void;
  onCancel: () => void;
  onVoltar: () => void;
  loading: boolean;
}

function sugestaoPrecoLojista(custoStr: string): string {
  const c = parseFloat((custoStr ?? "").replace(",", "."));
  if (isNaN(c) || c <= 0) return "";
  let preco = c * 1.7;
  preco = Math.round(preco / 5) * 5;
  return String(preco).replace(".", ",");
}

function PreviewLojistaDialog({ open, data, onConfirm, onCancel, onVoltar, loading }: PreviewLojistaDialogProps) {
  const [precoLojista, setPrecoLojista] = useState("");
  const sugestao = data ? sugestaoPrecoLojista(data.valorCusto ?? "") : "";

  useEffect(() => {
    if (open && data) {
      const s = sugestaoPrecoLojista(data.valorCusto ?? "");
      setPrecoLojista(s);
    }
  }, [open, data]);

  if (!data) return null;

  const podeConfirmar = precoLojista.trim().length > 0 && !loading;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !loading) onCancel(); }}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white px-5 py-4">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Store className="w-5 h-5" />
              Cadastrar também no Lojista?
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-blue-100 mt-1">
            Vamos criar a peça gêmea no setor Lojista. Só falta o preço.
          </p>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-muted/40 rounded-xl border p-3 space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Produto</div>
            <div className="font-semibold text-base">{data.modelo}</div>
            <div className="grid grid-cols-2 gap-2 text-xs pt-1">
              <div className="bg-white border rounded-lg px-2.5 py-1.5">
                <div className="text-[10px] font-medium text-muted-foreground uppercase">Qualidade</div>
                <div className="font-semibold">{data.qualidade}</div>
              </div>
              <div className="bg-white border rounded-lg px-2.5 py-1.5">
                <div className="text-[10px] font-medium text-muted-foreground uppercase">Estoque</div>
                <div className="font-semibold">{data.quantidade} un.</div>
              </div>
              <div className="bg-white border rounded-lg px-2.5 py-1.5">
                <div className="text-[10px] font-medium text-muted-foreground uppercase">Custo</div>
                <div className="font-semibold text-blue-700">
                  {data.valorCusto ? formatMoney(data.valorCusto) : "—"}
                </div>
              </div>
              <div className="bg-white border rounded-lg px-2.5 py-1.5">
                <div className="text-[10px] font-medium text-muted-foreground uppercase">Preço cliente</div>
                <div className="font-semibold text-green-700">{formatMoney(data.valor)}</div>
              </div>
            </div>
          </div>

          <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-3 space-y-2">
            <label className="text-xs font-bold uppercase tracking-wide text-amber-800 flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5" />
              Preço lojista (R$)
            </label>
            <Input
              autoFocus
              placeholder="Ex: 85,00"
              value={precoLojista}
              onChange={(e) => setPrecoLojista(e.target.value)}
              className="bg-white text-base font-semibold"
            />
            {sugestao && (
              <button
                type="button"
                onClick={() => setPrecoLojista(sugestao)}
                className="text-xs text-amber-800 hover:text-amber-900 underline"
              >
                💡 Sugestão baseada no custo: R$ {sugestao}
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2 pt-1">
            <Button
              size="lg"
              className="w-full bg-blue-600 hover:bg-blue-700"
              onClick={() => onConfirm(precoLojista.trim())}
              disabled={!podeConfirmar}
            >
              <Check className="w-4 h-4 mr-1.5" />
              {loading ? "Salvando..." : "Confirmar e salvar nos dois"}
            </Button>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={onVoltar} disabled={loading}>
                <Pencil className="w-3.5 h-3.5 mr-1" /> Voltar e editar
              </Button>
              <Button size="sm" variant="ghost" className="flex-1 text-muted-foreground" onClick={onCancel} disabled={loading}>
                <X className="w-3.5 h-3.5 mr-1" /> Cancelar
              </Button>
            </div>
          </div>
        </div>

      </DialogContent>
    </Dialog>
  );
}

// ─── Importar Nota do Fornecedor ──────────────────────────────────────────────

interface ImportRow {
  modelo: string;
  qualidade: string;
  quantidade: string;
  valorCusto: string;
  valorCliente: string;
  valorLojista: string;
}

// Sugere o preço de venda ao CLIENTE a partir do custo (mesma regra do PecaForm).
function sugestaoPrecoCliente(custoStr: string): string {
  const c = parseFloat((custoStr ?? "").replace(",", "."));
  if (isNaN(c) || c <= 0) return "";
  const maoDeObra = c <= 90 ? 40 : 30;
  const preco = Math.round((c * 2 + maoDeObra) / 5) * 5;
  return String(preco).replace(".", ",");
}

interface ImportarNotaDialogProps {
  open: boolean;
  itensIniciais: ImportRow[];
  pecasExistentes: { modelo: string; qualidade: string }[];
  precosExistentes: Record<string, { cliente?: string; lojista?: string }>;
  onConfirm: (rows: ImportRow[], formaInvestimento: FormaInvest, destino: Destino, fornecedor: string) => void;
  onClose: () => void;
  loading: boolean;
}

function ImportarNotaDialog({ open, itensIniciais, pecasExistentes, precosExistentes, onConfirm, onClose, loading }: ImportarNotaDialogProps) {
  const [rows, setRows] = useState<ImportRow[]>(itensIniciais);
  const [formaInvest, setFormaInvest] = useState<FormaInvest>("dinheiro");
    // "Esse pedido chegou?" — estoque (já chegou) ou encomenda (a caminho)
    const [destino, setDestino] = useState<Destino>("estoque");
    const [fornecedor, setFornecedor] = useState("");
  const totalCusto = rows.reduce((s, r) => s + parsePtBR(r.valorCusto) * (parseInt(r.quantidade) || 0), 0);

  // Nomes de modelos já cadastrados (sem repetir) para o autocomplete.
  const modelosSugeridos = [...new Set(pecasExistentes.map((p) => p.modelo.trim()).filter(Boolean))].sort();
  // Chave modelo+qualidade (normalizada) do que já existe, para avisar quando vai somar no estoque.
  const chavesExistentes = new Set(
    pecasExistentes.map((p) => `${p.modelo.toLowerCase().trim()}|${p.qualidade}`),
  );
  const jaCadastrada = (r: ImportRow) =>
    !!r.modelo.trim() && !!r.qualidade && chavesExistentes.has(`${r.modelo.toLowerCase().trim()}|${r.qualidade}`);

  // Índice da linha cujo campo "Modelo" está em foco (para mostrar as sugestões).
  // datalist não funciona no Safari do iPhone, então usamos um dropdown próprio.
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const sugestoesPara = (texto: string): string[] => {
    const q = texto.toLowerCase().trim();
    if (!q) return [];
    return modelosSugeridos
      .filter((m) => m.toLowerCase().includes(q) && m.toLowerCase() !== q)
      .slice(0, 6);
  };

  useEffect(() => {
    if (open) setRows(itensIniciais);
  }, [open, itensIniciais]);

  const update = (i: number, patch: Partial<ImportRow>) => {
    setRows((cur) => cur.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  // Igual ao update, mas ao mudar modelo/qualidade puxa o último preço do sistema (se a peça já existir).
  const updateComPreco = (i: number, patch: Partial<ImportRow>) => {
    setRows((cur) =>
      cur.map((r, idx) => {
        if (idx !== i) return r;
        const next = { ...r, ...patch };
        const pe = precosExistentes[`${next.modelo.toLowerCase().trim()}|${next.qualidade}`];
        if (pe?.cliente) next.valorCliente = pe.cliente;
        if (pe?.lojista) next.valorLojista = pe.lojista;
        return next;
      }),
    );
  };
  const remove = (i: number) => setRows((cur) => cur.filter((_, idx) => idx !== i));

  const rowValida = (r: ImportRow) =>
    r.modelo.trim() && r.qualidade && r.valorCliente.trim() && r.valorLojista.trim() && (parseInt(r.quantidade) || 0) >= 1;
  const todasValidas = rows.length > 0 && rows.every(rowValida);
  const faltando = rows.filter((r) => !rowValida(r)).length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !loading) onClose(); }}>
      <DialogContent className="max-w-lg p-0 overflow-hidden flex flex-col max-h-[92vh]">
        <div className="bg-gradient-to-br from-emerald-600 to-teal-700 text-white px-5 py-4 shrink-0">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Package className="w-5 h-5" />
              Conferir peças da nota
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-emerald-100 mt-1">
            Li a nota do fornecedor. Confira cada peça, ajuste a qualidade e os preços, depois cadastre tudo de uma vez.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {rows.length === 0 && (
            <div className="text-center py-10 text-muted-foreground text-sm">
              Nenhuma peça para cadastrar.
            </div>
          )}
          {rows.map((r, i) => {
            const lower = r.modelo.toLowerCase();
            const match = SUGESTOES_QUALIDADE.find((s) => lower.includes(s.palavra));
            const qualidadesAtivas = match ? match.opcoes : QUALIDADES;
            const sugCliente = sugestaoPrecoCliente(r.valorCusto);
            const sugLojista = sugestaoPrecoLojista(r.valorCusto);
            return (
              <div key={i} className={`rounded-xl border p-3 space-y-2.5 ${rowValida(r) ? "bg-white" : "bg-amber-50/50 border-amber-300"}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0 relative">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase mb-1 block">Modelo / Peça</label>
                    <Input
                      value={r.modelo}
                      onChange={(e) => updateComPreco(i, { modelo: e.target.value })}
                      onFocus={() => setFocusIdx(i)}
                      onBlur={() => setTimeout(() => setFocusIdx((c) => (c === i ? null : c)), 150)}
                      autoComplete="off"
                      className="h-9"
                    />
                    {focusIdx === i && sugestoesPara(r.modelo).length > 0 && (
                      <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border rounded-lg shadow-lg overflow-hidden max-h-56 overflow-y-auto">
                        <div className="px-3 py-1.5 text-[10px] uppercase text-muted-foreground bg-muted/40">Já cadastrados</div>
                        {sugestoesPara(r.modelo).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onPointerDown={(e) => { e.preventDefault(); updateComPreco(i, { modelo: m }); setFocusIdx(null); }}
                            className="block w-full text-left px-3 py-2.5 text-sm hover:bg-emerald-50 active:bg-emerald-100 border-b last:border-b-0"
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="w-20 shrink-0">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase mb-1 block">Qtd.</label>
                    <Input type="number" min={1} value={r.quantidade} onChange={(e) => update(i, { quantidade: e.target.value })} className="h-9" />
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="shrink-0 mt-5 flex items-center justify-center gap-1 h-9 px-2.5 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 active:scale-95 transition text-xs font-medium"
                    title="Excluir esta peça da lista"
                    aria-label="Excluir esta peça da lista"
                  >
                    <Trash2 className="w-4 h-4" />
                    Excluir
                  </button>
                </div>
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase mb-1 block">Qualidade</label>
                  <Select value={r.qualidade} onValueChange={(v) => updateComPreco(i, { qualidade: v })}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Escolha a qualidade" /></SelectTrigger>
                    <SelectContent>
                      {qualidadesAtivas.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {jaCadastrada(r) && (
                  <div className="rounded-lg bg-green-50 border border-green-200 px-2.5 py-2 text-[11px] text-green-800 flex items-start gap-1.5">
                    <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>Já existe no sistema — vai <b>somar {r.quantidade || 0} no estoque</b> desta peça, sem criar cópia.</span>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase mb-1 block">Custo</label>
                    <Input
                      placeholder="—"
                      value={r.valorCusto}
                      onChange={(e) => update(i, { valorCusto: e.target.value })}
                      className="h-9"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-green-700 uppercase mb-1 block">Cliente</label>
                    <Input
                      placeholder="0,00"
                      value={r.valorCliente}
                      onChange={(e) => update(i, { valorCliente: e.target.value })}
                      className="h-9"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-blue-700 uppercase mb-1 block">Lojista</label>
                    <Input
                      placeholder="0,00"
                      value={r.valorLojista}
                      onChange={(e) => update(i, { valorLojista: e.target.value })}
                      className="h-9"
                    />
                  </div>
                </div>
                {(sugCliente || sugLojista) && (
                  <button
                    type="button"
                    onClick={() => update(i, {
                      valorCliente: r.valorCliente.trim() || sugCliente,
                      valorLojista: r.valorLojista.trim() || sugLojista,
                    })}
                    className="text-[11px] text-emerald-700 hover:text-emerald-900 underline"
                  >
                    💡 Sugerir preços pelo custo{sugCliente ? ` (cliente R$ ${sugCliente}` : ""}{sugLojista ? `${sugCliente ? " · " : " ("}lojista R$ ${sugLojista})` : sugCliente ? ")" : ""}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t p-4 space-y-2 shrink-0 bg-white">
          <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Esse pedido chegou?</label>
              <DestinoToggle value={destino} onChange={setDestino} />
            </div>
            {destino === "encomenda" && (
              <div className="space-y-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                <p className="text-[11px] text-amber-700 font-medium">🚚 Vai pra aba A Caminho. A saída será lançada no caixa quando você confirmar a chegada.</p>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Fornecedor</label>
                  <FornecedorSelect value={fornecedor} onChange={setFornecedor} />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground block mb-1">Vou pagar em</label>
                  <InvestimentoToggle value={formaInvest} onChange={setFormaInvest} />
                </div>
              </div>
            )}
          {totalCusto > 0 && destino === "estoque" && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-red-700 font-medium">Investimento (vai pra saída)</span>
                <span className="font-bold text-red-700">{totalCusto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>
              </div>
              <label className="text-[11px] font-medium text-muted-foreground block">Paguei em</label>
              <InvestimentoToggle value={formaInvest} onChange={setFormaInvest} />
            </div>
          )}
          {!todasValidas && rows.length > 0 && (
            <p className="text-xs text-amber-700 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {faltando} {faltando === 1 ? "peça precisa" : "peças precisam"} de qualidade e os dois preços.
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={onClose} disabled={loading}>
              <X className="w-4 h-4 mr-1" /> Cancelar
            </Button>
            <Button
              className="flex-1 bg-emerald-600 hover:bg-emerald-700"
              onClick={() => onConfirm(rows, formaInvest, destino, fornecedor)}
              /* encomenda exige fornecedor */
              disabled={!todasValidas || loading || (destino === "encomenda" && !fornecedor.trim())}
            >
              <Check className="w-4 h-4 mr-1" />
              {loading ? "Cadastrando..." : destino === "encomenda" ? `Criar encomenda (${rows.length})` : `Cadastrar ${rows.length} ${rows.length === 1 ? "peça" : "peças"}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

interface CatalogoModalProps {
  open: boolean;
  onClose: () => void;
  setor: "cliente" | "lojista";
  initialTab?: "pecas" | "garantias" | "historico" | "receber" | "encomendas" | "espera";
  soloTab?: boolean;
}

export function CatalogoModal({ open, onClose, setor, initialTab, soloTab }: CatalogoModalProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [aba, setAba] = useState<"pecas" | "garantias" | "historico" | "receber" | "encomendas" | "espera">(initialTab ?? "pecas");
  useEffect(() => { if (open && initialTab) setAba(initialTab); }, [open, initialTab]);
  useEffect(() => {
    if (!open) {
      setSearch("");
      setShowAdd(false);
      setEditingId(null);
      setDeletingId(null);
      setExpandedId(null);
      setPreviewData(null);
      setVenderDialogPeca(null);
      setDevolverDialogPeca(null);
      setAddItemContaId(null);
      setItemDescricao("");
      setItemValor("");
      setItemForma("fiado");
      setMistoSplits([]);
      setMistoForma("dinheiro");
      setMistoValor("");
      setShowNovoServico(false);
      setServNome("");
      setServDescricao("");
      setServValor("");
    }
  }, [open]);
  const [venderDialogPeca, setVenderDialogPeca] = useState<Peca | null>(null);
  const [fiadoNome, setFiadoNome] = useState("");
  const [fiadoTipo, setFiadoTipo] = useState<"cliente" | "lojista">("cliente");
  const [fiadoStep, setFiadoStep] = useState<"choose" | "fiado" | "cartao" | "credito" | "avista" | "misto">("choose");
  const [mistoSplits, setMistoSplits] = useState<Array<{ forma: string; valor: string }>>([]);
  const [mistoForma, setMistoForma] = useState<string>("dinheiro");
  const [mistoValor, setMistoValor] = useState<string>("");
  const [pagandoContaId, setPagandoContaId] = useState<number | null>(null);
  const [pagamentoValor, setPagamentoValor] = useState("");
  const [pagamentoForma, setPagamentoForma] = useState<FormaPagamento>("dinheiro");
  const [expandedContaId, setExpandedContaId] = useState<number | null>(null);
  const [deletingContaId, setDeletingContaId] = useState<number | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<number | null>(null);
  const [deletingPagamentoId, setDeletingPagamentoId] = useState<number | null>(null);
  const [periodo, setPeriodo] = useState<"dia" | "semana" | "mes">("dia");
  // Adicionar serviço/item a uma conta existente
  const [addItemContaId, setAddItemContaId] = useState<number | null>(null);
  const [itemDescricao, setItemDescricao] = useState("");
  const [itemValor, setItemValor] = useState("");
  const [itemForma, setItemForma] = useState<string>("fiado");
  // Novo serviço fiado (cria/reusa conta)
  const [showNovoServico, setShowNovoServico] = useState(false);
  const [servNome, setServNome] = useState("");
  const [servTipo, setServTipo] = useState<"cliente" | "lojista">("cliente");
  const [servDescricao, setServDescricao] = useState("");
  const [servValor, setServValor] = useState("");
    // Peça do estoque vinculada ao novo serviço fiado (dá baixa ao lançar)
    const [servPecaSel, setServPecaSel] = useState<Peca | null>(null);

  // Peças state
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sharingPeca, setSharingPeca] = useState<Peca | null>(null);
  const [shareDate, setShareDate] = useState("");
  const [sharePreview, setSharePreview] = useState<{ url: string; file: File; modelo: string } | null>(null);
  const [generatingShare, setGeneratingShare] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);
  const html2canvasRef = useRef<typeof import("html2canvas").default | null>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);

  // Revoga o object URL do preview anterior quando troca ou desmonta (evita leak).
  useEffect(() => {
    return () => { if (sharePreview) URL.revokeObjectURL(sharePreview.url); };
  }, [sharePreview]);

  // Pré-carrega html2canvas e a imagem de fundo assim que o modal abre,
  // para que o clique em "compartilhar" não perca o gesto do usuário (iOS).
  useEffect(() => {
    if (!open) return;
    import("html2canvas").then((m) => { html2canvasRef.current = m.default; });
    if (setor === "cliente" && !bgImgRef.current) {
      const img = new Image();
      img.src = `${BASE}/share-bg-cliente.png`;
      bgImgRef.current = img;
    }
  }, [open, setor]);

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

  // Lista completa do setor (sem filtro de busca) para calcular totais
  const { data: pecasTodas = [] } = useQuery<Peca[]>({
    queryKey: ["pecas", setor, ""],
    queryFn: () => apiFetch(`/api/pecas?setor=${setor}`),
    enabled: open,
  });

  // Peças dos DOIS setores, para saber o preço atual (cliente + lojista) de cada modelo já cadastrado.
  const { data: pecasClienteAll = [] } = useQuery<Peca[]>({
    queryKey: ["pecas", "cliente", ""],
    queryFn: () => apiFetch(`/api/pecas?setor=cliente`),
    enabled: open,
  });
  const { data: pecasLojistaAll = [] } = useQuery<Peca[]>({
    queryKey: ["pecas", "lojista", ""],
    queryFn: () => apiFetch(`/api/pecas?setor=lojista`),
    enabled: open,
  });

  // Preço atual de cada peça já cadastrada (por modelo+qualidade), p/ pré-preencher na importação.
  // Se houver linhas duplicadas do mesmo modelo/qualidade, usa o MAIS RECENTE (maior id) = último preço salvo.
  const precosExistentes: Record<string, { cliente?: string; lojista?: string }> = {};
  const idCliente: Record<string, number> = {};
  const idLojista: Record<string, number> = {};
  for (const p of pecasClienteAll) {
    const k = `${p.modelo.toLowerCase().trim()}|${p.qualidade}`;
    if (idCliente[k] === undefined || p.id > idCliente[k]) {
      (precosExistentes[k] ??= {}).cliente = p.valor;
      idCliente[k] = p.id;
    }
  }
  for (const p of pecasLojistaAll) {
    const k = `${p.modelo.toLowerCase().trim()}|${p.qualidade}`;
    if (idLojista[k] === undefined || p.id > idLojista[k]) {
      (precosExistentes[k] ??= {}).lojista = p.valor;
      idLojista[k] = p.id;
    }
  }

  const totaisEstoque = pecasTodas.reduce(
    (acc, p) => {
      const custo = parseFloat((p.valorCusto ?? "").replace(",", "."));
      const venda = parseFloat((p.valor ?? "").replace(",", "."));
      const qtd = p.quantidade || 0;
      if (!isNaN(custo)) acc.custo += custo * qtd;
      if (!isNaN(venda)) acc.venda += venda * qtd;
      return acc;
    },
    { custo: 0, venda: 0 },
  );
  const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

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

  const invalidatePecas = () => {
      qc.invalidateQueries({ queryKey: ["pecas"] });
      qc.invalidateQueries({ queryKey: ["caixa-pecas"] });
    };
  const invalidateVendas = () => qc.invalidateQueries({ queryKey: ["vendas"] });
  const [deletingVendaId, setDeletingVendaId] = useState<number | null>(null);
  const deleteVendaMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/vendas/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidateVendas(); invalidatePecas(); setDeletingVendaId(null); toast({ title: "Venda apagada" }); },
    onError: () => toast({ title: "Erro ao apagar venda", variant: "destructive" }),
  });
  const invalidateGarantias = () => qc.invalidateQueries({ queryKey: ["garantias-peca"] });

  // ── Importar nota do fornecedor ───────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importReading, setImportReading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importSaving, setImportSaving] = useState(false);

  const handleNotaFile = async (file: File) => {
    setImportReading(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read"));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
      const resp = await apiFetch("/api/pecas/importar-nota", {
        method: "POST",
        body: JSON.stringify({ fileBase64: base64, mimeType: file.type }),
      });
      const itens = (resp?.itens ?? []) as Array<{ modelo: string; quantidade: number; custo: string; qualidade: string }>;
      if (itens.length === 0) {
        toast({ title: "Nenhuma peça encontrada", description: "Tente uma foto mais nítida da nota.", variant: "destructive" });
        return;
      }
      const rows: ImportRow[] = itens.map((it) => {
        const custo = (it.custo ?? "").replace(".", ",");
        const modelo = it.modelo ?? "";
        const qualidade = it.qualidade ?? "";
        // Se a peça já existe no sistema, usa o último preço cadastrado; senão, sugere pelo custo.
        const pe = precosExistentes[`${modelo.toLowerCase().trim()}|${qualidade}`];
        return {
          modelo,
          qualidade,
          quantidade: String(it.quantidade ?? 1),
          valorCusto: custo,
          valorCliente: pe?.cliente || sugestaoPrecoCliente(custo),
          valorLojista: pe?.lojista || sugestaoPrecoLojista(custo),
        };
      });
      setImportRows(rows);
      setImportOpen(true);
    } catch {
      toast({ title: "Não consegui ler a nota", description: "Tente novamente com outra foto ou PDF.", variant: "destructive" });
    } finally {
      setImportReading(false);
    }
  };

  const confirmImport = async (rows: ImportRow[], formaInvestimento: FormaInvest, destino: Destino, fornecedor: string) => {
    setImportSaving(true);
      try {
        if (destino === "encomenda") {
          await apiFetch("/api/encomendas", {
            method: "POST",
            body: JSON.stringify({
              fornecedor: fornecedor.trim(),
              formaInvestimento,
              itens: rows.map((r) => ({
                modelo: r.modelo.trim(),
                qualidade: r.qualidade,
                quantidade: parseInt(r.quantidade) || 0,
                valorCusto: r.valorCusto.trim(),
                valorCliente: r.valorCliente.trim(),
                valorLojista: r.valorLojista.trim(),
              })),
            }),
          });
          qc.invalidateQueries({ queryKey: ["encomendas"] });
          setImportOpen(false);
          setImportRows([]);
          toast({ title: "🚚 Encomenda criada!", description: `${rows.length} ${rows.length === 1 ? "peça" : "peças"} na aba A Caminho. Confirme quando chegar.` });
          return;
        }
        const resp = await apiFetch("/api/pecas/importar/confirmar", {
        method: "POST",
        body: JSON.stringify({
          formaInvestimento,
          itens: rows.map((r) => ({
            modelo: r.modelo.trim(),
            qualidade: r.qualidade,
            quantidade: parseInt(r.quantidade) || 0,
            valorCusto: r.valorCusto.trim(),
            valorCliente: r.valorCliente.trim(),
            valorLojista: r.valorLojista.trim(),
          })),
        }),
      });
      invalidatePecas();
      setImportOpen(false);
      setImportRows([]);
      const criados = resp?.criados ?? (resp?.cadastrados ?? rows.length);
      const somados = resp?.somados ?? 0;
      const desc = somados > 0
        ? `${criados} nova(s) + ${somados} somada(s) ao estoque que já existia.`
        : `${criados} peças adicionadas nos dois setores.`;
      toast({ title: "Peças cadastradas!", description: desc });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Tente novamente.";
      toast({ title: "Erro ao cadastrar", description: msg, variant: "destructive" });
    } finally {
      setImportSaving(false);
    }
  };

  // ── Peça mutations ────────────────────────────────────────────────────────────
  const [previewData, setPreviewData] = useState<(Omit<Peca, "id"> & { formaInvestimento?: FormaInvest }) | null>(null);
  const [savingTwin, setSavingTwin] = useState(false);

  const addMutation = useMutation({
    mutationFn: (data: Omit<Peca, "id"> & { formaInvestimento?: FormaInvest }) => apiFetch("/api/pecas", { method: "POST", body: JSON.stringify({ ...data, setor }) }),
    onSuccess: () => { invalidatePecas(); setShowAdd(false); toast({ title: "Peça adicionada!" }); },
    onError: () => toast({ title: "Erro ao salvar", variant: "destructive" }),
  });

  const criarEncomendaMutation = useMutation({
    mutationFn: (data: PecaSavePayload) =>
      apiFetch("/api/encomendas", {
        method: "POST",
        body: JSON.stringify({
          fornecedor: data.fornecedor ?? "",
            formaInvestimento: data.formaInvestimento,
            itens: [
              {
                modelo: data.modelo,
                qualidade: data.qualidade,
                quantidade: data.quantidade,
                valorCusto: data.valorCusto ?? "",
                valorCliente: data.valor,
                valorLojista: data.valorLojista ?? "",
              },
            ],
        }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["encomendas"] }); setShowAdd(false); },
    onError: (err: unknown) => { const msg = err instanceof Error ? err.message : "Tente novamente."; toast({ title: "Erro ao criar encomenda", description: msg, variant: "destructive" }); },
  });

  const handleAddSubmit = (data: PecaSavePayload) => {
    if (data.destino === "encomenda") {
      criarEncomendaMutation.mutate(data);
      return;
    }
    if (setor === "cliente") {
      setPreviewData(data);
    } else {
      addMutation.mutate(data);
    }
  };

  const confirmTwin = async (precoLojista: string) => {
    if (!previewData) return;
    setSavingTwin(true);
    try {
      await apiFetch("/api/pecas/twin", {
        method: "POST",
        body: JSON.stringify({
          modelo: previewData.modelo,
          qualidade: previewData.qualidade,
          quantidade: previewData.quantidade,
          valorCusto: previewData.valorCusto,
          valorCliente: previewData.valor,
          valorLojista: precoLojista,
          formaInvestimento: previewData.formaInvestimento,
        }),
      });
      invalidatePecas();
      setPreviewData(null);
      setShowAdd(false);
      toast({ title: "Cadastrado nos dois setores!", description: previewData.modelo });
    } catch {
      toast({ title: "Erro ao salvar", description: "Nada foi salvo, tente novamente.", variant: "destructive" });
    } finally {
      setSavingTwin(false);
    }
  };
  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Omit<Peca, "id"> }) =>
      apiFetch(`/api/pecas/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => { invalidatePecas(); setEditingId(null); toast({ title: "Peça atualizada!" }); },
    onError: () => toast({ title: "Erro ao salvar", variant: "destructive" }),
  });
  const adicionarEstoqueMutation = useMutation({
    mutationFn: ({ id, quantidade, valorCusto, formaInvestimento }: { id: number; quantidade: number; valorCusto: string; formaInvestimento: string }) =>
      apiFetch(`/api/pecas/${id}/adicionar-estoque`, { method: "POST", body: JSON.stringify({ quantidade, valorCusto, formaInvestimento }) }),
    onSuccess: (_, vars) => {
      invalidatePecas();
      setShowAdd(false);
      toast({ title: `+${vars.quantidade} un. adicionada${vars.quantidade > 1 ? "s" : ""} ao estoque! 📦` });
    },
    onError: () => toast({ title: "Erro ao adicionar estoque", variant: "destructive" }),
  });
  const deletePecaMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/pecas/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidatePecas(); setDeletingId(null); toast({ title: "Peça removida" }); },
    onError: () => toast({ title: "Erro ao remover", variant: "destructive" }),
  });

  const invalidateContas = () => qc.invalidateQueries({ queryKey: ["contas-receber"] });
  const invalidateCaixa = () => {
    qc.invalidateQueries({ queryKey: ["caixa"] });
    qc.invalidateQueries({ queryKey: ["caixa-sessoes"] });
  };
  const [devolverDialogPeca, setDevolverDialogPeca] = useState<Peca | null>(null);
  const devolverMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/pecas/${id}/devolver`, { method: "POST" }),
    onSuccess: (peca: Peca) => {
      invalidatePecas();
      toast({ title: "Devolvida ao fornecedor", description: `${peca.modelo} — Restam ${peca.quantidade} un.` });
      setDevolverDialogPeca(null);
    },
    onError: () => toast({ title: "Erro ao devolver", variant: "destructive" }),
  });
  const venderMutation = useMutation({
    mutationFn: (args: { id: number; fiado?: boolean; nomeDevedor?: string; tipoDevedor?: string; formaPagamento?: string; splits?: Array<{ forma: string; valor: string }> }) =>
      apiFetch(`/api/pecas/${args.id}/vender`, {
        method: "POST",
        body: JSON.stringify({
          fiado: args.fiado ?? false,
          nomeDevedor: args.nomeDevedor ?? "",
          tipoDevedor: args.tipoDevedor ?? "cliente",
          formaPagamento: args.formaPagamento ?? "dinheiro",
          splits: args.splits ?? null,
        }),
      }),
    onSuccess: (peca: Peca, vars) => {
      invalidatePecas();
      invalidateVendas();
      invalidateCaixa();
      if (vars.fiado) invalidateContas();
      const tipoLabel = vars.fiado
        ? `📒 Fiado p/ ${vars.nomeDevedor}`
        : vars.splits
          ? "✅ Vendida (Misto)"
          : vars.formaPagamento === "pix"
            ? "✅ Vendida no PIX"
            : vars.formaPagamento && vars.formaPagamento !== "dinheiro"
              ? `💳 Vendida no ${LABELS_FORMA[vars.formaPagamento as FormaPagamento]}`
              : "✅ Vendida à vista";
      if (peca.quantidade === 0) {
        toast({ title: `${tipoLabel} — Estoque esgotado.`, description: `${peca.modelo}` });
      } else {
        toast({ title: `${tipoLabel} — Restam ${peca.quantidade} un.`, description: peca.modelo });
      }
      setVenderDialogPeca(null);
      setFiadoNome("");
      setFiadoStep("choose");
      setMistoSplits([]);
      setMistoForma("dinheiro");
      setMistoValor("");
    },
    onError: () => toast({ title: "Erro ao registrar venda", variant: "destructive" }),
  });

  // ── Modo Espera ───────────────────────────────────────────────────────────
  interface PecaEspera {
    id: number; pecaId: number; modelo: string; qualidade: string;
    valor: string; setor: string; status: string; observacao: string; createdAt: string;
  }
  const { data: esperaItems = [], refetch: refetchEspera } = useQuery<PecaEspera[]>({
    queryKey: ["pecas-espera"],
    queryFn: () => apiFetch("/api/espera"),
    enabled: open,
    refetchInterval: open ? 30000 : false,
  });
  const [esperaPagandoId, setEsperaPagandoId] = useState<number | null>(null);
  const [esperaFiadoStep, setEsperaFiadoStep] = useState<"choose" | "avista" | "cartao" | "misto" | "fiado">("choose");
  const [esperaMistoSplits, setEsperaMistoSplits] = useState<Array<{ forma: string; valor: string }>>([]);
  const [esperaMistoForma, setEsperaMistoForma] = useState<string>("dinheiro");
  const [esperaMistoValor, setEsperaMistoValor] = useState<string>("");
  const [esperaFiadoNome, setEsperaFiadoNome] = useState("");
  const [esperaFiadoTipo, setEsperaFiadoTipo] = useState<"cliente" | "lojista">("cliente");
  const esperaMutation = useMutation({
    mutationFn: (args: { pecaId: number; observacao?: string }) =>
      apiFetch("/api/espera", { method: "POST", body: JSON.stringify({ pecaId: args.pecaId, observacao: args.observacao ?? "" }) }),
    onSuccess: () => {
      invalidatePecas();
      qc.invalidateQueries({ queryKey: ["pecas-espera"] });
      setVenderDialogPeca(null);
      setFiadoStep("choose");
      toast({ title: "⏳ Reservado! Aguardando pagamento." });
    },
    onError: () => toast({ title: "Erro ao reservar", variant: "destructive" }),
  });
  const esperaPagarMutation = useMutation({
    mutationFn: (args: { id: number; formaPagamento?: string; splits?: Array<{ forma: string; valor: string }>; fiado?: boolean; nomeDevedor?: string; tipoDevedor?: string }) =>
      apiFetch(`/api/espera/${args.id}/pagar`, { method: "POST", body: JSON.stringify({ formaPagamento: args.formaPagamento, splits: args.splits, fiado: args.fiado, nomeDevedor: args.nomeDevedor, tipoDevedor: args.tipoDevedor }) }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["pecas-espera"] });
      invalidateCaixa();
      invalidateVendas();
      if (vars.fiado) invalidateContas();
      setEsperaPagandoId(null);
      setEsperaFiadoStep("choose");
      setEsperaFiadoNome("");
      setEsperaMistoSplits([]);
      toast({ title: "✅ Pagamento registrado!" });
    },
    onError: () => toast({ title: "Erro ao registrar pagamento", variant: "destructive" }),
  });
  const esperaCancelarMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/espera/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidatePecas();
      qc.invalidateQueries({ queryKey: ["pecas-espera"] });
      toast({ title: "Reserva cancelada — estoque restaurado" });
    },
    onError: () => toast({ title: "Erro ao cancelar", variant: "destructive" }),
  });

  // ── Contas a Receber ──────────────────────────────────────────────────────────
  interface ContaResumo {
    conta: { id: number; nome: string; tipo: string; createdAt: string; closedAt: string | null };
    itens: Array<{ id: number; modelo: string; qualidade: string; valor: string; formaPagamento: string | null; createdAt: string }>;
    pagamentos: Array<{ id: number; valor: string; formaPagamento: string | null; createdAt: string }>;
    totalItens: number;
    totalPago: number;
    saldo: number;
  }
  const { data: contas = [], isLoading: contasLoading } = useQuery<ContaResumo[]>({
    queryKey: ["contas-receber"],
    queryFn: () => apiFetch("/api/contas-receber"),
    enabled: open,
  });
  const pagarMutation = useMutation({
    mutationFn: ({ contaId, valor, formaPagamento }: { contaId: number; valor: string; formaPagamento?: string }) =>
      apiFetch(`/api/contas-receber/${contaId}/pagamento`, { method: "POST", body: JSON.stringify({ valor, formaPagamento: formaPagamento ?? "dinheiro" }) }),
    onSuccess: () => { invalidateContas(); qc.invalidateQueries({ queryKey: ["/api/caixa"] }); setPagandoContaId(null); setPagamentoValor(""); setPagamentoForma("dinheiro"); toast({ title: "💰 Pagamento registrado!" }); },
    onError: () => toast({ title: "Erro ao registrar pagamento", variant: "destructive" }),
  });
  const apagarContaMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/contas-receber/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidateContas(); setDeletingContaId(null); toast({ title: "Conta apagada" }); },
    onError: () => toast({ title: "Erro ao apagar conta", variant: "destructive" }),
  });
  const apagarItemMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/contas-receber/itens/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidateContas(); setDeletingItemId(null); toast({ title: "Item removido" }); },
    onError: () => toast({ title: "Erro ao remover", variant: "destructive" }),
  });
  const apagarPagamentoMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/contas-receber/pagamentos/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidateContas(); qc.invalidateQueries({ queryKey: ["/api/caixa"] }); setDeletingPagamentoId(null); toast({ title: "Pagamento removido" }); },
    onError: () => toast({ title: "Erro ao remover", variant: "destructive" }),
  });
  const addItemMutation = useMutation({
    mutationFn: ({ contaId, descricao, valor, formaPagamento }: { contaId: number; descricao: string; valor: string; formaPagamento: string }) =>
      apiFetch(`/api/contas-receber/${contaId}/item`, { method: "POST", body: JSON.stringify({ descricao, valor, formaPagamento }) }),
    onSuccess: () => { invalidateContas(); setAddItemContaId(null); setItemDescricao(""); setItemValor(""); setItemForma("fiado"); toast({ title: "📒 Serviço adicionado à conta!" }); },
    onError: () => toast({ title: "Erro ao adicionar serviço", variant: "destructive" }),
  });
  const novoServicoMutation = useMutation({
    mutationFn: (data: { nome: string; tipo: string; descricao: string; valor: string }) =>
      apiFetch("/api/contas-receber/novo-servico", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { invalidateContas(); setShowNovoServico(false); setServNome(""); setServDescricao(""); setServValor(""); setServPecaSel(null); toast({ title: "📒 Serviço fiado registrado!" }); },
    onError: () => toast({ title: "Erro ao registrar serviço", variant: "destructive" }),
  });
  const totalAReceber = contas.reduce((a, c) => a + (c.saldo > 0 ? c.saldo : 0), 0);
  const contasAbertas = contas.filter((c) => c.conta.closedAt === null);

  // Sugestão de conta existente ao digitar o nome do devedor (juntar tudo numa nota só)
  const servNomeNorm = normNome(servNome);
  const contaExataServ =
    servNome.trim().length >= 2
      ? contas.find((c) => c.conta.closedAt === null && c.saldo > 0 && c.conta.tipo === servTipo && normNome(c.conta.nome) === servNomeNorm)
      : undefined;
  const contaSugeridaServ =
    !contaExataServ && servNome.trim().length >= 2
      ? contas.find((c) => c.conta.closedAt === null && c.saldo > 0 && c.conta.tipo === servTipo && nomeSimilar(servNome, c.conta.nome))
      : undefined;

    // Sugestões de peças do estoque ao digitar o serviço (ex: "tela do g24" acha "TELA G24")
    const normPecaBusca = (t: string) =>
      t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    const servPecasBase = servTipo === "cliente" ? pecasClienteAll : pecasLojistaAll;
    const servPecaSugestoes = (() => {
      if (servPecaSel) return [];
      const q = normPecaBusca(servDescricao);
      if (q.length < 2) return [];
      const palavras = q.split(" ").filter((w) => w.length >= 2 && !["do", "da", "de"].includes(w));
      if (palavras.length === 0) return [];
      return servPecasBase
        .filter((p) => {
          const m = normPecaBusca(`${p.modelo} ${p.qualidade}`);
          return palavras.every((w) => m.includes(w));
        })
        .slice(0, 5);
    })();

  // Mesmas sugestões para o fluxo de venda FIADO de peça
  const fiadoNomeNorm = normNome(fiadoNome);
  const contaExataFiado =
    fiadoNome.trim().length >= 2
      ? contas.find((c) => c.conta.closedAt === null && c.saldo > 0 && c.conta.tipo === fiadoTipo && normNome(c.conta.nome) === fiadoNomeNorm)
      : undefined;
  const contaSugeridaFiado =
    !contaExataFiado && fiadoNome.trim().length >= 2
      ? contas.find((c) => c.conta.closedAt === null && c.saldo > 0 && c.conta.tipo === fiadoTipo && nomeSimilar(fiadoNome, c.conta.nome))
      : undefined;

  // Compartilhar extrato de débito como IMAGEM (cartão Ismael Cell, gerado dinamicamente)
  const handleShareExtrato = useCallback(async (c: ContaResumo) => {
    setGeneratingShare(true);
    try {
      // Desenha a imagem pixel a pixel (canvas 2D) — sai idêntico em qualquer
      // aparelho. NÃO usa html2canvas (renderiza torto no Safari do iPhone).
      const blob = await generateExtratoBlob({
        nome: c.conta.nome,
        saldo: c.saldo,
        itens: c.itens,
        pagamentos: c.pagamentos,
        totalItens: c.totalItens,
        totalPago: c.totalPago,
      });
      const nomeArq = c.conta.nome.replace(/\s+/g, "-");
      const file = new File([blob], `extrato-${nomeArq}.png`, { type: "image/png" });
      const url = URL.createObjectURL(blob);
      setSharePreview({ url, file, modelo: `Extrato de ${c.conta.nome}` });
      setGeneratingShare(false);
    } catch {
      setGeneratingShare(false);
      toast({ title: "Não foi possível gerar a imagem", variant: "destructive" });
    }
  }, [toast]);

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
  // Etapa 1: gera a imagem (pode demorar). NÃO chama navigator.share aqui
  // porque o iOS exige que share seja chamado num gesto fresco do usuário.
  const handleShare = useCallback(async (peca: Peca) => {
    setShareDate(new Date().toLocaleDateString("pt-BR"));
    setSharingPeca(peca);
    setGeneratingShare(true);
    try {
      const html2canvas = html2canvasRef.current ?? (await import("html2canvas")).default;
      html2canvasRef.current = html2canvas;
      if (setor === "cliente" && bgImgRef.current && !bgImgRef.current.complete) {
        await new Promise((r) => { bgImgRef.current!.onload = r; bgImgRef.current!.onerror = r; });
      }
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const el = shareRef.current;
      if (!el) { setSharingPeca(null); setGeneratingShare(false); return; }
      const canvas = await html2canvas(el, { backgroundColor: setor === "cliente" ? "#000000" : "#ffffff", scale: 1.5, useCORS: true, logging: false });
      canvas.toBlob((blob) => {
        if (!blob) { setSharingPeca(null); setGeneratingShare(false); return; }
        const file = new File([blob], `${peca.modelo.replace(/\s+/g, "-")}.png`, { type: "image/png" });
        const url = URL.createObjectURL(blob);
        setSharePreview({ url, file, modelo: peca.modelo });
        setSharingPeca(null);
        setGeneratingShare(false);
      }, "image/png");
    } catch {
      setSharingPeca(null);
      setGeneratingShare(false);
      toast({ title: "Não foi possível gerar a imagem", variant: "destructive" });
    }
  }, [toast, setor]);

  // Etapa 2: o usuário toca em "Compartilhar" no preview — gesto fresco.
  const confirmShare = useCallback(async () => {
    if (!sharePreview) return;
    const { file, modelo, url } = sharePreview;
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${modelo} — Ismael Cell` });
      } else {
        const a = document.createElement("a");
        a.href = url; a.download = file.name; a.click();
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        const a = document.createElement("a");
        a.href = url; a.download = file.name; a.click();
      }
    }
  }, [sharePreview]);

  const closeSharePreview = useCallback(() => {
    if (sharePreview) URL.revokeObjectURL(sharePreview.url);
    setSharePreview(null);
  }, [sharePreview]);

  const lowStock = pecas.filter((p) => p.quantidade <= 1);
  // Joga as peças ZERADAS (0 em estoque) para o final da lista, sem perder a
  // ordem original entre as demais — assim as que ainda têm estoque ficam no topo.
  const ordenarPorEstoque = (lista: Peca[]) =>
    [...lista].sort((a, b) => (a.quantidade <= 0 ? 1 : 0) - (b.quantidade <= 0 ? 1 : 0));
  const pendentes = garantias.filter((g) => g.status === "pendente");

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg w-full max-h-[90vh] flex flex-col p-0 gap-0">

        {/* Header */}
        <DialogHeader className="px-4 pt-4 pb-0 shrink-0">
          <DialogTitle className="flex items-center gap-2 mb-3">
            {soloTab && aba === "espera"
              ? <><Timer className="w-5 h-5 text-amber-500" /> Modo Espera</>
              : <><Package className="w-5 h-5 text-primary" /> Catálogo de Peças</>
            }
          </DialogTitle>

          {/* Tabs */}
          {!soloTab && (
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
            <button
              onClick={() => setAba("encomendas")}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${aba === "encomendas" ? "bg-white shadow text-blue-600" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Truck className="w-3.5 h-3.5" /> A Caminho
            </button>
            <button
              onClick={() => setAba("espera")}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${aba === "espera" ? "bg-white shadow text-amber-600" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Timer className="w-3.5 h-3.5" />
              Espera
              {esperaItems.filter(e => e.status === "aguardando").length > 0 && (
                <span className="bg-amber-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {esperaItems.filter(e => e.status === "aguardando").length}
                </span>
              )}
            </button>
          </div>
          )}
        </DialogHeader>

        {/* ── ABA PEÇAS ──────────────────────────────────────────────────────── */}
        {aba === "pecas" && (
          <>
            <div className="px-4 pt-3 pb-2 shrink-0 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border bg-blue-50 border-blue-200 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Custo total</div>
                  <div className="text-base font-extrabold text-blue-800 leading-tight">{fmtBRL(totaisEstoque.custo)}</div>
                  <div className="text-[10px] text-blue-700/70">{pecasTodas.reduce((a, p) => a + (p.quantidade || 0), 0)} un. em estoque</div>
                </div>
                <div className="rounded-xl border bg-green-50 border-green-200 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-green-700">Venda total</div>
                  <div className="text-base font-extrabold text-green-800 leading-tight">{fmtBRL(totaisEstoque.venda)}</div>
                  <div className="text-[10px] text-green-700/70">Lucro: {fmtBRL(totaisEstoque.venda - totaisEstoque.custo)}</div>
                </div>
              </div>
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
                <Button
                  size="sm"
                  variant="outline"
                  className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importReading}
                >
                  {importReading ? (
                    <><RefreshCw className="w-4 h-4 mr-1 animate-spin" /> Lendo...</>
                  ) : (
                    <><Package className="w-4 h-4 mr-1" /> Importar</>
                  )}
                </Button>
                <Button size="sm" onClick={() => { setShowAdd(true); setEditingId(null); }}>
                  <Plus className="w-4 h-4 mr-1" /> Nova
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleNotaFile(f);
                  e.target.value = "";
                }}
              />
              <PreviewLojistaDialog
                open={previewData !== null}
                data={previewData}
                onConfirm={confirmTwin}
                onCancel={() => { setPreviewData(null); setShowAdd(false); }}
                onVoltar={() => setPreviewData(null)}
                loading={savingTwin}
              />
              <ImportarNotaDialog
                open={importOpen}
                itensIniciais={importRows}
                pecasExistentes={pecasTodas.map((p) => ({ modelo: p.modelo, qualidade: p.qualidade }))}
                precosExistentes={precosExistentes}
                onConfirm={confirmImport}
                onClose={() => { if (!importSaving) { setImportOpen(false); setImportRows([]); } }}
                loading={importSaving}
              />
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
              {showAdd && (
                  <PecaForm
                    existentes={[...pecasClienteAll, ...pecasLojistaAll]}
                    onSave={handleAddSubmit}
                    onCancel={() => { setShowAdd(false); setPreviewData(null); }}
                    loading={addMutation.isPending || savingTwin}
                    pedirInvestimento
                    adicionandoEstoque={adicionarEstoqueMutation.isPending}
                    onAdicionarEstoque={(peca, qtd, custo, forma) =>
                      adicionarEstoqueMutation.mutate({ id: peca.id, quantidade: qtd, valorCusto: custo, formaInvestimento: forma })
                    }
                  />
                )}
                {!search.trim() && lowStock.length === 0 && (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">Digite para pesquisar</p>
                  <p className="text-xs mt-1 opacity-70">Ex: "Tela A03", "Bateria S21"...</p>
                </div>
              )}
              {!search.trim() && lowStock.length > 0 && (
                <div className="text-xs font-semibold text-amber-700 uppercase tracking-wide px-1 pt-1">Estoque baixo — comprar</div>
              )}
              {search.trim() && pecasLoading && <div className="text-center py-8 text-muted-foreground text-sm">Carregando...</div>}
              {search.trim() && !pecasLoading && pecas.length === 0 && <div className="text-center py-10 text-muted-foreground text-sm">Nenhuma peça encontrada para "<strong>{search}</strong>".</div>}
              {ordenarPorEstoque(search.trim() ? pecas : lowStock).map((peca) => (
                <div key={peca.id}>
                  {editingId === peca.id ? (
                    <PecaForm initial={peca} existentes={[...pecasClienteAll, ...pecasLojistaAll]} onSave={(data) => editMutation.mutate({ id: peca.id, data })} onCancel={() => setEditingId(null)} loading={editMutation.isPending} />
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
                    <div
                      className={`border rounded-xl p-3 bg-white space-y-2 cursor-pointer ${peca.quantidade === 0 ? "border-gray-300 opacity-70" : peca.quantidade <= 1 ? "border-amber-300 bg-amber-50/40" : ""}`}
                      onClick={() => setExpandedId((cur) => (cur === peca.id ? null : peca.id))}
                    >
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
                        <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
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
                      {expandedId === peca.id && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={peca.quantidade === 0 || venderMutation.isPending}
                            onClick={(e) => { e.stopPropagation(); setVenderDialogPeca(peca); setFiadoStep("choose"); setFiadoNome(""); setFiadoTipo(setor === "lojista" ? "lojista" : "cliente"); }}
                            className="flex-1 h-8 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white disabled:opacity-40"
                          >
                            <ShoppingBag className="w-3.5 h-3.5 mr-1.5" />
                            {peca.quantidade === 0 ? "Esgotado" : "Vendido (-1 un.)"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={peca.quantidade === 0 || devolverMutation.isPending}
                            onClick={(e) => { e.stopPropagation(); setDevolverDialogPeca(peca); }}
                            className="h-8 text-xs font-semibold border-orange-300 text-orange-700 hover:bg-orange-50 disabled:opacity-40"
                            title="Devolver ao fornecedor (peça com defeito)"
                          >
                            <Undo2 className="w-3.5 h-3.5 mr-1.5" />
                            Devolver
                          </Button>
                        </div>
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
                const isConfirming = deletingVendaId === v.id;
                return (
                  <div key={v.id} className={`border rounded-xl px-3 py-2.5 flex items-center gap-3 ${isConfirming ? "bg-red-50 border-red-200" : "bg-white"}`}>
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
                    {isConfirming ? (
                      <div className="flex gap-1 shrink-0">
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setDeletingVendaId(null)}>Não</Button>
                        <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" disabled={deleteVendaMutation.isPending} onClick={() => deleteVendaMutation.mutate(v.id)}>
                          {deleteVendaMutation.isPending ? "..." : "Sim"}
                        </Button>
                      </div>
                    ) : (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50 shrink-0" onClick={() => setDeletingVendaId(v.id)} title="Apagar venda">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── ABA A RECEBER ──────────────────────────────────────────────── */}
        {aba === "receber" && (
          <>
            <div className="px-4 pt-3 pb-2 shrink-0 space-y-2">
              <div className="rounded-xl border bg-orange-50 border-orange-200 px-3 py-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wide text-orange-700">Total a receber</div>
                <div className="text-2xl font-extrabold text-orange-800 leading-tight">{fmtBRL(totalAReceber)}</div>
                <div className="text-[10px] text-orange-700/70">
                  {contasAbertas.length} {contasAbertas.length === 1 ? "conta aberta" : "contas abertas"} · Adicione peça fiada na aba Peças ou um serviço aqui embaixo
                </div>
              </div>
              {!showNovoServico ? (
                <Button
                  size="sm"
                  className="w-full h-9 bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold"
                  onClick={() => { setShowNovoServico(true); setServNome(""); setServDescricao(""); setServValor(""); setServTipo(setor === "lojista" ? "lojista" : "cliente"); }}
                >
                  <Plus className="w-4 h-4 mr-1.5" /> Adicionar serviço fiado (ex: conta Google)
                </Button>
              ) : (
                <div className="bg-white border border-orange-200 rounded-xl p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-orange-800">Novo serviço fiado</div>
                    <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setShowNovoServico(false)}><X className="w-4 h-4" /></button>
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setServTipo("cliente")} className={`flex-1 h-8 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 ${servTipo === "cliente" ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600"}`}>
                      <User className="w-3.5 h-3.5" /> Cliente
                    </button>
                    <button type="button" onClick={() => setServTipo("lojista")} className={`flex-1 h-8 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 ${servTipo === "lojista" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}>
                      <Store className="w-3.5 h-3.5" /> Lojista
                    </button>
                  </div>
                  <Input
                    placeholder="Nome do devedor"
                    value={servNome}
                    onChange={(e) => setServNome(e.target.value)}
                    list="servico-nomes"
                    className="h-9 text-sm"
                  />
                  <datalist id="servico-nomes">
                    {[...new Set(contas.filter((c) => c.conta.tipo === servTipo).map((c) => c.conta.nome))].map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                  {contaExataServ && (
                    <div className="rounded-lg bg-green-50 border border-green-200 px-2.5 py-2 text-[11px] text-green-800">
                      ✅ Vai somar na conta aberta de <b>{contaExataServ.conta.nome}</b> (saldo atual {fmtBRL(contaExataServ.saldo)}). Tudo numa nota só.
                    </div>
                  )}
                  {contaSugeridaServ && (
                    <button
                      type="button"
                      onClick={() => setServNome(contaSugeridaServ.conta.nome)}
                      className="w-full text-left rounded-lg bg-amber-50 border border-amber-300 px-2.5 py-2 text-[11px] text-amber-900 hover:bg-amber-100"
                    >
                      💡 Já existe <b>{contaSugeridaServ.conta.nome}</b> devendo {fmtBRL(contaSugeridaServ.saldo)}. Toque para usar essa conta e juntar tudo numa nota só.
                    </button>
                  )}
                  <div className="relative">
                      <Input
                        placeholder="Serviço ou peça (ex: Tela G24)"
                        value={servDescricao}
                        onChange={(e) => { setServDescricao(e.target.value); setServPecaSel(null); }}
                        className="h-9 text-sm"
                      />
                      {servPecaSugestoes.length > 0 && (
                        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg overflow-hidden">
                          {servPecaSugestoes.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              disabled={p.quantidade === 0}
                              onClick={() => {
                                setServPecaSel(p);
                                setServDescricao(`${p.modelo} (${p.qualidade})`);
                                setServValor(p.valor);
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between gap-2 disabled:opacity-50"
                            >
                              <span className="text-xs font-medium">{p.modelo} <span className="text-muted-foreground">({p.qualidade})</span></span>
                              <span className={`text-[11px] font-semibold shrink-0 ${p.quantidade === 0 ? "text-red-500" : "text-emerald-600"}`}>
                                {p.quantidade === 0 ? "Esgotado" : `${p.quantidade} no estoque`}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {servPecaSel && (
                      <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-2 text-[11px] text-emerald-800 flex items-center justify-between gap-2">
                        <span>📦 Peça do estoque: <b>{servPecaSel.modelo}</b> — vai dar baixa de 1 un. (restam {servPecaSel.quantidade})</span>
                        <button type="button" className="text-emerald-700 underline shrink-0" onClick={() => { setServPecaSel(null); setServDescricao(""); setServValor(""); }}>tirar</button>
                      </div>
                    )}
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="Valor (ex: 50,00)"
                    value={servValor}
                    onChange={(e) => setServValor(e.target.value)}
                    className="h-9 text-sm"
                  />
                  <Button
                    size="sm"
                    className="w-full h-9 bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold"
                    disabled={!servNome.trim() || !servDescricao.trim() || !servValor.trim() || novoServicoMutation.isPending || venderMutation.isPending}
                    onClick={() => {
                        if (servPecaSel) {
                          venderMutation.mutate(
                            { id: servPecaSel.id, fiado: true, nomeDevedor: contaExataServ ? contaExataServ.conta.nome : servNome.trim(), tipoDevedor: servTipo },
                            { onSuccess: () => { setShowNovoServico(false); setServNome(""); setServDescricao(""); setServValor(""); setServPecaSel(null); } },
                          );
                        } else {
                          novoServicoMutation.mutate({ nome: contaExataServ ? contaExataServ.conta.nome : servNome.trim(), tipo: servTipo, descricao: servDescricao.trim(), valor: servValor.trim() });
                        }
                      }}
                  >
                    <Check className="w-4 h-4 mr-1.5" /> {novoServicoMutation.isPending || venderMutation.isPending ? "Salvando..." : "Lançar no A Receber"}
                  </Button>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
              {contasLoading && <div className="text-center py-8 text-muted-foreground text-sm">Carregando...</div>}
              {!contasLoading && contas.length === 0 && (
                <div className="text-center py-10 text-muted-foreground text-sm">
                  <HandCoins className="w-8 h-8 mx-auto mb-3 opacity-20" />
                  <p className="font-medium">Nenhuma conta a receber</p>
                  <p className="text-xs mt-1">Use o botão "Adicionar serviço fiado" acima, ou venda uma peça como FIADO na aba Peças.</p>
                </div>
              )}
              {contas.map((c) => {
                const aberta = c.conta.closedAt === null && c.saldo > 0;
                const expanded = expandedContaId === c.conta.id;
                const isPagando = pagandoContaId === c.conta.id;
                const isDeleting = deletingContaId === c.conta.id;
                return (
                  <div key={c.conta.id} className={`border rounded-xl overflow-hidden ${aberta ? "bg-white border-orange-200" : "bg-gray-50 border-gray-200 opacity-70"}`}>
                    <button
                      type="button"
                      onClick={() => setExpandedContaId(expanded ? null : c.conta.id)}
                      className="w-full px-3 py-2.5 flex items-center gap-3 text-left"
                    >
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${c.conta.tipo === "lojista" ? "bg-blue-100 text-blue-600" : "bg-purple-100 text-purple-600"}`}>
                        {c.conta.tipo === "lojista" ? <Store className="w-4 h-4" /> : <User className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm truncate">{c.conta.nome}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {c.itens.length} {c.itens.length === 1 ? "item" : "itens"} · {c.conta.tipo === "lojista" ? "Lojista" : "Cliente"}
                          {!aberta && " · ✓ Quitada"}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`font-extrabold text-base ${aberta ? "text-orange-700" : "text-green-700"}`}>{fmtBRL(c.saldo)}</div>
                        {c.totalPago > 0 && <div className="text-[10px] text-muted-foreground">Pago: {fmtBRL(c.totalPago)}</div>}
                      </div>
                    </button>
                    {expanded && (
                      <div className="border-t bg-gray-50 px-3 py-2.5 space-y-2.5">
                        {/* Botões de ação */}
                        {aberta && !isPagando && !isDeleting && addItemContaId !== c.conta.id && (
                          <div className="flex gap-2">
                            <Button size="sm" className="flex-1 h-8 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold" onClick={() => { setPagandoContaId(c.conta.id); setPagamentoValor(""); setPagamentoForma("dinheiro"); }}>
                              <Wallet className="w-3.5 h-3.5 mr-1.5" /> AV (Receber)
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 text-xs text-orange-600 border-orange-200 hover:bg-orange-50" onClick={() => { setAddItemContaId(c.conta.id); setItemDescricao(""); setItemValor(""); }}>
                              <Plus className="w-3.5 h-3.5 mr-1" /> Serviço
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 text-xs text-red-600 border-red-200 hover:bg-red-50" onClick={() => setDeletingContaId(c.conta.id)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}

                        {/* Form adicionar serviço/item à conta */}
                        {addItemContaId === c.conta.id && (() => {
                          const pecasDoTipo = c.conta.tipo === "lojista" ? pecasLojistaAll : pecasClienteAll;
                          const sugestoes = itemDescricao.trim().length >= 2
                            ? pecasDoTipo.filter((p) =>
                                p.quantidade > 0 &&
                                p.modelo.toLowerCase().includes(itemDescricao.toLowerCase().trim())
                              ).slice(0, 6)
                            : [];
                          return (
                          <div className="bg-white border border-orange-200 rounded-lg p-2.5 space-y-2">
                            <div className="text-xs font-semibold text-orange-800">Adicionar serviço à conta de {c.conta.nome}</div>
                            <div className="relative">
                              <Input
                                type="text"
                                placeholder="Serviço (ex: Remoção de conta Google)"
                                value={itemDescricao}
                                onChange={(e) => setItemDescricao(e.target.value)}
                                className="h-9 text-sm"
                                autoFocus
                              />
                              {sugestoes.length > 0 && (
                                <div className="absolute z-50 left-0 right-0 top-full mt-0.5 bg-white border border-orange-200 rounded-lg shadow-lg overflow-hidden">
                                  {sugestoes.map((p) => (
                                    <button
                                      key={p.id}
                                      type="button"
                                      className="w-full text-left px-3 py-2 hover:bg-orange-50 border-b border-orange-100 last:border-0"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        setItemDescricao(`${p.modelo} ${p.qualidade}`);
                                        setItemValor(p.valor);
                                      }}
                                    >
                                      <div className="text-xs font-semibold text-gray-800 truncate">{p.modelo}</div>
                                      <div className="text-[10px] text-muted-foreground">{p.qualidade} · {p.quantidade} un. · {p.valor}</div>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <Input
                                type="text"
                                inputMode="decimal"
                                placeholder="Valor (ex: 50,00)"
                                value={itemValor}
                                onChange={(e) => setItemValor(e.target.value)}
                                className="h-9 text-sm"
                              />
                              <Button size="sm" className="h-9 bg-orange-600 hover:bg-orange-700 text-white" disabled={!itemDescricao.trim() || !itemValor.trim() || addItemMutation.isPending} onClick={() => addItemMutation.mutate({ contaId: c.conta.id, descricao: itemDescricao.trim(), valor: itemValor.trim(), formaPagamento: itemForma })}>
                                <Check className="w-4 h-4" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-9" onClick={() => { setAddItemContaId(null); setItemDescricao(""); setItemValor(""); setItemForma("fiado"); }}>
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                          );
                        })()}
                        {!aberta && !isDeleting && (
                          <Button size="sm" variant="outline" className="w-full h-8 text-xs text-red-600 border-red-200 hover:bg-red-50" onClick={() => setDeletingContaId(c.conta.id)}>
                            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Apagar conta quitada
                          </Button>
                        )}

                        {/* Compartilhar extrato no WhatsApp */}
                        {!isPagando && !isDeleting && addItemContaId !== c.conta.id && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full h-8 text-xs text-green-700 border-green-300 hover:bg-green-50 font-semibold"
                            disabled={generatingShare}
                            onClick={() => handleShareExtrato(c)}
                          >
                            <Share2 className="w-3.5 h-3.5 mr-1.5" /> {generatingShare ? "Gerando..." : "Compartilhar no WhatsApp"}
                          </Button>
                        )}

                        {/* Form de pagamento */}
                        {isPagando && (
                          <div className="bg-white border border-green-200 rounded-lg p-2.5 space-y-2">
                            <div className="text-xs font-semibold text-green-800">Quanto recebeu agora? (Saldo: {fmtBRL(c.saldo)})</div>
                            <div className="flex gap-2">
                              <Input
                                type="text"
                                inputMode="decimal"
                                placeholder="Ex: 100"
                                value={pagamentoValor}
                                onChange={(e) => setPagamentoValor(e.target.value)}
                                className="h-9 text-sm"
                                autoFocus
                              />
                              <Button size="sm" className="h-9 bg-green-600 hover:bg-green-700 text-white" disabled={!pagamentoValor || pagarMutation.isPending} onClick={() => pagarMutation.mutate({ contaId: c.conta.id, valor: pagamentoValor, formaPagamento: pagamentoForma })}>
                                <Check className="w-4 h-4" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-9" onClick={() => { setPagandoContaId(null); setPagamentoValor(""); setPagamentoForma("dinheiro"); }}>
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                            <div className="flex gap-1">
                              <button type="button" onClick={() => setPagamentoValor(String(c.saldo))} className="text-[10px] text-green-700 hover:underline font-medium">
                                Receber tudo ({fmtBRL(c.saldo)})
                              </button>
                            </div>
                            <div>
                              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Recebeu como?</div>
                              <div className="grid grid-cols-3 gap-1">
                                {(["dinheiro", "pix", "debito", "credito_1x", "credito_2x", "credito_3x"] as FormaPagamento[]).map((f) => {
                                  const ativo = pagamentoForma === f;
                                  const semTaxa = f === "dinheiro" || f === "pix";
                                  const short =
                                    f === "dinheiro" ? "Dinheiro"
                                    : f === "pix" ? "PIX"
                                    : f === "debito" ? "Débito"
                                    : f === "credito_1x" ? "Créd 1x"
                                    : f === "credito_2x" ? "Créd 2x"
                                    : "Créd 3x";
                                  return (
                                    <button
                                      key={f}
                                      type="button"
                                      onClick={() => setPagamentoForma(f)}
                                      className={`rounded-lg border py-1.5 text-[10px] font-semibold transition-colors ${
                                        ativo
                                          ? semTaxa
                                            ? "bg-emerald-600 text-white border-emerald-600"
                                            : "bg-blue-600 text-white border-blue-600"
                                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                                      }`}
                                    >
                                      {short}
                                    </button>
                                  );
                                })}
                              </div>
                              {pagamentoForma === "pix" && (
                                <p className="mt-1 text-[10px] text-emerald-700">PIX — sem taxa, entra na gaveta.</p>
                              )}
                              {isCartaoForma(pagamentoForma) && pagamentoValor && (
                                <p className="mt-1 text-[10px] text-blue-700">
                                  Cartão {TAXAS_CARTAO[pagamentoForma].toLocaleString("pt-BR")}% — você recebe {fmtBRL(liquidoCartao(Number(String(pagamentoValor).replace(",", ".")) || 0, pagamentoForma))} (a taxa é por sua conta).
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Confirmação de apagar conta */}
                        {isDeleting && (
                          <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 space-y-2">
                            <div className="text-xs font-semibold text-red-800">Apagar a conta inteira de {c.conta.nome}?</div>
                            <div className="flex gap-2">
                              <Button size="sm" variant="ghost" className="flex-1 h-8" onClick={() => setDeletingContaId(null)}>Não</Button>
                              <Button size="sm" variant="destructive" className="flex-1 h-8" disabled={apagarContaMutation.isPending} onClick={() => apagarContaMutation.mutate(c.conta.id)}>
                                {apagarContaMutation.isPending ? "..." : "Sim, apagar"}
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Itens */}
                        {c.itens.length > 0 && (
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Itens</div>
                            <div className="space-y-1">
                              {c.itens.map((item) => {
                                const dia = new Date(item.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
                                const hora = new Date(item.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                                const formaLabel = item.formaPagamento
                                  ? item.formaPagamento === "fiado" ? "Fiado"
                                  : item.formaPagamento === "pix" ? "PIX"
                                  : item.formaPagamento === "dinheiro" ? "Dinheiro"
                                  : item.formaPagamento === "debito" ? "Débito"
                                  : item.formaPagamento === "credito_1x" ? "Créd 1x"
                                  : item.formaPagamento === "credito_2x" ? "Créd 2x"
                                  : item.formaPagamento === "credito_3x" ? "Créd 3x"
                                  : item.formaPagamento
                                  : null;
                                const isDel = deletingItemId === item.id;
                                return (
                                  <div key={item.id} className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${isDel ? "bg-red-50" : "bg-white"}`}>
                                    <div className="flex-1 min-w-0">
                                      <div className="font-semibold truncate">{item.modelo}</div>
                                      <div className="text-[10px] text-muted-foreground">
                                        {item.qualidade} · {dia} às {hora}{formaLabel ? <span className="font-semibold text-orange-600"> · {formaLabel}</span> : ""}
                                      </div>
                                    </div>
                                    <div className="font-bold text-orange-700">{formatMoney(item.valor)}</div>
                                    {isDel ? (
                                      <div className="flex gap-0.5">
                                        <Button size="icon" variant="ghost" className="h-6 w-6 text-xs" onClick={() => setDeletingItemId(null)}><X className="w-3 h-3" /></Button>
                                        <Button size="icon" variant="destructive" className="h-6 w-6" disabled={apagarItemMutation.isPending} onClick={() => apagarItemMutation.mutate(item.id)}><Check className="w-3 h-3" /></Button>
                                      </div>
                                    ) : (
                                      <button type="button" onClick={() => setDeletingItemId(item.id)} className="text-red-400 hover:text-red-600 p-0.5">
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Pagamentos */}
                        {c.pagamentos.length > 0 && (
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Pagamentos (AV)</div>
                            <div className="space-y-1">
                              {c.pagamentos.map((p) => {
                                const dia = new Date(p.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
                                const hora = new Date(p.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                                const pagFormaLabel = p.formaPagamento
                                  ? p.formaPagamento === "pix" ? "PIX"
                                  : p.formaPagamento === "dinheiro" ? "Dinheiro"
                                  : p.formaPagamento === "debito" ? "Débito"
                                  : p.formaPagamento === "credito_1x" ? "Créd 1x"
                                  : p.formaPagamento === "credito_2x" ? "Créd 2x"
                                  : p.formaPagamento === "credito_3x" ? "Créd 3x"
                                  : p.formaPagamento
                                  : null;
                                const isDel = deletingPagamentoId === p.id;
                                return (
                                  <div key={p.id} className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${isDel ? "bg-red-50" : "bg-green-50 border border-green-100"}`}>
                                    <DollarSign className="w-3.5 h-3.5 text-green-600 shrink-0" />
                                    <div className="flex-1 text-[10px] text-muted-foreground">
                                      {dia} às {hora}{pagFormaLabel ? <span className="font-semibold text-green-700"> · {pagFormaLabel}</span> : ""}
                                    </div>
                                    <div className="font-bold text-green-700">{formatMoney(p.valor)}</div>
                                    {isDel ? (
                                      <div className="flex gap-0.5">
                                        <Button size="icon" variant="ghost" className="h-6 w-6 text-xs" onClick={() => setDeletingPagamentoId(null)}><X className="w-3 h-3" /></Button>
                                        <Button size="icon" variant="destructive" className="h-6 w-6" disabled={apagarPagamentoMutation.isPending} onClick={() => apagarPagamentoMutation.mutate(p.id)}><Check className="w-3 h-3" /></Button>
                                      </div>
                                    ) : (
                                      <button type="button" onClick={() => setDeletingPagamentoId(p.id)} className="text-red-400 hover:text-red-600 p-0.5">
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── ABA A CAMINHO (ENCOMENDAS) ─────────────────────────────── */}
        {aba === "encomendas" && (
          <EncomendasTab open={open} />
        )}

        {/* ── ABA ESPERA ──────────────────────────────────────────────────────── */}
        {(aba === "espera" || (soloTab && initialTab === "espera")) && (
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            <div className="text-xs text-muted-foreground leading-tight">
              Itens separados para o cliente — sem pagamento ainda. Quando ele pagar, toque aqui para registrar.
            </div>

            {esperaItems.filter(e => e.status === "aguardando").length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-sm">
                <Timer className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Nenhum item em espera</p>
                <p className="text-xs mt-1 opacity-70">Use "Modo Espera" ao vender uma peça.</p>
              </div>
            )}

            {esperaItems.filter(e => e.status === "aguardando").map((item) => {
              const isPagando = esperaPagandoId === item.id;
              return (
                <div key={item.id} className="rounded-xl border bg-amber-50 border-amber-200 overflow-hidden">
                  {/* Header do item */}
                  <div className="flex items-start justify-between gap-2 px-3 py-2.5">
                    <div>
                      <div className="font-bold text-sm text-slate-800">{item.modelo}</div>
                      <div className="text-xs text-muted-foreground">{item.qualidade} · {formatMoney(item.valor)}</div>
                      {item.observacao && (
                        <div className="text-xs text-amber-700 mt-0.5">📝 {item.observacao}</div>
                      )}
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {new Date(item.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {!isPagando && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => { setEsperaPagandoId(item.id); setEsperaFiadoStep("choose"); }}
                            className="h-8 bg-green-600 hover:bg-green-700 text-white text-xs px-3"
                          >
                            Receber
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                            disabled={esperaCancelarMutation.isPending}
                            onClick={() => esperaCancelarMutation.mutate(item.id)}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Painel de pagamento inline */}
                  {isPagando && (
                    <div className="border-t border-amber-200 bg-white px-3 py-3 space-y-2.5">
                      {esperaFiadoStep === "choose" && (
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-muted-foreground">Recebeu como?</div>
                          <div className="grid grid-cols-2 gap-2">
                            <Button className="h-14 flex flex-col items-center justify-center bg-green-600 hover:bg-green-700 text-white gap-0.5"
                              onClick={() => setEsperaFiadoStep("avista")}>
                              <DollarSign className="w-4 h-4" /><span className="font-bold text-xs">À VISTA</span>
                            </Button>
                            <Button className="h-14 flex flex-col items-center justify-center bg-blue-600 hover:bg-blue-700 text-white gap-0.5"
                              onClick={() => setEsperaFiadoStep("cartao")}>
                              <CreditCard className="w-4 h-4" /><span className="font-bold text-xs">CARTÃO</span>
                            </Button>
                            <Button className="col-span-2 h-11 flex items-center justify-center bg-violet-600 hover:bg-violet-700 text-white gap-1.5"
                              onClick={() => { setEsperaMistoSplits([]); setEsperaMistoForma("dinheiro"); setEsperaMistoValor(""); setEsperaFiadoStep("misto"); }}>
                              <Shuffle className="w-4 h-4" /><span className="font-bold text-xs">MISTO</span>
                            </Button>
                          </div>
                          <Button variant="ghost" className="w-full text-xs" onClick={() => setEsperaPagandoId(null)}>Cancelar</Button>
                        </div>
                      )}

                      {esperaFiadoStep === "avista" && (
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-muted-foreground">Recebeu em?</div>
                          <div className="grid grid-cols-2 gap-2">
                            <Button className="h-12 flex flex-col items-center justify-center bg-green-600 hover:bg-green-700 text-white gap-0.5"
                              disabled={esperaPagarMutation.isPending}
                              onClick={() => esperaPagarMutation.mutate({ id: item.id, formaPagamento: "dinheiro" })}>
                              <DollarSign className="w-4 h-4" /><span className="font-bold text-xs">DINHEIRO</span>
                            </Button>
                            <Button className="h-12 flex flex-col items-center justify-center bg-emerald-600 hover:bg-emerald-700 text-white gap-0.5"
                              disabled={esperaPagarMutation.isPending}
                              onClick={() => esperaPagarMutation.mutate({ id: item.id, formaPagamento: "pix" })}>
                              <Wallet className="w-4 h-4" /><span className="font-bold text-xs">PIX</span>
                            </Button>
                          </div>
                          <Button variant="ghost" className="w-full text-xs" onClick={() => setEsperaFiadoStep("choose")}>Voltar</Button>
                        </div>
                      )}

                      {esperaFiadoStep === "cartao" && (() => {
                        const bruto = parsePtBR(item.valor);
                        const opcoes: Array<{ forma: "debito"|"credito_1x"|"credito_2x"|"credito_3x"; label: string }> = [
                          { forma: "debito",      label: "Débito" },
                          { forma: "credito_1x",  label: "Crédito 1x" },
                          { forma: "credito_2x",  label: "Crédito 2x" },
                          { forma: "credito_3x",  label: "Crédito 3x" },
                        ];
                        return (
                          <div className="space-y-2">
                            <div className="text-xs font-semibold text-muted-foreground">Cartão — escolha o tipo</div>
                            <div className="flex flex-col gap-1.5">
                              {opcoes.map(({ forma, label }) => {
                                const taxa = TAXAS_CARTAO[forma];
                                const liquido = liquidoCartao(bruto, forma);
                                return (
                                  <Button key={forma}
                                    className="h-auto py-2 px-3 flex items-center justify-between bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg"
                                    disabled={esperaPagarMutation.isPending}
                                    onClick={() => esperaPagarMutation.mutate({ id: item.id, formaPagamento: forma })}>
                                    <div className="flex items-center gap-2">
                                      <CreditCard className="w-4 h-4 shrink-0" />
                                      <span className="font-bold text-xs">{label}</span>
                                    </div>
                                    <div className="text-right">
                                      <div className="text-[10px] opacity-80">taxa {taxa.toLocaleString("pt-BR")}%</div>
                                      <div className="text-xs font-semibold">→ {fmtBRL(liquido)}</div>
                                    </div>
                                  </Button>
                                );
                              })}
                              <Button
                                className="h-auto py-2 px-3 flex items-center justify-between bg-orange-500 hover:bg-orange-600 text-white rounded-lg"
                                onClick={() => setEsperaFiadoStep("fiado")}>
                                <div className="flex items-center gap-2">
                                  <BookOpen className="w-4 h-4 shrink-0" />
                                  <span className="font-bold text-xs">Fiado</span>
                                </div>
                                <span className="text-[10px] opacity-80">registrar como dívida</span>
                              </Button>
                            </div>
                            <Button variant="ghost" className="w-full text-xs" onClick={() => setEsperaFiadoStep("choose")}>Voltar</Button>
                          </div>
                        );
                      })()}

                      {esperaFiadoStep === "fiado" && (
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-muted-foreground">Fiado — nome do cliente</div>
                          <Input
                            placeholder="Nome do cliente..."
                            value={esperaFiadoNome}
                            onChange={e => setEsperaFiadoNome(e.target.value)}
                            className="h-9 text-sm"
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <Button size="sm" variant={esperaFiadoTipo === "cliente" ? "default" : "outline"} className="flex-1 text-xs h-8"
                              onClick={() => setEsperaFiadoTipo("cliente")}>Cliente</Button>
                            <Button size="sm" variant={esperaFiadoTipo === "lojista" ? "default" : "outline"} className="flex-1 text-xs h-8"
                              onClick={() => setEsperaFiadoTipo("lojista")}>Lojista</Button>
                          </div>
                          <Button
                            className="w-full bg-orange-500 hover:bg-orange-600 text-white text-xs"
                            disabled={esperaPagarMutation.isPending || esperaFiadoNome.trim().length < 2}
                            onClick={() => esperaPagarMutation.mutate({ id: item.id, fiado: true, nomeDevedor: esperaFiadoNome.trim(), tipoDevedor: esperaFiadoTipo })}>
                            📒 Registrar fiado
                          </Button>
                          <Button variant="ghost" className="w-full text-xs" onClick={() => setEsperaFiadoStep("cartao")}>Voltar</Button>
                        </div>
                      )}

                      {esperaFiadoStep === "misto" && (
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-muted-foreground">Pagamento misto</div>
                          {esperaMistoSplits.map((s, i) => (
                            <div key={i} className="flex gap-1.5 text-xs items-center">
                              <span className="text-slate-500 w-16 shrink-0">{LABELS_FORMA[s.forma as FormaPagamento] ?? s.forma}</span>
                              <span className="font-semibold">{formatMoney(s.valor)}</span>
                              <button type="button" className="ml-auto text-red-400" onClick={() => setEsperaMistoSplits(p => p.filter((_, j) => j !== i))}>
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                          <div className="flex gap-1.5">
                            <select value={esperaMistoForma} onChange={e => setEsperaMistoForma(e.target.value)}
                              className="h-8 flex-1 rounded border border-slate-200 text-xs px-1">
                              {["dinheiro","pix","debito","credito_1x","credito_2x","credito_3x"].map(f => (
                                <option key={f} value={f}>{LABELS_FORMA[f as FormaPagamento] ?? f}</option>
                              ))}
                            </select>
                            <Input inputMode="decimal" placeholder="R$" value={esperaMistoValor}
                              onChange={e => setEsperaMistoValor(e.target.value)}
                              className="h-8 w-24 text-xs" />
                            <Button size="sm" className="h-8 px-2 text-xs" type="button"
                              onClick={() => { if (esperaMistoValor.trim()) { setEsperaMistoSplits(p => [...p, { forma: esperaMistoForma, valor: esperaMistoValor.trim() }]); setEsperaMistoValor(""); } }}>
                              +
                            </Button>
                          </div>
                          <Button className="w-full bg-violet-600 hover:bg-violet-700 text-white text-xs"
                            disabled={esperaPagarMutation.isPending || esperaMistoSplits.length === 0}
                            onClick={() => esperaPagarMutation.mutate({ id: item.id, splits: esperaMistoSplits })}>
                            Confirmar misto
                          </Button>
                          <Button variant="ghost" className="w-full text-xs" onClick={() => setEsperaFiadoStep("choose")}>Voltar</Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Diálogo Devolução ao Fornecedor ─────────────────────────── */}
        {devolverDialogPeca && (
          <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={() => !devolverMutation.isPending && setDevolverDialogPeca(null)}>
            <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
                    <Undo2 className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Devolver ao fornecedor</div>
                    <div className="font-bold text-base">{devolverDialogPeca.modelo}</div>
                  </div>
                </div>
                <button type="button" className="text-muted-foreground hover:text-foreground p-1" onClick={() => setDevolverDialogPeca(null)} disabled={devolverMutation.isPending}>
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-900 space-y-1.5">
                <p className="font-medium">Confirmar devolução de 1 unidade?</p>
                <ul className="text-xs space-y-1 text-orange-800/90 pl-4 list-disc">
                  <li>Estoque vai diminuir 1 unidade</li>
                  <li>Sai do <strong>Custo Total</strong> ({devolverDialogPeca.valorCusto ? formatMoney(devolverDialogPeca.valorCusto) : "—"})</li>
                  <li>Sai do <strong>Venda Total</strong> ({formatMoney(devolverDialogPeca.valor)})</li>
                </ul>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setDevolverDialogPeca(null)} disabled={devolverMutation.isPending}>
                  Cancelar
                </Button>
                <Button
                  className="flex-1 bg-orange-600 hover:bg-orange-700 text-white"
                  onClick={() => devolverMutation.mutate(devolverDialogPeca.id)}
                  disabled={devolverMutation.isPending}
                >
                  <Undo2 className="w-4 h-4 mr-1.5" />
                  {devolverMutation.isPending ? "Devolvendo..." : "Confirmar"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Diálogo À VISTA / FIADO ──────────────────────────────────── */}
        {venderDialogPeca && (
          <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={() => !venderMutation.isPending && setVenderDialogPeca(null)}>
            <div className="bg-white rounded-2xl w-full max-w-sm p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">Vendendo</div>
                  <div className="font-bold text-base">{venderDialogPeca.modelo}</div>
                  <div className="text-xs text-muted-foreground">{venderDialogPeca.qualidade} · {formatMoney(venderDialogPeca.valor)}</div>
                </div>
                <button type="button" className="text-muted-foreground hover:text-foreground p-1" onClick={() => setVenderDialogPeca(null)} disabled={venderMutation.isPending}>
                  <X className="w-5 h-5" />
                </button>
              </div>

              {fiadoStep === "choose" && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button
                    className="h-16 flex flex-col items-center justify-center bg-green-600 hover:bg-green-700 text-white gap-0.5"
                    disabled={venderMutation.isPending}
                    onClick={() => setFiadoStep("avista")}
                  >
                    <DollarSign className="w-5 h-5" />
                    <span className="font-bold text-xs">À VISTA</span>
                  </Button>
                  <Button
                    className="h-16 flex flex-col items-center justify-center bg-blue-600 hover:bg-blue-700 text-white gap-0.5"
                    disabled={venderMutation.isPending}
                    onClick={() => setFiadoStep("cartao")}
                  >
                    <CreditCard className="w-5 h-5" />
                    <span className="font-bold text-xs">CARTÃO</span>
                  </Button>
                  <Button
                    className="h-16 flex flex-col items-center justify-center bg-orange-500 hover:bg-orange-600 text-white gap-0.5"
                    disabled={venderMutation.isPending}
                    onClick={() => setFiadoStep("fiado")}
                  >
                    <HandCoins className="w-5 h-5" />
                    <span className="font-bold text-xs">FIADO</span>
                  </Button>
                  <Button
                    className="h-16 flex flex-col items-center justify-center bg-violet-600 hover:bg-violet-700 text-white gap-0.5"
                    disabled={venderMutation.isPending}
                    onClick={() => { setMistoSplits([]); setMistoForma("dinheiro"); setMistoValor(""); setFiadoStep("misto"); }}
                  >
                    <Shuffle className="w-5 h-5" />
                    <span className="font-bold text-xs">MISTO</span>
                  </Button>
                  <Button
                    className="col-span-2 h-12 flex items-center justify-center bg-amber-500 hover:bg-amber-600 text-white gap-2"
                    disabled={venderMutation.isPending || esperaMutation.isPending}
                    onClick={() => esperaMutation.mutate({ pecaId: venderDialogPeca!.id })}
                  >
                    <Timer className="w-5 h-5" />
                    <span className="font-bold text-sm">MODO ESPERA — receber depois</span>
                  </Button>
                </div>
              )}

              {fiadoStep === "avista" && (
                <div className="space-y-2.5 pt-1">
                  <div className="text-xs font-semibold text-muted-foreground">Recebeu como?</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      className="h-16 flex flex-col items-center justify-center bg-green-600 hover:bg-green-700 text-white gap-0.5"
                      disabled={venderMutation.isPending}
                      onClick={() => venderMutation.mutate({ id: venderDialogPeca.id, fiado: false, formaPagamento: "dinheiro" })}
                    >
                      <DollarSign className="w-5 h-5" />
                      <span className="font-bold text-sm">DINHEIRO</span>
                    </Button>
                    <Button
                      className="h-16 flex flex-col items-center justify-center bg-emerald-600 hover:bg-emerald-700 text-white gap-0.5"
                      disabled={venderMutation.isPending}
                      onClick={() => venderMutation.mutate({ id: venderDialogPeca.id, fiado: false, formaPagamento: "pix" })}
                    >
                      <Wallet className="w-5 h-5" />
                      <span className="font-bold text-sm">PIX</span>
                    </Button>
                  </div>
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-2 text-[11px] text-emerald-900">
                    Dinheiro e PIX entram na gaveta — sem taxa. Você recebe os <b>{formatMoney(venderDialogPeca.valor)}</b> cheios.
                  </div>
                  <Button variant="ghost" className="w-full" onClick={() => setFiadoStep("choose")} disabled={venderMutation.isPending}>Voltar</Button>
                </div>
              )}

              {fiadoStep === "cartao" && (
                <div className="space-y-2.5 pt-1">
                  <div className="text-xs font-semibold text-muted-foreground">Pagamento no cartão</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      className="h-16 flex flex-col items-center justify-center bg-cyan-600 hover:bg-cyan-700 text-white gap-0.5"
                      disabled={venderMutation.isPending}
                      onClick={() => venderMutation.mutate({ id: venderDialogPeca.id, fiado: false, formaPagamento: "debito" })}
                    >
                      <CreditCard className="w-5 h-5" />
                      <span className="font-bold text-sm">DÉBITO</span>
                      <span className="text-[10px] opacity-90">taxa {TAXAS_CARTAO.debito.toLocaleString("pt-BR")}%</span>
                    </Button>
                    <Button
                      className="h-16 flex flex-col items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white gap-0.5"
                      disabled={venderMutation.isPending}
                      onClick={() => setFiadoStep("credito")}
                    >
                      <CreditCard className="w-5 h-5" />
                      <span className="font-bold text-sm">CRÉDITO</span>
                      <span className="text-[10px] opacity-90">1x · 2x · 3x</span>
                    </Button>
                  </div>
                  <div className="rounded-lg bg-cyan-50 border border-cyan-200 px-2.5 py-2 text-[11px] text-cyan-900">
                    No débito você recebe <b>{formatMoney(String(liquidoCartao(parsePtBR(venderDialogPeca.valor), "debito")))}</b> (a maquininha desconta {TAXAS_CARTAO.debito.toLocaleString("pt-BR")}%).
                  </div>
                  <Button variant="ghost" className="w-full" onClick={() => setFiadoStep("choose")} disabled={venderMutation.isPending}>Voltar</Button>
                </div>
              )}

              {fiadoStep === "credito" && (
                <div className="space-y-2.5 pt-1">
                  <div className="text-xs font-semibold text-muted-foreground">Crédito — em quantas vezes?</div>
                  <div className="grid grid-cols-3 gap-2">
                    {(["credito_1x", "credito_2x", "credito_3x"] as FormaCartao[]).map((f) => {
                      const valorNum = parsePtBR(venderDialogPeca.valor);
                      const vezes = f === "credito_1x" ? "1x" : f === "credito_2x" ? "2x" : "3x";
                      return (
                        <Button
                          key={f}
                          className="h-20 flex flex-col items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white gap-0.5"
                          disabled={venderMutation.isPending}
                          onClick={() => venderMutation.mutate({ id: venderDialogPeca.id, fiado: false, formaPagamento: f })}
                        >
                          <span className="font-bold text-base">{vezes}</span>
                          <span className="text-[10px] opacity-90">taxa {TAXAS_CARTAO[f].toLocaleString("pt-BR")}%</span>
                          <span className="text-[10px] opacity-90">recebe {formatMoney(String(liquidoCartao(valorNum, f)))}</span>
                        </Button>
                      );
                    })}
                  </div>
                  <div className="text-[11px] text-muted-foreground text-center">Cliente paga {formatMoney(venderDialogPeca.valor)} · a maquininha desconta a taxa.</div>
                  <Button variant="ghost" className="w-full" onClick={() => setFiadoStep("cartao")} disabled={venderMutation.isPending}>Voltar</Button>
                </div>
              )}

              {fiadoStep === "misto" && (() => {
                const pecaValorNum = parsePtBR(venderDialogPeca.valor);
                const splitTotal = mistoSplits.reduce((s, sp) => s + parsePtBR(sp.valor), 0);
                const restante = pecaValorNum - splitTotal;
                const pronto = Math.abs(restante) < 0.01 && mistoSplits.length > 0;
                const formaLabel = (f: string) =>
                  f === "dinheiro" ? "Dinheiro" : f === "pix" ? "PIX" : f === "debito" ? "Débito"
                  : f === "credito_1x" ? "Créd 1x" : f === "credito_2x" ? "Créd 2x" : f === "credito_3x" ? "Créd 3x" : f;
                const addSplit = () => {
                  const v = parsePtBR(mistoValor);
                  if (v <= 0 || v > restante + 0.01) return;
                  setMistoSplits(prev => [...prev, { forma: mistoForma, valor: mistoValor.trim() }]);
                  setMistoValor("");
                };
                return (
                <div className="space-y-2.5 pt-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-muted-foreground">Pagamento misto</span>
                    <span className="font-bold">{formatMoney(venderDialogPeca.valor)}</span>
                  </div>

                  {/* Splits adicionados */}
                  {mistoSplits.length > 0 && (
                    <div className="space-y-1">
                      {mistoSplits.map((sp, i) => (
                        <div key={i} className="flex items-center gap-2 px-2 py-1.5 bg-violet-50 border border-violet-200 rounded-lg text-xs">
                          <span className="flex-1 font-semibold text-violet-800">{formaLabel(sp.forma)}</span>
                          <span className="font-bold text-violet-700">{formatMoney(sp.valor)}</span>
                          <button type="button" onClick={() => setMistoSplits(prev => prev.filter((_, j) => j !== i))}>
                            <X className="w-3 h-3 text-red-400 hover:text-red-600" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Falta */}
                  {!pronto && (
                    <div className={`text-center text-xs font-semibold rounded-lg py-1.5 ${restante > 0 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>
                      {restante > 0 ? `Falta: ${formatMoney(String(restante.toFixed(2).replace(".", ",")))}` : `Excesso: ${formatMoney(String(Math.abs(restante).toFixed(2).replace(".", ",")))} — remova um split`}
                    </div>
                  )}
                  {pronto && (
                    <div className="text-center text-xs font-semibold rounded-lg py-1.5 bg-green-50 text-green-700">✓ Total confere — pode confirmar!</div>
                  )}

                  {/* Adicionar split */}
                  {!pronto && (
                    <div className="space-y-1.5 rounded-xl border border-violet-100 bg-violet-50/50 p-2">
                      <div className="grid grid-cols-3 gap-1">
                        {(["dinheiro","pix","debito","credito_1x","credito_2x","credito_3x"] as const).map((f) => (
                          <button key={f} type="button" onClick={() => setMistoForma(f)}
                            className={`rounded-lg border py-1 text-[10px] font-semibold transition-colors ${mistoForma === f ? "bg-violet-600 text-white border-violet-600" : "text-gray-600 border-gray-200 hover:border-violet-400 bg-white"}`}>
                            {formaLabel(f)}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder={restante > 0 ? `Valor (máx ${restante.toFixed(2).replace(".",",")})`  : "0,00"}
                          value={mistoValor}
                          onChange={(e) => setMistoValor(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && addSplit()}
                          className="flex-1 h-8 rounded-lg border border-gray-200 px-2 text-xs outline-none focus:border-violet-400"
                        />
                        <Button size="sm" className="h-8 bg-violet-600 hover:bg-violet-700 text-white px-3" onClick={addSplit}
                          disabled={!mistoValor.trim() || parsePtBR(mistoValor) <= 0}>
                          <Plus className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}

                  <Button
                    className="w-full bg-violet-600 hover:bg-violet-700 text-white font-bold"
                    disabled={!pronto || venderMutation.isPending}
                    onClick={() => venderMutation.mutate({ id: venderDialogPeca.id, fiado: false, splits: mistoSplits })}
                  >
                    {venderMutation.isPending ? "..." : "Confirmar Venda Mista"}
                  </Button>
                  <Button variant="ghost" className="w-full" onClick={() => setFiadoStep("choose")} disabled={venderMutation.isPending}>Voltar</Button>
                </div>
                );
              })()}

              {fiadoStep === "fiado" && (
                <div className="space-y-2.5 pt-1">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Quem ficou devendo?</label>
                    <div className="flex gap-1 mt-1 mb-2">
                      <button type="button" onClick={() => setFiadoTipo("cliente")} className={`flex-1 h-8 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 ${fiadoTipo === "cliente" ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600"}`}>
                        <User className="w-3.5 h-3.5" /> Cliente
                      </button>
                      <button type="button" onClick={() => setFiadoTipo("lojista")} className={`flex-1 h-8 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 ${fiadoTipo === "lojista" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}>
                        <Store className="w-3.5 h-3.5" /> Lojista
                      </button>
                    </div>
                    <Input
                      placeholder="Nome de quem ficou devendo"
                      value={fiadoNome}
                      onChange={(e) => setFiadoNome(e.target.value)}
                      autoFocus
                      list="fiado-nomes"
                      className="h-10"
                    />
                    <datalist id="fiado-nomes">
                      {[...new Set(contas.filter((c) => c.conta.tipo === fiadoTipo).map((c) => c.conta.nome))].map((n) => (
                        <option key={n} value={n} />
                      ))}
                    </datalist>
                    {contaExataFiado && (
                      <div className="mt-1.5 rounded-lg bg-green-50 border border-green-200 px-2.5 py-2 text-[11px] text-green-800">
                        ✅ Vai entrar na conta aberta de <b>{contaExataFiado.conta.nome}</b> (saldo atual {fmtBRL(contaExataFiado.saldo)}). Tudo numa nota só.
                      </div>
                    )}
                    {contaSugeridaFiado && (
                      <button
                        type="button"
                        onClick={() => setFiadoNome(contaSugeridaFiado.conta.nome)}
                        className="mt-1.5 w-full text-left rounded-lg bg-amber-50 border border-amber-300 px-2.5 py-2 text-[11px] text-amber-900 hover:bg-amber-100"
                      >
                        💡 Já existe <b>{contaSugeridaFiado.conta.nome}</b> devendo {fmtBRL(contaSugeridaFiado.saldo)}. Toque para usar essa conta e juntar tudo numa nota só.
                      </button>
                    )}
                    {!contaExataFiado && !contaSugeridaFiado && (
                      <div className="text-[10px] text-muted-foreground mt-1">
                        Se já existe uma conta aberta com esse nome, a peça vai entrar nela.
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button variant="ghost" className="flex-1" onClick={() => setFiadoStep("choose")} disabled={venderMutation.isPending}>Voltar</Button>
                    <Button
                      className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold"
                      disabled={!fiadoNome.trim() || venderMutation.isPending}
                      onClick={() => venderMutation.mutate({ id: venderDialogPeca.id, fiado: true, nomeDevedor: contaExataFiado ? contaExataFiado.conta.nome : fiadoNome.trim(), tipoDevedor: fiadoTipo })}
                    >
                      {venderMutation.isPending ? "..." : "Confirmar"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Indicador de geração */}
        {generatingShare && (
          <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center">
            <div className="bg-white rounded-2xl px-6 py-5 flex items-center gap-3 shadow-xl">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-medium">Gerando imagem...</span>
            </div>
          </div>
        )}

        {/* Preview com botão para compartilhar (gesto fresco do usuário) */}
        {sharePreview && (
          <div className="fixed inset-0 z-[60] bg-black/70 flex flex-col items-center justify-center p-4" onClick={closeSharePreview}>
            <div className="bg-white rounded-2xl p-3 max-w-sm w-full shadow-2xl flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
              <img src={sharePreview.url} alt="Preview" className="w-full rounded-xl max-h-[60vh] object-contain bg-gray-100" />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={closeSharePreview}>Cancelar</Button>
                <Button className="flex-1 bg-green-600 hover:bg-green-700 text-white" onClick={() => { confirmShare(); }}>
                  <Share2 className="w-4 h-4 mr-1.5" /> Compartilhar
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Card oculto para gerar imagem de compartilhamento */}
        {sharingPeca && setor === "lojista" && (
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

        {sharingPeca && setor === "cliente" && (
          <div style={{ position: "fixed", left: "-9999px", top: 0 }}>
            <div ref={shareRef} style={{ width: 600, height: 900, position: "relative", fontFamily: "Inter, sans-serif", overflow: "hidden" }}>
              <img src={`${BASE}/share-bg-cliente.png`} crossOrigin="anonymous" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
              {/* Box 1: Modelo */}
              <div style={{ position: "absolute", left: "4%", top: "32%", width: "44%", height: "10%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 10px" }}>
                <div style={{ fontSize: 11, color: "#7dd3fc", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", marginBottom: 2 }}>Modelo</div>
                <div style={{ fontSize: 20, color: "#ffffff", fontWeight: 700, textAlign: "center", lineHeight: 1.1, textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>{sharingPeca.modelo}</div>
              </div>
              {/* Box 2: Qualidade */}
              <div style={{ position: "absolute", left: "4%", top: "44.5%", width: "44%", height: "10%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 10px" }}>
                <div style={{ fontSize: 11, color: "#7dd3fc", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", marginBottom: 2 }}>Qualidade</div>
                <div style={{ fontSize: 18, color: "#ffffff", fontWeight: 700, textAlign: "center", textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>{sharingPeca.qualidade}</div>
              </div>
              {/* Box 3: Valor */}
              <div style={{ position: "absolute", left: "4%", top: "57%", width: "44%", height: "10%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 10px" }}>
                <div style={{ fontSize: 11, color: "#7dd3fc", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", marginBottom: 2 }}>Valor</div>
                <div style={{ fontSize: 26, color: "#4ade80", fontWeight: 800, textAlign: "center", letterSpacing: "-0.5px", textShadow: "0 1px 6px rgba(0,0,0,0.7)" }}>{formatMoney(sharingPeca.valor)}</div>
              </div>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
