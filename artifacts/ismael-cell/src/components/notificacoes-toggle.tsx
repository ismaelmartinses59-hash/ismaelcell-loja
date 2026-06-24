import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  type PushStatus,
  getPushStatus,
  enablePush,
  disablePush,
} from "@/lib/push-client";

export function NotificacoesToggle() {
  const { toast } = useToast();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPushStatus().then(setStatus);
  }, []);

  if (status === null) return null;
  if (status === "unsupported") return null;

  async function handleEnable() {
    setBusy(true);
    try {
      const next = await enablePush();
      setStatus(next);
      if (next === "subscribed") {
        toast({
          title: "Avisos ativados ✅",
          description:
            "Você vai receber um aviso às 8h para abrir e às 17h para fechar o caixa.",
        });
      } else if (next === "denied") {
        toast({
          title: "Permissão negada",
          description:
            "As notificações estão bloqueadas. Libere nas configurações do navegador para ativar.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Não deu para ativar",
        description: "Tente novamente em instantes.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    try {
      const next = await disablePush();
      setStatus(next);
      toast({ title: "Avisos desativados" });
    } finally {
      setBusy(false);
    }
  }

  const isOn = status === "subscribed";

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            isOn ? "bg-indigo-600 text-white" : "bg-indigo-100 text-indigo-600"
          }`}
        >
          {isOn ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-indigo-900">
            Avisos no celular
          </div>
          <div className="text-[11px] leading-tight text-indigo-700">
            {status === "denied"
              ? "Bloqueado — libere nas configurações do navegador."
              : isOn
                ? "Ligado: aviso às 8h (abrir) e 17h (fechar)."
                : "Receba o lembrete de abrir e fechar o caixa."}
          </div>
        </div>
        {status === "denied" ? null : isOn ? (
          <Button
            size="sm"
            variant="outline"
            onClick={handleDisable}
            disabled={busy}
            className="shrink-0"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Desligar"}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleEnable}
            disabled={busy}
            className="shrink-0 bg-indigo-600 hover:bg-indigo-700"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ativar"}
          </Button>
        )}
      </div>
    </div>
  );
}
