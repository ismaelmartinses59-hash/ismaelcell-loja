import test from "node:test";
import assert from "node:assert/strict";
import {
  calcularAlocacaoSemanal,
  calcularAlocacaoComSaldoAnterior,
  calcularDeficitOperacionalCarregado,
  calcularRateioConsolidadoNaAbertura,
  calcularAjusteReservaSemanaFechada,
  calcularAjusteReservaAteAlvoCentavos,
  calcularAjusteSaldoOperacionalAteAlvoCentavos,
  calcularDisponibilidade,
  calcularSaldoOperacionalAcumulado,
  calcularVariacaoOperacionalSemana,
  dataFinanceiraLocal,
  diaFinanceiroLocal,
  deveRepararSaldoOperacionalLegado,
  deveConsolidarOperacaoNaAbertura,
  mediaDasSemanasComCompra,
  proximoCicloReservaSemanal,
  somarProtecaoPendenteSemanal,
  somarMovimentosElegiveisDoPeriodo,
  separarSaidasDeSegundaDoFluxoOperacional,
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
test("conta apenas entradas novas em dinheiro ou PIX no acompanhamento", () => {
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
test("o déficit anterior é coberto antes do rateio e a projeção muda com as saídas", () => {
  const depoisDasEntradas = calcularAlocacaoComSaldoAnterior(-50_000, 60_000, 0, true);
  assert.equal(depoisDasEntradas.fluxoLiquidoCentavos, 10_000);
  assert.equal(depoisDasEntradas.operacaoCentavos, 6_000);
  assert.equal(depoisDasEntradas.protecaoCentavos, 4_000);
  assert.equal(depoisDasEntradas.saldoOperacionalFinalCentavos, 6_000);

  const depoisDaDespesa = calcularAlocacaoComSaldoAnterior(-50_000, 60_000, 15_000, true);
  assert.equal(depoisDaDespesa.fluxoLiquidoCentavos, -5_000);
  assert.equal(depoisDaDespesa.operacaoCentavos, 0);
  assert.equal(depoisDaDespesa.protecaoCentavos, 0);
  assert.equal(depoisDaDespesa.percentualProtecao, 0);
  assert.equal(depoisDaDespesa.saldoOperacionalFinalCentavos, -5_000);
});
test("saldo positivo anterior compensa as saídas da semana antes de carregar o déficit", () => {
  const semana = calcularAlocacaoComSaldoAnterior(72_082, 36_000, 117_580, true);

  assert.equal(semana.fluxoSemanaCentavos, -81_580);
  assert.equal(semana.fluxoLiquidoCentavos, -81_580);
  assert.equal(semana.operacaoCentavos, 0);
  assert.equal(semana.protecaoCentavos, 0);
  assert.equal(semana.saldoOperacionalFinalCentavos, -9_498);
});
test("a semana atual compensa o déficit de R$ 1.355,80 antes de ratear", () => {
  const saldoCarry = calcularDeficitOperacionalCarregado(84_585, 260_000, 395_580);
  assert.equal(saldoCarry, -135_580);
  const resultado = calcularAlocacaoComSaldoAnterior(saldoCarry, 126_000, 21_500, true);
  assert.equal(resultado.fluxoLiquidoCentavos, -31_080);
  assert.equal(resultado.operacaoCentavos, 0);
  assert.equal(resultado.protecaoCentavos, 0);
  assert.equal(resultado.percentualProtecao, 0);
  assert.equal(resultado.saldoOperacionalFinalCentavos, -31_080);
});
test("entradas reduzem o déficit atual e cada nova entrada atualiza o saldo", () => {
  const saldoComEntradasAtuais = calcularAlocacaoComSaldoAnterior(
    -318_090, 247_000, 0, true,
  );
  assert.equal(saldoComEntradasAtuais.saldoOperacionalFinalCentavos, -71_090);

  const saldoAposNovaEntrada = calcularAlocacaoComSaldoAnterior(
    -318_090, 257_000, 0, true,
  );
  assert.equal(saldoAposNovaEntrada.saldoOperacionalFinalCentavos, -61_090);
});
test("saldo auditado prevalece sobre a base positiva separada para pedidos", () => {
  assert.equal(calcularDeficitOperacionalCarregado(84_585, 260_000, 395_580, -135_580), -135_580);
});
test("o fechamento leva o saldo operacional assinado para a semana seguinte", () => {
  const primeiraSemana = calcularAlocacaoComSaldoAnterior(-50_000, 40_000, 45_000, true);
  assert.equal(primeiraSemana.fluxoLiquidoCentavos, -55_000);
  assert.equal(primeiraSemana.protecaoCentavos, 0);
  assert.equal(primeiraSemana.saldoOperacionalFinalCentavos, -55_000);

  const semanaSeguinte = calcularAlocacaoComSaldoAnterior(
    primeiraSemana.saldoOperacionalFinalCentavos, 60_000, 0, true,
  );
  assert.equal(semanaSeguinte.fluxoLiquidoCentavos, 5_000);
  assert.equal(semanaSeguinte.protecaoCentavos, 2_000);
  assert.equal(semanaSeguinte.operacaoCentavos, 3_000);
  assert.equal(semanaSeguinte.saldoOperacionalFinalCentavos, 3_000);
});
test("os 40% projetados diminuem com as despesas e zeram no déficit", () => {
  const inicial = calcularAlocacaoComSaldoAnterior(-50_000, 65_000, 0, true);
  const menor = calcularAlocacaoComSaldoAnterior(-50_000, 65_000, 5_000, true);
  const menorAinda = calcularAlocacaoComSaldoAnterior(-50_000, 65_000, 10_000, true);
  const zerado = calcularAlocacaoComSaldoAnterior(-50_000, 65_000, 15_000, true);
  const negativo = calcularAlocacaoComSaldoAnterior(-50_000, 65_000, 20_000, true);

  assert.deepEqual([
    inicial.protecaoCentavos,
    menor.protecaoCentavos,
    menorAinda.protecaoCentavos,
    zerado.protecaoCentavos,
    negativo.protecaoCentavos,
  ], [6_000, 4_000, 2_000, 0, 0]);
});
test("o fechamento só mantém a parcela protegida se a semana terminar positiva", () => {
  assert.equal(calcularAjusteReservaSemanaFechada(0, 16000), -16000);
  assert.equal(calcularAjusteReservaSemanaFechada(24000, 16000), 8000);
  assert.equal(calcularAjusteReservaSemanaFechada(24000, 0), 24000);
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
test("pedido de segunda reduz a sobra anterior e não entra no rateio da semana nova", () => {
  const semana = separarSaidasDeSegundaDoFluxoOperacional([
    { dia: 20, tipo: "saida", formaPagamento: "dinheiro", valorCentavos: 180000 },
    { dia: 21, tipo: "entrada", formaPagamento: "pix", valorCentavos: 500000 },
    { dia: 21, tipo: "saida", formaPagamento: "dinheiro", valorCentavos: 100000 },
  ], 20, 26);
  assert.deepEqual(semana, {
    entradas: 500000, saidas: 100000, saidasSegunda: 180000,
    saidasPedidosEstoque: 0, saidasCicloAnterior: 180000, saidasOperacionais: 100000,
  });
  const alocacao = calcularAlocacaoSemanal(semana.entradas, semana.saidas, null, 0, true);
  assert.equal(alocacao.operacaoCentavos, 240000);
  const saldoAposDebitarCicloAnterior = calcularSaldoOperacionalAcumulado(
    200000, 0, semana.saidasCicloAnterior,
  );
  assert.equal(calcularSaldoOperacionalAcumulado(
    saldoAposDebitarCicloAnterior, alocacao.operacaoCentavos, semana.saidasOperacionais,
  ), 160000);
});
test("a sobra operacional acumula ao fechar cada semana sem recontar o pedido de segunda", () => {
  const saldoFechado = calcularSaldoOperacionalAcumulado(200000, 300000, 180000);
  assert.equal(saldoFechado, 320000);
});
test("corrige o saldo operacional de outubro e ainda debita os R$ 150 do ciclo anterior", () => {
  const corrigido = calcularSaldoOperacionalAcumulado(102979, 0, 15000);
  assert.equal(corrigido, 87979);
});
test("ajuste contábil da reserva alcança o alvo sem reduzir ou duplicar valores", () => {
  assert.equal(calcularAjusteReservaAteAlvoCentavos(240521, 272494), 31973);
  assert.equal(calcularAjusteReservaAteAlvoCentavos(272494, 272494), 0);
  assert.equal(calcularAjusteReservaAteAlvoCentavos(280000, 272494), 0);
});
test("correção operacional alcança R$ 1.029,79 depois dos débitos já registrados", () => {
  const saldoBaseAnterior = -144688;
  const saidasJaRegistradas = 15000;
  const alvoFinal = 102979;
  const ajuste = calcularAjusteSaldoOperacionalAteAlvoCentavos(
    saldoBaseAnterior, saidasJaRegistradas, alvoFinal,
  );
  assert.equal(ajuste, 262667);
  assert.equal(calcularSaldoOperacionalAcumulado(saldoBaseAnterior, ajuste, saidasJaRegistradas), alvoFinal);
  assert.equal(calcularAjusteSaldoOperacionalAteAlvoCentavos(0, 0, alvoFinal), alvoFinal);
});
test("repara o saldo legado exato do resumo mesmo sem reencontrar o lançamento de origem", () => {
  assert.equal(deveRepararSaldoOperacionalLegado(-144688, "aplicada", -144688), true);
  assert.equal(deveRepararSaldoOperacionalLegado(-144688, "aplicada-v2", -144688), false);
  assert.equal(deveRepararSaldoOperacionalLegado(-144687, "aplicada", -144688), false);
});
test("pedido de estoque de terça debita a operação do ciclo anterior sem mudar sua data", () => {
  const semana = separarSaidasDeSegundaDoFluxoOperacional([
    { dia: 20, tipo: "entrada", formaPagamento: "pix", valorCentavos: 500000 },
    { dia: 21, tipo: "saida", formaPagamento: "dinheiro", valorCentavos: 155000, categoria: "pecas" },
    { dia: 21, tipo: "saida", formaPagamento: "dinheiro", valorCentavos: 100000, categoria: "aluguel" },
  ], 20, 26);
  assert.deepEqual(semana, {
    entradas: 500000,
    saidas: 100000,
    saidasSegunda: 0,
    saidasPedidosEstoque: 155000,
    saidasCicloAnterior: 155000,
    saidasOperacionais: 100000,
  });
  const alocacaoAtual = calcularAlocacaoSemanal(semana.entradas, semana.saidas, null, 0, true);
  assert.equal(alocacaoAtual.fluxoLiquidoCentavos, 400000);
  assert.equal(alocacaoAtual.operacaoCentavos, 240000);
  assert.equal(calcularSaldoOperacionalAcumulado(131932, 0, semana.saidasCicloAnterior), -23068);
  assert.equal(calcularSaldoOperacionalAcumulado(
    -23068, alocacaoAtual.operacaoCentavos, semana.saidasOperacionais,
  ), 116932);
});
test("reclassificar R$ 1.319,32 soma os valores existentes sem substituir o rateio", () => {
  const rateio = calcularAlocacaoSemanal(39700 + 131932, 0, null, 0, true);
  assert.equal(rateio.protecaoCentavos, 68653);
  assert.equal(rateio.operacaoCentavos, 102979);
  assert.equal(15880 + 52773, 68653);
  assert.equal(23820 + 79159, 102979);
});
test("saídas operacionais podem gerar déficit e futuras alocações o reduzem", () => {
  assert.equal(calcularVariacaoOperacionalSemana(90500, 54300), 54300);
  assert.equal(calcularVariacaoOperacionalSemana(-15000, 0), -15000);
  const deficit = calcularSaldoOperacionalAcumulado(131932, 23820, 341300);
  assert.equal(deficit, -185548);
  assert.equal(calcularSaldoOperacionalAcumulado(deficit, 200000, 0), 14452);
  assert.equal(calcularSaldoOperacionalAcumulado(0, 0, 450000), -450000);
  assert.equal(calcularVariacaoOperacionalSemana(-23068, 0), -23068);
  const semanaNegativaInicial = calcularAlocacaoSemanal(260000, 395580, null, 0, true);
  assert.equal(calcularVariacaoOperacionalSemana(
    semanaNegativaInicial.fluxoLiquidoCentavos,
    semanaNegativaInicial.operacaoCentavos,
  ), -135580);
  assert.equal(calcularVariacaoOperacionalSemana(245000, 147000), 147000);
});
test("rateio consolidado na abertura mostra 60/40 sem contar pedidos de segunda", () => {
  const abertura = calcularRateioConsolidadoNaAbertura([
    { dia: 20, tipo: "entrada", formaPagamento: "pix", valorCentavos: 40000 },
    { dia: 20, tipo: "saida", formaPagamento: "dinheiro", valorCentavos: 5000, categoria: "aluguel" },
    { dia: 21, tipo: "entrada", formaPagamento: "dinheiro", valorCentavos: 200000 },
    { dia: 21, tipo: "saida", formaPagamento: "pix", valorCentavos: 30000, categoria: "frete" },
    { dia: 21, tipo: "saida", formaPagamento: "dinheiro", valorCentavos: 60000, categoria: "pecas" },
    { dia: 22, tipo: "entrada", formaPagamento: "pix", valorCentavos: 90000 },
  ], 20, 21, true);
  assert.deepEqual(abertura, {
    entradasCentavos: 240000,
    saidasCentavos: 30000,
    liquidoCentavos: 210000,
    operacaoCentavos: 126000,
    protecaoCentavos: 84000,
  });
});
test("a virada operacional espera a primeira abertura real, inclusive se atrasar", () => {
  const segunda = 20_000;
  assert.equal(deveConsolidarOperacaoNaAbertura(segunda, segunda - 7, null), false);
  assert.equal(deveConsolidarOperacaoNaAbertura(segunda, segunda - 7, segunda + 1), true);
  // Uma segunda sessão diária na mesma semana não consolida o período outra vez.
  assert.equal(deveConsolidarOperacaoNaAbertura(segunda, segunda, segunda + 2), false);
  // Sem uma abertura na semana seguinte, a alocação continua pendente.
  assert.equal(deveConsolidarOperacaoNaAbertura(segunda + 7, segunda, segunda + 2), false);
  // A primeira abertura posterior consolida o período pendente, mesmo atrasada.
  assert.equal(deveConsolidarOperacaoNaAbertura(segunda + 7, segunda, segunda + 9), true);
});
test("a proteção pendente soma cada semana até a abertura sem absorver saldo negativo", () => {
  const segunda = 20_000;
  const movimentos = [
    { dia: segunda - 1, tipo: "entrada", formaPagamento: "pix", valorCentavos: 500_000 },
    { dia: segunda, tipo: "entrada", formaPagamento: "pix", valorCentavos: 100_000 },
    { dia: segunda + 7, tipo: "entrada", formaPagamento: "dinheiro", valorCentavos: 50_000 },
    { dia: segunda + 8, tipo: "saida", formaPagamento: "dinheiro", valorCentavos: 25_000, categoria: "aluguel" },
    { dia: segunda + 14, tipo: "saida", formaPagamento: "pix", valorCentavos: 80_000, categoria: "frete" },
  ];
  assert.equal(somarProtecaoPendenteSemanal(movimentos, segunda, segunda + 14, true), 50_000);
  assert.equal(somarProtecaoPendenteSemanal(movimentos, segunda, segunda + 14, false), 0);
});
test("o cálculo da reserva inclui todas as saídas elegíveis, inclusive peças e segunda-feira", () => {
  const inicio = 20_000;
  const movimentos = [
    { dia: inicio, tipo: "entrada", formaPagamento: "dinheiro", valorCentavos: 260_000 },
    { dia: inicio, tipo: "saida", formaPagamento: "pix", valorCentavos: 100_000, categoria: "aluguel" },
    { dia: inicio + 1, tipo: "saida", formaPagamento: "dinheiro", valorCentavos: 140_575, categoria: "pecas" },
    { dia: inicio + 2, tipo: "saida", formaPagamento: "pix", valorCentavos: 155_005, categoria: "outros" },
  ];
  assert.equal(somarProtecaoPendenteSemanal(movimentos, inicio, inicio + 6, true), 0);
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