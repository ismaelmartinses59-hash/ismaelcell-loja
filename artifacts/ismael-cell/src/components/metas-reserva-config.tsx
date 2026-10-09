import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, LockKeyhole, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { fetchWithSession } from "@/lib/api-fetch";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type FinanceGoalsSnapshot = {
  saldos: { reserva: number; protecaoAtiva: boolean };
  metaCompra: number;
};

type FinanceGoalsForm = {
  reserva: string;
  metaCompra: string;
  proteger: boolean;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithSession(`${BASE}/api${path}`, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(response.status === 401
      ? "Para proteger seus dados financeiros, saia e entre novamente no sistema."
      : body.error ?? "Não foi possível carregar as metas e a reserva.");
  }
  return body as T;
}

export function MetasReservaConfig({
  open,
  defaultOpen = false,
}: {
  open: boolean;
  defaultOpen?: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [aberto, setAberto] = useState(defaultOpen);
  const [form, setForm] = useState<FinanceGoalsForm | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<FinanceGoalsSnapshot>({
    queryKey: ["financeiro-ia"],
    enabled: open && aberto,
    staleTime: 0,
    queryFn: () => api<FinanceGoalsSnapshot>("/financeiro-ia"),
  });

  useEffect(() => {
    if (!open) {
      setDirty(false);
      setForm(null);
      return;
    }
    if (!aberto || !data || dirty) return;
    setForm({
      reserva: data.saldos.reserva.toFixed(2),
      metaCompra: data.metaCompra.toFixed(2),
      proteger: data.saldos.protecaoAtiva,
    });
  }, [open, aberto, data, dirty]);

  function updateMoney(field: "reserva" | "metaCompra", value: string) {
    setDirty(true);
    setForm(current => current ? { ...current, [field]: value } : current);
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      await api("/financeiro-ia/config", {
        method: "PUT",
        body: JSON.stringify({
          reserva: form.reserva,
          metaCompra: form.metaCompra,
          protecaoAtiva: form.proteger,
        }),
      });
      await qc.invalidateQueries({ queryKey: ["financeiro-ia"] });
      setDirty(false);
      toast({ title: "Metas e reserva atualizadas" });
    } catch (err) {
      toast({
        title: "Não foi possível salvar as metas e a reserva",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border bg-slate-50/60">
      <button
        type="button"
        data-testid="button-expandir-metas-reserva"
        onClick={() => setAberto(value => !value)}
        aria-expanded={aberto}
        aria-controls="painel-metas-reserva"
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold text-slate-700"
      >
        <span className="flex items-center gap-1.5">
          <Settings2 className="h-4 w-4 text-slate-500" />
          Metas e reserva
        </span>
        {aberto
          ? <ChevronUp className="h-4 w-4 text-slate-400" />
          : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>

      {aberto && (
        <div id="painel-metas-reserva" className="space-y-3 border-t px-3 py-3">
          {!data && isLoading && (
            <p role="status" className="text-center text-xs text-slate-500">Carregando metas e reserva...</p>
          )}
          {!data && error && (
            <div className="space-y-2 text-sm text-red-700">
              <p>{error instanceof Error ? error.message : "Não foi possível carregar as metas e a reserva."}</p>
              <Button type="button" variant="outline" onClick={() => void refetch()}>Tentar novamente</Button>
            </div>
          )}
          {data && !form && (
            <p role="status" className="text-center text-xs text-slate-500">Carregando metas e reserva...</p>
          )}
          {form && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs text-slate-600">
                  Reserva atual (R$)
                  <Input
                    data-testid="input-reserva"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    className="mt-1"
                    value={form.reserva}
                    onChange={event => updateMoney("reserva", event.target.value)}
                  />
                </label>
                <label className="text-xs text-slate-600">
                  Valor para a próxima compra (R$)
                  <Input
                    data-testid="input-meta-compra"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    className="mt-1"
                    value={form.metaCompra}
                    onChange={event => updateMoney("metaCompra", event.target.value)}
                  />
                </label>
              </div>
              <p className="text-xs leading-relaxed text-slate-600">
                Com a proteção ativa, o app pode aumentar a reserva depois que uma nova entrada em dinheiro ou PIX for registrada e aparecer no saldo. O aumento é gradual, considera as contas e os pedidos e não tem valor máximo. Saldo antigo sozinho não gera aumento.
              </p>
              <p className="text-[11px] leading-relaxed text-slate-500">
                A reserva é uma proteção no cálculo do app, não uma transferência nem uma saída do Caixa. Um ajuste manual não impede novos aumentos automáticos quando houver saldo e novas entradas.
              </p>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  data-testid="toggle-protecao-reserva"
                  type="checkbox"
                  checked={form.proteger}
                  onChange={event => {
                    const proteger = event.target.checked;
                    setDirty(true);
                    setForm(current => current ? { ...current, proteger } : current);
                  }}
                  className="mt-0.5"
                />
                Proteger a reserva e permitir aumentos automáticos
              </label>
              <Button
                data-testid="button-salvar-financas"
                type="button"
                className="w-full"
                disabled={saving || !data}
                onClick={() => void save()}
              >
                {saving ? "Salvando..." : "Salvar configuração"}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}