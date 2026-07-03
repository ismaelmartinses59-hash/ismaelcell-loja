import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  PiggyBank,
  ChevronDown,
  ChevronUp,
  Settings2,
  Loader2,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function fmt(v: number): string {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

interface Divisao {
  dia: string;
  receita: number;
  custo: number;
  lucroBruto: number;
  percentualSalario: number;
  salario: number;
  diasTrabalhados: number;
  despesas: {
    aluguel: number;
    energia: number;
    internet: number;
    agua: number;
    total: number;
  };
  reinvestimento: number;
}

/** Painel pequeno com a divisão do lucro de um dia. */
export function DivisaoLucro({
  dia,
  enabled = true,
}: {
  dia: string;
  enabled?: boolean;
}) {
  const { data, isLoading, isError } = useQuery<Divisao>({
    queryKey: ["financeiro-divisao", dia],
    enabled: enabled && !!dia,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/financeiro/divisao?dia=${dia}`);
      if (!r.ok) throw new Error("erro ao carregar divisão");
      return r.json();
    },
  });

  if (isError) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-red-200 bg-red-50/50 p-3 text-center text-[11px] text-red-500">
        Não deu pra calcular a divisão do lucro agora. Tente reabrir o caixa.
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-emerald-200 bg-emerald-50/40 p-3 text-center text-[11px] text-slate-400">
        Calculando divisão do lucro...
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-800">
        <PiggyBank className="h-3.5 w-3.5" />
        Divisão do lucro do dia
      </div>

      <div className="mt-2 space-y-1 text-[11px]">
        <Linha label="Entrou (vendas + serviços)" valor={fmt(data.receita)} />
        <Linha
          label="Custo das peças"
          valor={`− ${fmt(data.custo)}`}
          cor="text-red-600"
        />
        <div className="flex justify-between border-t border-emerald-200 pt-1 font-bold text-slate-800">
          <span>Lucro do dia</span>
          <span>{fmt(data.lucroBruto)}</span>
        </div>
      </div>

      <div className="mt-2 space-y-1 text-[11px]">
        <div className="flex items-center justify-between rounded-md bg-amber-50 px-2 py-1">
          <span className="font-semibold text-amber-800">
            Seu salário ({data.percentualSalario.toLocaleString("pt-BR")}%)
          </span>
          <span className="font-bold text-amber-700">{fmt(data.salario)}</span>
        </div>
        <p className="px-2 text-[10px] leading-tight text-amber-600">
          Esse é o dinheiro pra transferir pra você.
        </p>

        <div className="flex justify-between px-2 pt-1">
          <span className="text-slate-600">
            Despesas do dia (÷ {data.diasTrabalhados} dias)
          </span>
          <span className="font-semibold text-red-600">
            − {fmt(data.despesas.total)}
          </span>
        </div>
        <div className="space-y-0.5 px-2 text-[10px] text-slate-400">
          <Mini label="Aluguel" valor={data.despesas.aluguel} />
          <Mini label="Energia" valor={data.despesas.energia} />
          <Mini label="Internet" valor={data.despesas.internet} />
          <Mini label="Água" valor={data.despesas.agua} />
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between rounded-md bg-emerald-600 px-2 py-1.5 text-white">
        <span className="text-[11px] font-semibold">Reinvestir na loja</span>
        <span className="text-sm font-bold">{fmt(data.reinvestimento)}</span>
      </div>
      <p className="mt-1 text-[10px] leading-tight text-slate-500">
        Esse fica na loja pra repor estoque — não é pra mexer.
      </p>
    </div>
  );
}

function Linha({
  label,
  valor,
  cor,
}: {
  label: string;
  valor: string;
  cor?: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={cor ?? "font-medium text-slate-700"}>{valor}</span>
    </div>
  );
}

function Mini({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span>− {fmt(valor)}</span>
    </div>
  );
}

interface ConfigFin {
  percentualSalario: string;
  diasTrabalhados: string;
  custoAluguel: string;
  custoEnergia: string;
  custoInternet: string;
  custoAgua: string;
}

const CAMPOS: { campo: keyof ConfigFin; label: string; dica?: string }[] = [
  { campo: "percentualSalario", label: "Seu salário (%)" },
  { campo: "diasTrabalhados", label: "Dias trabalhados no mês" },
  { campo: "custoAluguel", label: "Aluguel (valor do mês)" },
  { campo: "custoEnergia", label: "Energia (valor do mês)" },
  { campo: "custoInternet", label: "Internet (valor do mês)" },
  { campo: "custoAgua", label: "Água (valor do mês)" },
];

/** Editor retrátil dos valores (salário %, dias, contas fixas). */
export function ConfigFinanceiro({
  defaultOpen = false,
}: {
  defaultOpen?: boolean;
} = {}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [aberto, setAberto] = useState(defaultOpen);
  const [form, setForm] = useState<ConfigFin | null>(null);
  const [salvando, setSalvando] = useState(false);

  const { data } = useQuery<ConfigFin>({
    queryKey: ["financeiro-config"],
    enabled: aberto,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/financeiro/config`);
      if (!r.ok) throw new Error("erro ao carregar config");
      return r.json();
    },
  });

  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  const salvar = async () => {
    if (!form) return;
    setSalvando(true);
    try {
      const r = await fetch(`${BASE}/api/financeiro/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error("erro ao salvar");
      await qc.invalidateQueries({ queryKey: ["financeiro-config"] });
      await qc.invalidateQueries({ queryKey: ["financeiro-divisao"] });
      toast({ title: "Valores salvos!" });
    } catch {
      toast({ title: "Não deu pra salvar", variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="rounded-xl border bg-slate-50/60">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold text-slate-700"
      >
        <span className="flex items-center gap-1.5">
          <Settings2 className="h-4 w-4 text-slate-500" />
          Ajustar salário e contas fixas
        </span>
        {aberto ? (
          <ChevronUp className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        )}
      </button>

      {aberto && (
        <div className="space-y-2 border-t px-3 py-3">
          {!form ? (
            <p className="text-center text-xs text-slate-400">Carregando...</p>
          ) : (
            <>
              {CAMPOS.map(({ campo, label }) => (
                <div key={campo} className="space-y-0.5">
                  <label className="text-[11px] font-medium text-slate-600">
                    {label}
                  </label>
                  <Input
                    inputMode="decimal"
                    value={form[campo]}
                    onChange={(e) =>
                      setForm((f) =>
                        f ? { ...f, [campo]: e.target.value } : f,
                      )
                    }
                    className="h-9 text-sm"
                  />
                </div>
              ))}
              <Button
                onClick={salvar}
                disabled={salvando}
                className="mt-1 w-full bg-slate-700 hover:bg-slate-800"
              >
                {salvando ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {salvando ? "Salvando..." : "Salvar valores"}
              </Button>
              <p className="text-[10px] leading-tight text-slate-400">
                Mudou o aluguel, a internet ou quer ganhar mais? Ajuste aqui que
                a divisão do lucro no fechamento já usa os valores novos.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
