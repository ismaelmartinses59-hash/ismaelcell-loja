---
name: Reembolso de vendas
description: Regra financeira e de estoque para estornar vendas sem apagar o histórico.
---

Reembolso de venda à vista deve manter a venda no histórico como reembolsada,
retirá-la dos totais de vendas, devolver uma unidade à peça e ao seu gêmeo e
lançar uma saída integral no Caixa em Dinheiro ou PIX.

**Why:** apagar a venda perde a trilha de auditoria e pode deixar a entrada
original no Caixa. Restaurar apenas um setor também quebra o estoque
compartilhado. O par entrada original + saída de reembolso preserva o histórico
e zera corretamente o efeito financeiro.

**How to apply:** permita reembolso apenas uma vez, somente em venda à vista com
entrada vinculada no Caixa. Fiado deve ser ajustado pelo A Receber. Depois do
reembolso, bloqueie exclusão da venda e dos lançamentos vinculados para impedir
segunda devolução de estoque ou divergência no Caixa.