import test from "node:test";
import assert from "node:assert/strict";
import { calcularAjusteReservaAteAlvoCentavos, calcularSaldoOperacionalAcumulado, calcularVariacaoOperacionalSemana, deveConsolidarOperacaoNaAbertura, somarProtecaoPendenteSemanal } from "./financeiro-ia-calculos.js";

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


test("corrige o saldo operacional de outubro e ainda debita os R$ 150 do ciclo anterior", () => {
  assert.equal(calcularSaldoOperacionalAcumulado(102979, 0, 15000), 87979);
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
