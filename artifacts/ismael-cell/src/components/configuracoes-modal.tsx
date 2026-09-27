import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Settings } from "lucide-react";
import { ConfigFinanceiro } from "./divisao-lucro";
import { MetasReservaConfig } from "./metas-reserva-config";

interface ConfiguracoesModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Tela de configurações financeiras do app: contas fixas, metas de compra e
 * reserva protegida.
 */
export function ConfiguracoesModal({ open, onClose }: ConfiguracoesModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-slate-600" />
            Configurações
          </DialogTitle>
          <DialogDescription>
            Ajuste contas, metas de compra e a reserva protegida. A reserva pode
            continuar aumentando automaticamente após novas entradas no Caixa.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <ConfigFinanceiro defaultOpen />
          <MetasReservaConfig open={open} defaultOpen />
        </div>
      </DialogContent>
    </Dialog>
  );
}
