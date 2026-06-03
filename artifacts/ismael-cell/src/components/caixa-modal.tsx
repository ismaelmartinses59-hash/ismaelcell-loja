import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useListCaixa,
  useCreateCaixa,
  useDeleteCaixa,
  getListCaixaQueryKey,
  type CaixaMovimento,
  type ListCaixaParams,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Wallet,
  ArrowDownCircle,
  ArrowUpCircle,
  Trash2,
  Loader2,
  Package,
  Check,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Peca {
  id: number;
  modelo: string;
  qualidade: string;
  valor: string;
  quantidade: number;
  setor: string;
}

function formatMoney(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseMoney(val: string): number {
  if (!val) return 0;
  return parseFloat(val.replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;
}

interface CaixaModalProps {
  open: boolean;
  onClose: () => void;
}

const PERIODOS = [
  { key: "7", label: "7 dias" },
  { key: "15", label: "15 dias" },
  { key: "30", label: "30 dias" },
  { key: "custom", label: "Por data" },
] as const;

type PeriodoKey = (typeof PERIODOS)[number]["key"];

export function CaixaModal({ open, onClose }: CaixaModalProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [periodo, setPeriodo] = useState<PeriodoKey>("30");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");

  const params: ListCaixaParams =
    periodo === "custom" && inicio && fim ? { inicio, fim } : { periodo: periodo === "custom" ? "30" : periodo };

  const { data, isLoading } = useListCaixa(params, {
    query: { queryKey: getListCaixaQueryKey(params), enabled: open },
  });

  const [tipo, setTipo] = useState<"entrada" | "saida">("entrada");
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [vincularPeca, setVincularPeca] = useState(false);
  const [modeloBusca, setModeloBusca] = useState("");
  const [pecaSel, setPecaSel] = useState<Peca | null>(null);

  const { data: pecas = [] } = useQuery<Peca[]>({
    queryKey: ["caixa-pecas"],
    enabled: open && tipo === "entrada" && vincularPeca,
    queryFn: async () => {
      const [loj, cli] = await Promise.all([
        fetch(`${BASE}/api/pecas?setor=lojista`).then((r) => (r.ok ? r.json() : [])),
        fetch(`${BASE}/api/pecas?setor=cliente`).then((r) => (r.ok ? r.json() : [])),
      ]);
      const merged: Peca[] = [...loj, ...cli];
      const seen = new Set<string>();
      const dedup: Peca[] = [];
      for (const p of merged) {
        const key = `${p.modelo.trim().toLowerCase()}|${p.qualidade.trim().toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dedup.push(p);
      }
      return dedup;
    },
  });

  const sugestoes = useMemo(() => {
    const q = modeloBusca.trim().toLowerCase();
    if (!q) return [];
    return pecas
      .filter(
        (p) =>
          p.modelo.toLowerCase().includes(q) ||
          p.qualidade.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [modeloBusca, pecas]);

  const createCaixa = useCreateCaixa();
  const deleteCaixa = useDeleteCaixa();

  const resetForm = () => {
    setValor("");
    setMotivo("");
    setVincularPeca(false);
    setModeloBusca("");
    setPecaSel(null);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/caixa"] });
    qc.invalidateQueries({ queryKey: ["caixa-pecas"] });
    qc.invalidateQueries({ queryKey: ["pecas"] });
    qc.invalidateQueries({ queryKey: ["vendas"] });
  };

  const selecionarPeca = (p: Peca) => {
    setPecaSel(p);
    setModeloBusca(`${p.modelo} — ${p.qualidade}`);
    if (!valor) setValor(p.valor);
    if (!motivo) setMotivo(`Troca de tela (${p.modelo})`);
  };

  const onSubmit = () => {
    if (!valor.trim()) {
      toast({ title: "Informe o valor", variant: "destructive" });
      return;
    }
    if (!motivo.trim()) {
      toast({ title: "Motivo é obrigatório", variant: "destructive" });
      return;
    }
    if (tipo === "entrada" && vincularPeca && !pecaSel) {
      toast({ title: "Selecione a peça na lista", variant: "destructive" });
      return;
    }
    createCaixa.mutate(
      {
        data: {
          tipo,
          valor: valor.trim(),
          motivo: motivo.trim(),
          pecaId:
            tipo === "entrada" && vincularPeca && pecaSel ? pecaSel.id : null,
        },
      },
      {
        onSuccess: () => {
          toast({
            title:
              tipo === "entrada" ? "Entrada registrada!" : "Saída registrada!",
          });
          resetForm();
          invalidate();
        },
        onError: (e) => {
          toast({
            title: "Erro ao registrar",
            description: e instanceof Error ? e.message : undefined,
            variant: "destructive",
          });
        },
      },
    );
  };

  const onDelete = (m: CaixaMovimento) => {
    const msg = `Excluir esta ${m.tipo === "entrada" ? "entrada" : "saída"} de ${formatMoney(parseMoney(m.valor))}?${m.vendaId ? "\n\nO estoque da peça será devolvido e a venda removida." : ""}`;
    if (!window.confirm(msg)) return;
    deleteCaixa.mutate(
      { id: m.id },
      {
        onSuccess: () => {
          toast({ title: "Movimento excluído" });
          invalidate();
        },
        onError: () => toast({ title: "Erro ao excluir", variant: "destructive" }),
      },
    );
  };

  const totalEntradas = data?.totalEntradas ?? 0;
  const totalSaidas = data?.totalSaidas ?? 0;
  const saldo = data?.saldo ?? 0;
  const movimentos = data?.movimentos ?? [];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Wallet className="w-5 h-5 text-emerald-600" />
            Caixa
          </DialogTitle>
        </DialogHeader>

        {/* Saldo + totais */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-center">
            <p className="text-[10px] text-green-700 uppercase tracking-wider font-medium">
              Entradas
            </p>
            <p className="text-sm font-bold text-green-700">
              {formatMoney(totalEntradas)}
            </p>
          </div>
          <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-center">
            <p className="text-[10px] text-red-700 uppercase tracking-wider font-medium">
              Saídas
            </p>
            <p className="text-sm font-bold text-red-700">
              {formatMoney(totalSaidas)}
            </p>
          </div>
          <div
            className={`rounded-xl border p-3 text-center ${saldo >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}
          >
            <p
              className={`text-[10px] uppercase tracking-wider font-medium ${saldo >= 0 ? "text-emerald-700" : "text-amber-700"}`}
            >
              Saldo
            </p>
            <p
              className={`text-sm font-bold ${saldo >= 0 ? "text-emerald-700" : "text-amber-700"}`}
            >
              {formatMoney(saldo)}
            </p>
          </div>
        </div>

        {/* Formulário */}
        <div className="rounded-xl border bg-muted/30 p-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setTipo("entrada")}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors border ${
                tipo === "entrada"
                  ? "bg-green-600 text-white border-green-600"
                  : "bg-white text-green-700 border-green-200 hover:bg-green-50"
              }`}
            >
              <ArrowUpCircle className="w-4 h-4" />
              Entrada
            </button>
            <button
              type="button"
              onClick={() => {
                setTipo("saida");
                setVincularPeca(false);
                setPecaSel(null);
                setModeloBusca("");
              }}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors border ${
                tipo === "saida"
                  ? "bg-red-600 text-white border-red-600"
                  : "bg-white text-red-700 border-red-200 hover:bg-red-50"
              }`}
            >
              <ArrowDownCircle className="w-4 h-4" />
              Saída
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Valor (R$)
              </label>
              <Input
                inputMode="decimal"
                placeholder="220,00"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Motivo *
              </label>
              <Input
                placeholder="Ex: conta INSS"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </div>
          </div>

          {tipo === "entrada" && (
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={vincularPeca}
                onChange={(e) => {
                  setVincularPeca(e.target.checked);
                  if (!e.target.checked) {
                    setPecaSel(null);
                    setModeloBusca("");
                  }
                }}
                className="h-4 w-4 accent-emerald-600"
              />
              <span className="flex items-center gap-1.5 text-foreground">
                <Package className="w-3.5 h-3.5 text-muted-foreground" />
                É troca de tela / peça (baixa o estoque)
              </span>
            </label>
          )}

          {tipo === "entrada" && vincularPeca && (
            <div className="relative">
              <Input
                placeholder="Digite o modelo... ex: A03 Core"
                value={modeloBusca}
                onChange={(e) => {
                  setModeloBusca(e.target.value);
                  setPecaSel(null);
                }}
              />
              {pecaSel && (
                <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-700">
                  <Check className="w-3.5 h-3.5" />
                  {pecaSel.modelo} — {pecaSel.qualidade} ({pecaSel.quantidade} em
                  estoque)
                </div>
              )}
              {!pecaSel && sugestoes.length > 0 && (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg overflow-hidden">
                  {sugestoes.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selecionarPeca(p)}
                      className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between gap-2"
                    >
                      <span className="text-sm">
                        <span className="font-medium">{p.modelo}</span>
                        <span className="text-muted-foreground"> — {p.qualidade}</span>
                      </span>
                      <span
                        className={`text-xs font-semibold shrink-0 ${p.quantidade > 0 ? "text-emerald-600" : "text-red-500"}`}
                      >
                        {p.quantidade} un.
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {!pecaSel &&
                modeloBusca.trim().length > 0 &&
                sugestoes.length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Nenhuma peça encontrada no estoque.
                  </p>
                )}
            </div>
          )}

          <Button
            className="w-full"
            onClick={onSubmit}
            disabled={createCaixa.isPending}
          >
            {createCaixa.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Registrar {tipo === "entrada" ? "entrada" : "saída"}
          </Button>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-2">
          {PERIODOS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriodo(p.key)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                periodo === p.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground border-transparent hover:border-muted-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {periodo === "custom" && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                De
              </label>
              <Input
                type="date"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Até
              </label>
              <Input
                type="date"
                value={fim}
                onChange={(e) => setFim(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Lista de movimentos */}
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Carregando...
          </div>
        ) : movimentos.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Nenhuma movimentação no período.
          </div>
        ) : (
          <div className="space-y-2">
            {movimentos.map((m) => {
              const isEntrada = m.tipo === "entrada";
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-3 rounded-lg border bg-white px-3 py-2"
                >
                  {isEntrada ? (
                    <ArrowUpCircle className="w-5 h-5 text-green-600 shrink-0" />
                  ) : (
                    <ArrowDownCircle className="w-5 h-5 text-red-600 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">
                      {m.motivo}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {format(new Date(m.createdAt), "dd/MM/yyyy 'às' HH:mm", {
                        locale: ptBR,
                      })}
                      {m.modelo ? ` · ${m.modelo}` : ""}
                    </p>
                  </div>
                  <span
                    className={`text-sm font-bold shrink-0 ${isEntrada ? "text-green-700" : "text-red-700"}`}
                  >
                    {isEntrada ? "+" : "−"}
                    {formatMoney(parseMoney(m.valor))}
                  </span>
                  <button
                    onClick={() => onDelete(m)}
                    className="text-muted-foreground hover:text-red-600 transition-colors shrink-0"
                    title="Excluir"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
