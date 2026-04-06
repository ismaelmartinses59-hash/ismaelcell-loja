import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCreateOrder, getListOrdersQueryKey, getGetOrderStatsQueryKey, OrderLinha, OrderTipo } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { SERVICES_BY_LINE, SERVICES_BY_LINE_CLIENTE, ESTIMATED_TIMES } from "@/lib/constants";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

const GARANTIA_OPTIONS = ["Sem garantia", "7 dias", "30 dias", "90 dias", "6 meses", "1 ano"];

const createOrderSchema = z.object({
  modelo: z.string().min(1, "Modelo é obrigatório"),
  linha: z.nativeEnum(OrderLinha),
  servico: z.string().min(1, "Serviço é obrigatório"),
  valor: z.string().min(1, "Valor é obrigatório"),
  tempo: z.string().min(1, "Tempo é obrigatório"),
  nomeCliente: z.string().optional(),
  senhaDispo: z.string().optional(),
  garantia: z.string().optional(),
  dataServico: z.string().optional(),
});

type CreateOrderForm = z.infer<typeof createOrderSchema>;

interface OrderFormProps {
  onSuccess?: () => void;
  prefill?: { modelo: string; linha: OrderLinha } | null;
  activeModels?: string[];
  tipo?: OrderTipo;
}

export function OrderForm({ onSuccess, prefill, activeModels = [], tipo = OrderTipo.lojista }: OrderFormProps = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createOrder = useCreateOrder();

  const form = useForm<CreateOrderForm>({
    resolver: zodResolver(createOrderSchema),
    defaultValues: {
      modelo: prefill?.modelo ?? "",
      linha: prefill?.linha ?? undefined,
      servico: "",
      valor: "",
      tempo: "",
      nomeCliente: "",
      senhaDispo: "",
      garantia: "",
      dataServico: "",
    },
  });

  const watchLinha = form.watch("linha");
  const watchServico = form.watch("servico");

  useEffect(() => {
    if (prefill) {
      form.reset({
        modelo: prefill.modelo,
        linha: prefill.linha,
        servico: "",
        valor: "",
        tempo: "",
        nomeCliente: "",
        senhaDispo: "",
        garantia: "",
        dataServico: "",
      });
    }
  }, [prefill, form]);

  useEffect(() => {
    if (watchLinha) {
      form.setValue("servico", "");
    }
  }, [watchLinha, form]);

  useEffect(() => {
    if (watchServico && ESTIMATED_TIMES[watchServico]) {
      form.setValue("tempo", ESTIMATED_TIMES[watchServico]);
    }
  }, [watchServico, form]);

  const serviceMap = tipo === OrderTipo.cliente ? SERVICES_BY_LINE_CLIENTE : SERVICES_BY_LINE;
  const availableServices = watchLinha ? serviceMap[watchLinha] : [];

  const onSubmit = (data: CreateOrderForm) => {
    const isDuplicate = activeModels.some(
      (m) => m.trim().toLowerCase() === data.modelo.trim().toLowerCase()
    );

    if (isDuplicate) {
      toast({
        title: "Modelo já existe",
        description: `"${data.modelo}" já está cadastrado. Exclua a ordem existente para criar uma nova.`,
        variant: "destructive",
      });
      return;
    }

    createOrder.mutate(
      { data: { ...data, tipo } },
      {
        onSuccess: (order) => {
          form.reset({
            modelo: "",
            linha: undefined,
            servico: "",
            valor: "",
            tempo: "",
            nomeCliente: "",
            senhaDispo: "",
            garantia: "",
            dataServico: "",
          });
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetOrderStatsQueryKey() });

          const base = import.meta.env.BASE_URL.replace(/\/$/, "");
          const statusUrl = `${window.location.origin}${base}/status/${order.codigo}`;
          const shareUrl = `https://wa.me/?text=${encodeURIComponent(`🔗 Acompanhe sua ordem:\n${statusUrl}`)}`;

          toast({
            title: "Ordem criada!",
            description: `Código: ${order.codigo}`,
            action: (
              <Button size="sm" variant="outline" onClick={() => window.open(shareUrl, "_blank")}>
                Compartilhar
              </Button>
            ),
          });
          onSuccess?.();
        },
        onError: () => {
          toast({
            title: "Erro ao criar ordem",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {tipo === OrderTipo.cliente && (
          <FormField
            control={form.control}
            name="nomeCliente"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nome do Cliente</FormLabel>
                <FormControl>
                  <Input placeholder="Ex: João Silva" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="linha"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Linha / Marca</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a linha" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={OrderLinha.xiaomi}>Xiaomi</SelectItem>
                  <SelectItem value={OrderLinha.samsung}>Samsung</SelectItem>
                  <SelectItem value={OrderLinha.motorola}>Motorola</SelectItem>
                  <SelectItem value={OrderLinha.ios}>iOS (Apple)</SelectItem>
                  <SelectItem value={OrderLinha.realme}>Realme</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="modelo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Modelo Específico</FormLabel>
              <FormControl>
                <Input placeholder="Ex: Redmi Note 12" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="servico"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Serviço</FormLabel>
              <Select onValueChange={field.onChange} value={field.value} disabled={!watchLinha}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={watchLinha ? "Selecione o serviço" : "Selecione a linha primeiro"} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {availableServices?.map((srv) => (
                    <SelectItem key={srv} value={srv}>{srv}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="valor"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Valor (R$)</FormLabel>
                <FormControl>
                  <Input placeholder="150,00" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="tempo"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tempo Estimado</FormLabel>
                <FormControl>
                  <Input placeholder="10 a 60 min" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
            control={form.control}
            name="garantia"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Garantia</FormLabel>
                <Select onValueChange={field.onChange} value={field.value || ""}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {GARANTIA_OPTIONS.map((g) => (
                      <SelectItem key={g} value={g}>{g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

        <FormField
          control={form.control}
          name="senhaDispo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Senha do Aparelho</FormLabel>
              <FormControl>
                <Input placeholder="PIN ou padrão de desbloqueio" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full mt-4" disabled={createOrder.isPending}>
          {createOrder.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Criar Ordem
        </Button>
      </form>
    </Form>
  );
}
