import test from "node:test";
import assert from "node:assert/strict";
import {
  aumentoReservaDaSemana,
  calcularDisponibilidade,
  calcularRateioDiario,
  calcularReservaGradual,
  dataFinanceiraLocal,
  diaFinanceiroLocal,
  mediaDasSemanasComCompra,
  percentualReserva,
  proximoCicloReservaSemanal,
  somarMovimentosElegiveisDoDia,
  somarEntradasNovas,
} from "./financeiro-ia-calculos.js";

test("reserva protege R$ 2.000 dos R$ 2.550 em dinheiro e PIX", () => {
  assert.deepEqual(calcularDisponibilidade(155000, 100000, 200000, true, 0, 130000), {
    total: 255000, disponivel: 55000, podeGastar: 0, faltaMeta: 75000,
  });
});
test("entrada de R$ 300 recompõe o saldo operacional sem mexer na reserva", () => {
  const antes = calcularDisponibilidade(155000, 100000, 200000, true, 0, 0);
  const depois = calcularDisponibilidade(155000, 130000, 200000, true, 0, 0);
  assert.equal(depois.disponivel! - antes.disponivel!, 30000);
  assert.equal(depois.disponivel, 85000);
});
test("desativar a proteção só altera o disponível, nunca o saldo real", () => {
  const protegido = calcularDisponibilidade(155000, 100000, 200000, true, 0, 0);
  const livre = calcularDisponibilidade(155000, 100000, 200000, false, 0, 0);
  assert.equal(protegido.total, livre.total);
  assert.equal(livre.disponivel, 255000);
});
test("sem sessão física, não inventa total nem disponibilidade a partir do PIX", () => {
  assert.deepEqual(calcularDisponibilidade(null, 100000, 200000, true, 10000, 0), {
    total: null, disponivel: null, podeGastar: null, faltaMeta: null,
  });
});
test("contas e meta reduzem apenas o gasto prudente, não o disponível", () => {
  const r = calcularDisponibilidade(155000, 100000, 200000, true, 12000, 10000);
  assert.equal(r.disponivel, 55000);
  assert.equal(r.podeGastar, 33000);
});
test("média de compras usa somente semanas com compras registradas", () => {
  assert.equal(mediaDasSemanasComCompra([120000, 130000, 150000, 125000]), 131250);
  assert.equal(mediaDasSemanasComCompra([]), null);
});
test("reserva cresce em etapas, sem ultrapassar R$ 1.500", () => {
  assert.equal(calcularReservaGradual(100000, 0, 150000, 0, 0, 30, 100000), 30000);
  assert.equal(calcularReservaGradual(150000, 30000, 150000, 0, 0, 60, 50000), 60000);
  assert.equal(calcularReservaGradual(200000, 60000, 150000, 0, 0, 60, 50000), 90000);
  assert.equal(calcularReservaGradual(350000, 90000, 150000, 0, 0, 45, 150000), 150000);
});
test("pedidos e contas têm prioridade; reserva existente não é reduzida", () => {
  assert.equal(calcularReservaGradual(150000, 20000, 150000, 15000, 100000, 60, 100000), 80000);
  assert.equal(calcularReservaGradual(100000, 45000, 150000, 15000, 60000, 30, 10000), 45000);
  assert.equal(calcularReservaGradual(null, 45000, 150000, 0, 0, 60, 10000), 45000);
  assert.equal(calcularReservaGradual(100000, 0, 150000, 0, 100000, 30, 100000), 30000);
  assert.equal(calcularReservaGradual(200000, 0, 150000, 0, 150000, 60, 200000), 120000);
  assert.equal(calcularReservaGradual(350000, 0, 150000, 0, 200000, 45, 350000), 150000);
});
test("saldo antigo sozinho não cria aporte; a entrada deve existir antes", () => {
  assert.equal(calcularReservaGradual(200000, 0, 150000, 0, 0, 60, 0), 0);
  assert.equal(calcularReservaGradual(200000, 0, 150000, 0, 0, 60, 200000), 120000);
  assert.equal(calcularReservaGradual(200000, 120000, 150000, 0, 0, 60, 0), 120000);
});
test("só entradas novas recebidas em dinheiro ou PIX alimentam o aporte", () => {
  const rows = [
    { id: 9, tipo: "entrada", formaPagamento: "pix", valorCentavos: 200000 },
    { id: 10, tipo: "entrada", formaPagamento: "cartao", valorCentavos: 50000 },
    { id: 11, tipo: "saida", formaPagamento: "dinheiro", valorCentavos: 20000 },
    { id: 12, tipo: "entrada", formaPagamento: "pix", valorCentavos: 120000 },
    { id: 13, tipo: "entrada", formaPagamento: "dinheiro", valorCentavos: 80000 },
  ];
  assert.equal(somarEntradasNovas(rows, 11), 200000);
  assert.equal(somarEntradasNovas(rows, 13), 0);
});
test("semanas fracas e fortes mudam a taxa, sem inventar comparação sem histórico", () => {
  assert.equal(percentualReserva(60000, 100000), 30);
  assert.equal(percentualReserva(100000, 100000), 45);
  assert.equal(percentualReserva(150000, 100000), 60);
  assert.equal(percentualReserva(100000, null), 45);
});
test("rateia somente as entradas elegíveis do dia e desconta as saídas registradas", () => {
  assert.deepEqual(calcularRateioDiario(109500, 0, 45, true, 150000), {
    protecaoCentavos: 49275,
    saldoOperacionalCentavos: 60225,
  });
  assert.deepEqual(calcularRateioDiario(109500, 10000, 45, true, 150000), {
    protecaoCentavos: 49275,
    saldoOperacionalCentavos: 50225,
  });
});
test("rateio diário respeita o teto da proteção e deixa tudo para operação quando pausado", () => {
  assert.deepEqual(calcularRateioDiario(109500, 0, 60, true, 20000), {
    protecaoCentavos: 20000,
    saldoOperacionalCentavos: 89500,
  });
  assert.deepEqual(calcularRateioDiario(109500, 0, 45, false, 150000), {
    protecaoCentavos: 0,
    saldoOperacionalCentavos: 109500,
  });
});
test("resumo diário reinicia à meia-noite local e ignora dias e formas de pagamento inelegíveis", () => {
  const antesDaVirada = new Date("2026-10-05T02:59:59.000Z");
  const depoisDaVirada = new Date("2026-10-05T03:00:00.000Z");
  const diaAlvo = diaFinanceiroLocal(depoisDaVirada);
  assert.equal(dataFinanceiraLocal(antesDaVirada), "2026-10-04");
  assert.equal(diaFinanceiroLocal(antesDaVirada), diaAlvo - 1);
  assert.equal(dataFinanceiraLocal(depoisDaVirada), "2026-10-05");

  assert.deepEqual(somarMovimentosElegiveisDoDia([
    { dia: diaAlvo, tipo: "entrada", formaPagamento: "pix", valorCentavos: 109500 },
    { dia: diaAlvo, tipo: "entrada", formaPagamento: "cartao", valorCentavos: 20000 },
    { dia: diaAlvo - 1, tipo: "entrada", formaPagamento: "dinheiro", valorCentavos: 5000 },
    { dia: diaAlvo, tipo: "saida", formaPagamento: "dinheiro", valorCentavos: 10000 },
    { dia: diaAlvo, tipo: "saida", formaPagamento: "cartao", valorCentavos: 3000 },
  ], diaAlvo), { entradas: 109500, saidas: 10000 });
});
test("o ciclo semanal reinicia na primeira entrada de segunda ou na terça sem venda", () => {
  const segunda = 20_000;
  const cicloAnterior = { chave: "venda:19993:51", inicioDia: 19993, inicioId: 51 };
  const cicloDaVenda = proximoCicloReservaSemanal(segunda, segunda, 84, cicloAnterior);
  assert.deepEqual(cicloDaVenda, {
    chave: `venda:${segunda}:84`, inicioDia: segunda, inicioId: 84,
  });
  assert.equal(proximoCicloReservaSemanal(segunda, segunda, null, cicloAnterior), null);
  const cicloFallback = proximoCicloReservaSemanal(segunda + 1, segunda, null, cicloAnterior);
  assert.deepEqual(cicloFallback, {
    chave: `fallback:${segunda}`, inicioDia: segunda + 1, inicioId: 0,
  });
  assert.equal(proximoCicloReservaSemanal(segunda + 1, segunda, null, cicloFallback), null);
});
test("a parcela semanal acompanha só a parte do aumento atribuída às entradas desta semana", () => {
  assert.equal(aumentoReservaDaSemana(4500, 10000, 10000), 4500);
  assert.equal(aumentoReservaDaSemana(4500, 10000, 4000), 1800);
  assert.equal(aumentoReservaDaSemana(4500, 10000, 0), 0);
  assert.equal(aumentoReservaDaSemana(0, 10000, 4000), 0);
});