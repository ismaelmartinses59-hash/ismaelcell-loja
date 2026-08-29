---
name: Pagamento de provisões
description: Regras de atomicidade e atualização de tela ao pagar contas fixas ou extras.
---

O pagamento de uma provisão só está concluído quando o status de pago e a saída
correspondente no Caixa foram gravados juntos.

**Why:** ler configuração pelo acesso global ao banco enquanto uma transação já
segura a conexão pode bloquear em produção. Além disso, atualizar apenas o cache
da configuração deixa o Caixa exibindo uma lista antiga, mesmo após a saída ser
criada.

**How to apply:** carregue dados necessários antes de abrir a transação e faça a
gravação do status e da saída dentro dela. Após sucesso, invalide configuração,
divisão financeira, movimentos do dia, detalhe diário, sessão e histórico do
Caixa.