import test from "node:test";
import assert from "node:assert/strict";
import {
  calcularAlocacaoSemanal,
  calcularAumentoReservaSemanal,
  calcularDisponibilidade,
  dataFinanceiraLocal,
  diaFinanceiroLocal,
  mediaDasSemanasComCompra,
  proximoCicloReservaSemanal,
  somarMovimentosElegiveisDoPeriodo,
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
test("só entradas novas recebidas em dinheiro ou PIX alimentam o aporte", () => {
  const rows = [
    { id: 9, tipo: "entrada", formaPagamento: "pix", valorCentavos: 200000 },
    { id: 10, tipo: "entrada", formaPagamento: "cartao", valorCentavos: 50000 },
    { id: 11, tipo: "saida", formaPagamento: "dinheiro", valorCentavos: 20000 },
    { id: 12, tipo: "entrada", formaPagamento: "pix", valorCentavos: 120000 },
    { id: 13, tipo: "entrada", formaPagamento: "dinheiro", valorCentavos: 80000 },
    { id: 14, tipo: "entrada", formaPagamento: null, valorCentavos: 99900 },
  ];
  assert.equal(somarEntradasNovas(rows, 11), 200000);
  assert.equal(somarEntradasNovas(rows, 13), 0);
});
test("divide o saldo líquido positivo em 60/40 e conserva os centavos do exemplo real", () => {
  const alocacao = calcularAlocacaoSemanal(448098, 214514, 200000, 120000, true);
  assert.deepEqual(alocacao, {
    fluxoLiquidoCentavos: 233584,
    necessidadeOperacionalCentavos: 200000,
    operacaoCentavos: 140150,
    protecaoCentavos: 93434,
    percentualProtecao: 40,
  });
  assert.equal(alocacao.operacaoCentavos + alocacao.protecaoCentavos, alocacao.fluxoLiquidoCentavos);
  const saldoComCentavoImpar = calcularAlocacaoSemanal(1001, 0, 100, 0, true);
  assert.equal(saldoComCentavoImpar.operacaoCentavos, 601);
  assert.equal(saldoComCentavoImpar.protecaoCentavos, 400);
  assert.equal(saldoComCentavoImpar.operacaoCentavos + saldoComCentavoImpar.protecaoCentavos, 1001);
});
test("mais saídas reduzem o líquido antes do rateio, nunca as entradas isoladamente", () => {
  assert.deepEqual(calcularAlocacaoSemanal(400000, 150000, 100000, 120000, true), {
    fluxoLiquidoCentavos: 250000,
    necessidadeOperacionalCentavos: 120000,
    operacaoCentavos: 150000,
    protecaoCentavos: 100000,
    percentualProtecao: 40,
  });
  assert.deepEqual(calcularAlocacaoSemanal(400000, 300000, 100000, 120000, true), {
    fluxoLiquidoCentavos: 100000,
    necessidadeOperacionalCentavos: 120000,
    operacaoCentavos: 60000,
    protecaoCentavos: 40000,
    percentualProtecao: 40,
  });
});
test("sem histórico nem compromissos, ainda divide o saldo líquido positivo em 60/40", () => {
  assert.deepEqual(calcularAlocacaoSemanal(400000, 150000, null, 0, true), {
    fluxoLiquidoCentavos: 250000,
    necessidadeOperacionalCentavos: 400000,
    operacaoCentavos: 150000,
    protecaoCentavos: 100000,
    percentualProtecao: 40,
  });
});
test("fluxo zero ou negativo não gera parcelas positivas", () => {
  assert.deepEqual(calcularAlocacaoSemanal(10000, 30000, 20000, 10000, true), {
    fluxoLiquidoCentavos: -20000,
    necessidadeOperacionalCentavos: 20000,
    operacaoCentavos: 0,
    protecaoCentavos: 0,
    percentualProtecao: 0,
  });
  const fluxoZero = calcularAlocacaoSemanal(10000, 10000, 20000, 10000, true);
  assert.equal(fluxoZero.fluxoLiquidoCentavos, 0);
  assert.equal(fluxoZero.operacaoCentavos, 0);
  assert.equal(fluxoZero.protecaoCentavos, 0);
});
test("com a proteção desativada, o líquido positivo fica todo para operação", () => {
  assert.deepEqual(calcularAlocacaoSemanal(448098, 214514, 100000, 0, false), {
    fluxoLiquidoCentavos: 233584,
    necessidadeOperacionalCentavos: 100000,
    operacaoCentavos: 233584,
    protecaoCentavos: 0,
    percentualProtecao: 0,
  });
});
test("protege a alocação semanal calculada sem limitar pela necessidade operacional ou pelo caixa livre", () => {
  assert.equal(calcularAumentoReservaSemanal(50000, 20000, 80000, 50000, true), 50000);
  assert.equal(calcularAumentoReservaSemanal(500000, 20000, 80000, 50000, true), 50000);
  assert.equal(calcularAumentoReservaSemanal(500000, 80000, 80000, 50000, true), 0);
  assert.equal(calcularAumentoReservaSemanal(500000, 20000, 80000, 0, true), 0);
  assert.equal(calcularAumentoReservaSemanal(500000, 20000, 80000, 50000, false), 0);
  assert.equal(calcularAumentoReservaSemanal(null, 0, 80000, 50000, true), 0);
});
test("a reconciliação inicial soma a semana inteira uma vez e depois segue só a diferença", () => {
  const protecaoDaSemana = 91154;
  const primeiraConciliacao = calcularAumentoReservaSemanal(
    500000, 0, protecaoDaSemana, 0, true, true,
  );
  assert.equal(primeiraConciliacao, protecaoDaSemana);
  assert.equal(calcularAumentoReservaSemanal(
    500000, protecaoDaSemana, protecaoDaSemana, 0, true,
  ), 0);
  assert.equal(calcularAumentoReservaSemanal(
    500000, protecaoDaSemana, 100000, 10000, true,
  ), 8846);
});
test("soma somente entradas e saídas elegíveis entre o início e o fim da semana", () => {
  assert.deepEqual(somarMovimentosElegiveisDoPeriodo([
    { dia: 12, tipo: "entrada", formaPagamento: "pix", valorCentavos: 109500 },
    { dia: 13, tipo: "entrada", formaPagamento: "cartao", valorCentavos: 20000 },
    { dia: 10, tipo: "entrada", formaPagamento: "dinheiro", valorCentavos: 5000 },
    { dia: 12, tipo: "saida", formaPagamento: "dinheiro", valorCentavos: 10000 },
    { dia: 12, tipo: "saida", formaPagamento: "cartao", valorCentavos: 3000 },
    { dia: 13, tipo: "entrada", formaPagamento: null, valorCentavos: 2500 },
    { dia: 13, tipo: "saida", formaPagamento: null, valorCentavos: 1800 },
  ], 11, 13), { entradas: 109500, saidas: 10000 });
});
test("resumo diário reinicia à meia-noite local e ignora dias e formas de pagamento inelegíveis", () => {
  const antesDaVirada = new Date("2026-10-05T02:59:59.000Z");
  const depoisDaVirada = new Date("2026-10-05T03:00:00.000Z");
  const diaAlvo = diaFinanceiroLocal(depoisDaVirada);
  assert.equal(dataFinanceiraLocal(antesDaVirada), "2026-10-04");
  assert.equal(diaFinanceiroLocal(antesDaVirada), diaAlvo - 1);
  assert.equal(dataFinanceiraLocal(depoisDaVirada), "2026-10-05");

  assert.deepEqual(somarMovimentosElegiveisDoPeriodo([
    { dia: diaAlvo, tipo: "entrada", formaPagamento: "pix", valorCentavos: 109500 },
    { dia: diaAlvo, tipo: "entrada", formaPagamento: "cartao", valorCentavos: 20000 },
    { dia: diaAlvo - 1, tipo: "entrada", formaPagamento: "dinheiro", valorCentavos: 5000 },
    { dia: diaAlvo, tipo: "saida", formaPagamento: "dinheiro", valorCentavos: 10000 },
    { dia: diaAlvo, tipo: "saida", formaPagamento: "cartao", valorCentavos: 3000 },
  ], diaAlvo, diaAlvo), { entradas: 109500, saidas: 10000 });
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