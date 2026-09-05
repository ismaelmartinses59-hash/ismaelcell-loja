---
name: Venda parcial com entrada
description: Modelo financeiro para vendas com parte paga na hora e saldo pendente.
---

Uma venda parcial deve gerar um único item no A Receber pelo valor total da venda e registrar o valor recebido na hora como um ou mais pagamentos iniciais. O saldo pendente é derivado de total menos pagamentos; nunca crie apenas um item pelo saldo junto com pagamentos, pois isso produz saldo incorreto.

Quando o pagamento inicial for misto, cada forma deve permanecer em um registro separado, com data e hora, e ter sua própria entrada no Caixa. Todos os registros iniciais pertencem à mesma venda.

**Why:** Esse modelo preserva o histórico completo (valor original, entrada e saldo), evita duplicar receita e permite conferir cada forma de pagamento mesmo depois da quitação.

**How to apply:** Qualquer alteração em venda, A Receber, Caixa, exclusão ou reembolso deve tratar estoque, venda total, item, pagamentos iniciais e entradas do Caixa como uma única operação financeira atômica.