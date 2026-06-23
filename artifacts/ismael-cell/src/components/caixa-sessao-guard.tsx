import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Sun,
  Moon,
  ArrowUpCircle,
  ArrowDownCircle,
  Wallet,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const HORA_ABERTURA = 8; // 08:00 todos os dias úteis
const HORA_FECHAMENTO_SEMANA = 17; // seg–sex 17:00
const HORA_FECHAMENTO_SABADO = 13; // sábado 13:00

interface Sessao {
  id: number;
  data: string;
  status: string;
  valorInicial: string;
  valorFinal: string | null;
  totalEntradas: string | null;
  totalSaidas: string | null;
  aberturaAt: string;
  fechamentoAt: string | null;
}

interface StatusResp {
  sessao: Sessao | null;
  totalEntradas: number;
  totalSaidas: number;
  saldo: number;
}

function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

function formatMoney(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseValor(raw: string): number {
  if (!raw) return 0;
  return parseFloat(raw.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")) || 0;
}

export function CaixaSessaoGuard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [now, setNow] = useState(() => new Date());
  const [valorInicial, setValorInicial] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // Hora/data SEMPRE no fuso de São Paulo, independente do fuso do aparelho.
  const spNow = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }),
  );
  const data = localDate(spNow);

  const { data: status, refetch } = useQuery<StatusResp>({
    queryKey: ["caixa-sessao", data],
    queryFn: () =>
      fetch(`${BASE}/api/caixa-sessoes`).then((r) =>
        r.ok
          ? r.json()
          : { sessao: null, totalEntradas: 0, totalSaidas: 0, saldo: 0 },
      ),
    refetchInterval: 30000,
  });

  const dow = spNow.getDay(); // 0 = domingo, 6 = sábado
  const nowMin = spNow.getHours() * 60 + spNow.getMinutes();
  const openMin = HORA_ABERTURA * 60;
  const closeMin =
    (dow === 6 ? HORA_FECHAMENTO_SABADO : HORA_FECHAMENTO_SEMANA) * 60;

  let mode: "abrir" | "fechar" | null = null;
  if (dow !== 0 && status) {
    const sessao = status.sessao;
    if (!sessao && nowMin >= openMin) mode = "abrir";
    else if (sessao && sessao.status === "aberto" && nowMin >= closeMin)
      mode = "fechar";
  }

  const abrir = async () => {
    if (!valorInicial.trim()) {
      toast({ title: "Informe o valor inicial (troco)", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch(`${BASE}/api/caixa-sessoes/abrir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valorInicial: valorInicial.trim() }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Erro ao abrir");
      }
      toast({ title: "Caixa aberto! Bom trabalho 👍" });
      setValorInicial("");
      await qc.invalidateQueries({ queryKey: ["caixa-sessao", data] });
      await qc.invalidateQueries({ queryKey: ["caixa-historico"] });
      await refetch();
    } catch (e) {
      toast({
        title: "Erro ao abrir o caixa",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const fechar = async () => {
    setSubmitting(true);
    try {
      const r = await fetch(`${BASE}/api/caixa-sessoes/fechar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Erro ao fechar");
      }
      toast({ title: "Caixa fechado! Até amanhã 👋" });
      await qc.invalidateQueries({ queryKey: ["caixa-sessao", data] });
      await qc.invalidateQueries({ queryKey: ["caixa-historico"] });
      await refetch();
    } catch (e) {
      toast({
        title: "Erro ao fechar o caixa",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!mode) return null;

  const horaAlvo = mode === "abrir" ? openMin : closeMin;
  const horaAlvoStr = `${String(Math.floor(horaAlvo / 60)).padStart(2, "0")}:00`;

  const valIni = status?.sessao ? parseValor(status.sessao.valorInicial) : 0;
  const entradas = status?.totalEntradas ?? 0;
  const saidas = status?.totalSaidas ?? 0;
  const valFinal = valIni + entradas - saidas;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/95 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl overflow-hidden">
        {mode === "abrir" ? (
          <>
            <div className="bg-gradient-to-br from-amber-400 to-orange-500 px-6 py-7 text-center text-white">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/20">
                <Sun className="h-9 w-9" />
              </div>
              <h2 className="text-2xl font-extrabold">Hora de abrir o caixa!</h2>
              <p className="mt-1 text-sm text-white/90">
                O caixa deve abrir às {horaAlvoStr}. Agora são {hhmm(spNow)}.
              </p>
            </div>
            <div className="px-6 py-6 space-y-4">
              <div>
                <label className="text-sm font-semibold text-slate-700">
                  Quanto tem de troco pra começar? (R$)
                </label>
                <Input
                  inputMode="decimal"
                  autoFocus
                  placeholder="Ex: 150,00"
                  value={valorInicial}
                  onChange={(e) => setValorInicial(e.target.value)}
                  className="mt-1.5 h-12 text-lg"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !submitting) abrir();
                  }}
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  É o dinheiro que já está na gaveta pra dar troco.
                </p>
              </div>
              <Button
                className="h-12 w-full text-base font-bold"
                onClick={abrir}
                disabled={submitting}
              >
                {submitting && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                Abrir caixa
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 px-6 py-7 text-center text-white">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/20">
                <Moon className="h-9 w-9" />
              </div>
              <h2 className="text-2xl font-extrabold">Hora de fechar o caixa!</h2>
              <p className="mt-1 text-sm text-white/90">
                O caixa fecha às {horaAlvoStr}. Agora são {hhmm(spNow)}.
              </p>
            </div>
            <div className="px-6 py-6 space-y-4">
              <div className="rounded-2xl border bg-slate-50 p-4 space-y-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-slate-600">
                    <Wallet className="h-4 w-4" /> Troco inicial
                  </span>
                  <span className="font-semibold text-slate-800">
                    {formatMoney(valIni)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-green-600">
                    <ArrowUpCircle className="h-4 w-4" /> Entradas
                  </span>
                  <span className="font-semibold text-green-700">
                    +{formatMoney(entradas)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-red-600">
                    <ArrowDownCircle className="h-4 w-4" /> Saídas
                  </span>
                  <span className="font-semibold text-red-700">
                    −{formatMoney(saidas)}
                  </span>
                </div>
                <div className="border-t pt-2.5 flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-700">
                    Deve ter na gaveta
                  </span>
                  <span className="text-xl font-extrabold text-emerald-600">
                    {formatMoney(valFinal)}
                  </span>
                </div>
              </div>
              <Button
                className="h-12 w-full text-base font-bold"
                onClick={fechar}
                disabled={submitting}
              >
                {submitting && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                Fechar caixa
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
