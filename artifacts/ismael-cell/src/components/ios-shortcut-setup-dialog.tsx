import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetIosShortcutStatusQueryKey,
  useCreateIosShortcutToken,
  useGetIosShortcutStatus,
  useRevokeIosShortcutToken,
} from "@workspace/api-client-react";
import { Copy, ExternalLink, KeyRound, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface IosShortcutSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IosShortcutSetupDialog({ open, onOpenChange }: IosShortcutSetupDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const statusQuery = useGetIosShortcutStatus({
    query: {
      queryKey: getGetIosShortcutStatusQueryKey(),
      enabled: open,
      staleTime: 0,
    },
  });
  const createToken = useCreateIosShortcutToken();
  const revokeToken = useRevokeIosShortcutToken();
  const [token, setToken] = useState<string | null>(null);
  const endpoint = `${window.location.origin}${BASE}/api/share-shortcut/ios/import`;
  const openImportUrl = `${window.location.origin}${BASE}/ordens?abrirEstoque=1`;

  useEffect(() => {
    if (!open) setToken(null);
  }, [open]);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copiado` });
    } catch {
      toast({ title: "Não consegui copiar", description: "Selecione o texto e copie manualmente.", variant: "destructive" });
    }
  };

  const handleCreate = async () => {
    try {
      const result = await createToken.mutateAsync();
      setToken(result.token);
      await queryClient.invalidateQueries({ queryKey: getGetIosShortcutStatusQueryKey() });
    } catch (error) {
      toast({
        title: "Não consegui criar o código",
        description: error instanceof Error ? error.message : "Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const handleRevoke = async () => {
    try {
      await revokeToken.mutateAsync();
      setToken(null);
      await queryClient.invalidateQueries({ queryKey: getGetIosShortcutStatusQueryKey() });
      toast({ title: "Código do Atalho revogado" });
    } catch {
      toast({ title: "Não consegui revogar o código", variant: "destructive" });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setToken(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" />
            Atalho para o Compartilhar do iPhone
          </DialogTitle>
          <DialogDescription>
            O app abre primeiro e mostra a espera enquanto o Atalho envia a nota. Depois, você revisa as peças; o estoque só muda após sua confirmação.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="font-medium">1. Gere um código de envio</p>
            <p className="mt-1 text-muted-foreground">
              {statusQuery.data?.configured
                ? "Já existe um código ativo. Gerar outro substitui o anterior e desconecta o Atalho antigo."
                : "O código é mostrado uma única vez e só permite enviar PDFs para leitura."}
            </p>
            <Button className="mt-3" size="sm" onClick={() => void handleCreate()} disabled={createToken.isPending}>
              <KeyRound className="mr-2 h-4 w-4" />
              {createToken.isPending ? "Gerando..." : statusQuery.data?.configured ? "Gerar outro código" : "Gerar código"}
            </Button>
            {statusQuery.isError && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                Não consegui verificar se já existe um código ativo. Você ainda pode gerar um novo.
              </p>
            )}
          </div>

          {token && (
            <div className="space-y-3 rounded-lg border border-emerald-300 bg-emerald-50/60 p-3">
              <p className="font-medium text-emerald-900">Guarde o código agora</p>
              <div className="flex gap-2">
                <Input aria-label="Código do Atalho" readOnly value={token} className="min-w-0 font-mono text-xs" />
                <Button type="button" variant="outline" size="icon" aria-label="Copiar código" onClick={() => void copy(token, "Código")}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-emerald-900/80">
                O código não pode ser consultado depois. Se perdê-lo, gere outro; o anterior será revogado.
              </p>
            </div>
          )}

          <div className="space-y-3">
            <p className="font-medium">2. Configure o Atalho no iPhone</p>
            <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
              <li>
                No app <strong className="text-foreground">Atalhos</strong>, crie um atalho e, nos detalhes, ative{" "}
                <strong className="text-foreground">Mostrar na Folha de Compartilhamento</strong>. Aceite PDFs e imagens.
              </li>
              <li>
                Primeiro adicione a ação <strong className="text-foreground">Abrir URLs</strong> com o endereço de importação abaixo. Ela precisa vir antes do envio.
              </li>
              <li>
                Depois, adicione <strong className="text-foreground">Codificar em Base64</strong> para a Entrada do Atalho.
              </li>
              <li>
                Adicione <strong className="text-foreground">Obter Conteúdo do URL</strong>: método POST e corpo JSON com{" "}
                <code>fileBase64</code> igual ao resultado Base64. O servidor identifica se é PDF ou imagem; se já existir um campo{" "}
                <code>mimeType</code>, ele pode permanecer. No cabeçalho <code>Authorization</code>, use{" "}
                <code>Bearer [seu código]</code>.
              </li>
              <li>
                Da resposta, obtenha o valor <code>openUrl</code> e use outra ação <strong className="text-foreground">Abrir URLs</strong> para mostrar as peças lidas.
              </li>
            </ol>
          </div>

          <div className="space-y-2">
            <p className="font-medium">Endereço para abrir o app primeiro</p>
            <div className="flex gap-2">
              <Input aria-label="Endereço para abrir a importação" readOnly value={openImportUrl} className="min-w-0 text-xs" />
              <Button type="button" variant="outline" size="icon" aria-label="Copiar endereço de importação" onClick={() => void copy(openImportUrl, "Endereço de importação")}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="font-medium">Endereço da ação Obter Conteúdo do URL</p>
            <div className="flex gap-2">
              <Input aria-label="Endereço para envio do PDF" readOnly value={endpoint} className="min-w-0 text-xs" />
              <Button type="button" variant="outline" size="icon" aria-label="Copiar endereço" onClick={() => void copy(endpoint, "Endereço")}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
            O código permite enviar PDFs para leitura automática. Não o compartilhe. Revogue-o aqui se não quiser mais usar o Atalho.
          </div>

          {statusQuery.data?.configured && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={revokeToken.isPending}
              onClick={() => void handleRevoke()}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              {revokeToken.isPending ? "Revogando..." : "Revogar código"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
