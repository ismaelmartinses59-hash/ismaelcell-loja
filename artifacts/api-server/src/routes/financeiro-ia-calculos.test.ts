import test from "node:test";
import assert from "node:assert/strict";
import { calcularRateioConsolidadoNaAbertura, calcularAjusteReservaAteAlvoCentavos, calcularAjusteSaldoOperacionalAteAlvoCentavos, calcularSaldoOperacionalAcumulado, calcularVariacaoOperacionalSemana, deveRepararSaldoOperacionalLegado, deveConsolidarOperacaoNaAbertura, somarProtecaoPendenteSemanal } from "./financeiro-ia-calculos.js";

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
    entradasCentavos: 240000, saidasCentavos: 30000, liquidoCentavos: 210000,
    operacaoCentavos: 126000, protecaoCentavos: 84000,
  });
});

test("consolida somente após uma abertura real e uma vez por período", () => {
  const monday = 20_000;
  assert.equal(deveConsolidarOperacaoNaAbertura(monday, null, null), false);
  assert.equal(deveConsolidarOperacaoNaAbertura(monday, null, monday + 9), true);
  assert.equal(deveConsolidarOperacaoNaAbertura(monday, monday, monday + 9), false);
});

test("soma a proteção pendente semana a semana até a abertura", () => {
  const monday = 20_000;
  const movements = [
    { dia: monday, tipo: "entrada", formaPagamento: "pix", valorCentavos: 100_000 },
    { dia: monday + 7, tipo: "entrada", formaPagamento: "dinheiro", valorCentavos: 50_000 },
    { dia: monday + 8, tipo: "saida", formaPagamento: "dinheiro", valorCentavos: 25_000, categoria: "aluguel" },
    { dia: monday + 14, tipo: "saida", formaPagamento: "pix", valorCentavos: 80_000, categoria: "frete" },
  ];
  assert.equal(somarProtecaoPendenteSemanal(movements, monday, monday + 14, true), 50_000);
  assert.equal(somarProtecaoPendenteSemanal(movements, monday, monday + 14, false), 0);
});


test("a correção de outubro mostra o saldo operacional alvo após debitar os R$ 150 já lançados", () => {
  const saldoBaseAnterior = -144688;
  const saidasJaRegistradas = 15000;
  const ajuste = calcularAjusteSaldoOperacionalAteAlvoCentavos(saldoBaseAnterior, saidasJaRegistradas, 102979);
  assert.equal(calcularSaldoOperacionalAcumulado(saldoBaseAnterior, ajuste, saidasJaRegistradas), 102979);
});

test("repara o estado legado exato sem depender de reencontrar o lançamento de origem", () => {
  assert.equal(deveRepararSaldoOperacionalLegado(-144688, "aplicada", -144688), true);
  assert.equal(deveRepararSaldoOperacionalLegado(-144688, "aplicada-v2", -144688), false);
  assert.equal(deveRepararSaldoOperacionalLegado(-144687, "aplicada", -144688), false);
});

test("ajuste contábil da reserva alcança o alvo sem reduzir ou duplicar valores", () => {
  assert.equal(calcularAjusteReservaAteAlvoCentavos(240521, 272494), 31973);
  assert.equal(calcularAjusteReservaAteAlvoCentavos(272494, 272494), 0);
  assert.equal(calcularAjusteReservaAteAlvoCentavos(280000, 272494), 0);
});


test("exibe o resultado operacional semanal com sinal positivo ou negativo", () => {
  assert.equal(calcularVariacaoOperacionalSemana(90500, 54300), 54300);
  assert.equal(calcularVariacaoOperacionalSemana(-15000, 0), -15000);
});
