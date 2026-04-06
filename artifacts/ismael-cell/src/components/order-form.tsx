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
import { SERVICES_BY_LINE, ESTIMATED_TIMES } from "@/lib/constants";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

const createOrderSchema = z.object({
  modelo: z.string().min(1, "Modelo é obrigatório"),
  linha: z.nativeEnum(OrderLinha),
  servico: z.string().min(1, "Serviço é obrigatório"),
  valor: z.string().min(1, "Valor é obrigatório"),
  tempo: z.string().min(1, "Tempo é obrigatório"),
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
    },
  });

  const watchLinha = form.watch("linha");
  const watchServico = form.watch("servico");

  // When prefill changes (e.g. "Refazer" clicked), reset form with prefilled values
  useEffect(() => {
    if (prefill) {
      form.reset({
        modelo: prefill.modelo,
        linha: prefill.linha,
        servico: "",
        valor: "",
        tempo: "",
      });
    }
  }, [prefill, form]);

  // Reset servico when linha changes
  useEffect(() => {
    if (watchLinha) {
      form.setValue("servico", "");
    }
  }, [watchLinha, form]);

  // Auto-fill tempo when servico changes
  useEffect(() => {
    if (watchServico && ESTIMATED_TIMES[watchServico]) {
      form.setValue("tempo", ESTIMATED_TIMES[watchServico]);
    }
  }, [watchServico, form]);

  const availableServices = watchLinha ? SERVICES_BY_LINE[watchLinha] : [];

  const onSubmit = (data: CreateOrderForm) => {
    // Check for duplicate active order with same model
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
              <Select
                onValueChange={field.onChange}
                value={field.value}
                disabled={!watchLinha}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={watchLinha ? "Selecione o serviço" : "Selecione a linha primeiro"} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {availableServices?.map((srv) => (
                    <SelectItem key={srv} value={srv}>
                      {srv}
                    </SelectItem>
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

        <Button type="submit" className="w-full mt-4" disabled={createOrder.isPending}>
          {createOrder.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Criar Ordem
        </Button>
      </form>
    </Form>
  );
}
