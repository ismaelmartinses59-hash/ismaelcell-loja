---
name: Reembolso de vendas
description: Regra financeira e de estoque para estornar vendas sem apagar o histórico.
---

Reembolso de venda à vista deve manter a venda no histórico como reembolsada,
retirá-la dos totais de vendas, devolver uma unidade à peça e ao seu gêmeo e
lançar uma saída integral no Caixa em Dinheiro, PIX ou Cartão. Entradas manuais
de itens e serviços também podem ser reembolsadas pelo próprio Caixa, sem
movimentar estoque quando não houver venda de peça vinculada.

**Why:** apagar a venda perde a trilha de auditoria e pode deixar a entrada
original no Caixa. Restaurar apenas um setor também quebra o estoque
compartilhado. O par entrada original + saída de reembolso preserva o histórico
e zera corretamente o efeito financeiro.

**How to apply:** permita reembolso apenas uma vez em entradas do Caixa; AV/fiado
deve ser ajustado pelo A Receber. Em vendas mistas, some todas as entradas da
mesma venda e devolva o estoque uma única vez. Reembolso no cartão não altera a
gaveta. Depois do reembolso, bloqueie exclusão da venda e dos lançamentos
vinculados. A ação deve estar disponível no próprio lançamento, tanto na lista
de hoje quanto no detalhe diário do Histórico do Caixa; após o estorno, mostre
ali o estado persistente "Reembolsado".