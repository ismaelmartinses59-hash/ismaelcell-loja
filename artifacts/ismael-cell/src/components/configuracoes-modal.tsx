import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Settings } from "lucide-react";
import { ConfigFinanceiro } from "./divisao-lucro";

interface ConfiguracoesModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Tela de Configurações do app. Hoje contém só o ajuste de salário e contas
 * fixas (usado na divisão do lucro), tirado de dentro do modal do Caixa para
 * ficar num lugar próprio de configuração.
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
            Ajuste o salário e as contas fixas usados no cálculo da divisão do
            lucro no fechamento do caixa.
          </DialogDescription>
        </DialogHeader>
        <ConfigFinanceiro defaultOpen />
      </DialogContent>
    </Dialog>
  );
}
