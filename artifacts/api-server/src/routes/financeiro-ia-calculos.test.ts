import test from "node:test";
import assert from "node:assert/strict";
import { calcularDisponibilidade, calcularReservaGradual, mediaDasSemanasComCompra, percentualReserva } from "./financeiro-ia-calculos.ts";

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
  assert.equal(calcularReservaGradual(100000, 0, 150000, 0, 0, 30), 30000);
  assert.equal(calcularReservaGradual(150000, 30000, 150000, 0, 0, 60), 90000);
  assert.equal(calcularReservaGradual(200000, 90000, 150000, 0, 0, 60), 120000);
  assert.equal(calcularReservaGradual(350000, 120000, 150000, 0, 0, 45), 150000);
});
test("pedidos e contas têm prioridade; reserva existente não é reduzida", () => {
  assert.equal(calcularReservaGradual(150000, 20000, 150000, 15000, 100000, 60), 35000);
  assert.equal(calcularReservaGradual(100000, 45000, 150000, 15000, 60000, 30), 45000);
  assert.equal(calcularReservaGradual(null, 45000, 150000, 0, 0, 60), 45000);
});
test("semanas fracas e fortes mudam a taxa, sem inventar comparação sem histórico", () => {
  assert.equal(percentualReserva(60000, 100000), 30);
  assert.equal(percentualReserva(100000, 100000), 45);
  assert.equal(percentualReserva(150000, 100000), 60);
  assert.equal(percentualReserva(100000, null), 45);
});