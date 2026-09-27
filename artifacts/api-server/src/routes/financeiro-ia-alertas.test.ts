import test from "node:test";
import assert from "node:assert/strict";
import { analisarAlertasFinanceiros, type AlertaFinanceiro } from "./financeiro-ia-alertas.js";

const hoje = 21000;
type Movimento = Parameters<typeof analisarAlertasFinanceiros>[0]["movimentos"][number];
const movimento = (diasAtras: number, reais: number, tipo: Movimento["tipo"], categoria: string | null = null): Movimento => ({
  dia: hoje - diasAtras, tipo, valor: reais * 100, categoria,
});
const base = (movimentos: Movimento[] = [], extras: Partial<Parameters<typeof analisarAlertasFinanceiros>[0]> = {}) =>
  analisarAlertasFinanceiros({
    movimentos, hoje, disponivel: 500000, total: 600000, reserva: 100000,
    proteger: true, mediaCompras: null, semanasComCompras: 0,
    contasPrevistas: 0, estoqueBaixo: [], ...extras,
  });
const fields: (keyof AlertaFinanceiro)[] = ["aconteceu", "dado", "impacto", "continuidade", "sugestao"];
function assertObjective(alerta: AlertaFinanceiro) {
  for (const field of fields) assert.ok(alerta[field].trim().length > 20, `${alerta.titulo}: ${field}`);
  assert.equal(alerta.texto, fields.map(field => alerta[field]).join(" "));
  assert.doesNotMatch(alerta.texto, /\b(errad[oa]s?|ruim|administrando mal|gastando demais|gastou demais)\b/i);
}

test("compras R$ 1.850 contra R$ 1.300 nas quatro semanas e entradas +8%", () => {
  const anteriores = [8, 15, 22, 29].flatMap(dias => [
    movimento(dias, 1300, "saida", "pecas"), movimento(dias, 1000, "entrada"),
  ]);
  const resultado = base([...anteriores, movimento(1, 1850, "saida", "pecas"), movimento(1, 1080, "entrada")]);
  assert.equal(resultado.analiseGastos.semanasComRegistros, 4);
  assert.equal(resultado.analiseGastos.mediaEntradas4Semanas, 1000);
  assert.equal(resultado.analiseGastos.variacaoEntradasPercentual, 8);
  const compra = resultado.alertas.find(a => a.titulo === "Compras de peças acima da média");
  assert.ok(compra);
  assert.match(compra.dado, /R\$\s?1\.850,00.*R\$\s?1\.300,00.*\+42%/);
  assert.match(compra.dado, /R\$\s?1\.080,00.*R\$\s?1\.000,00.*\+8%/);
  assert.match(compra.impacto, /disponível atual.*R\$\s?5\.000,00/);
  assert.match(compra.continuidade, /Se as compras/);
  assert.match(compra.sugestao, /Antes da próxima compra/);
  assert.equal(resultado.alertas.some(a => a.titulo === "Entradas acima da média"), false);
  assertObjective(compra);
});

test("histórico incompleto não cria média, percentual nem alerta de tendência", () => {
  const resultado = base([movimento(8, 1300, "saida", "pecas"), movimento(0, 1850, "saida", "pecas")]);
  assert.equal(resultado.analiseGastos.semanasComRegistros, 1);
  assert.equal(resultado.analiseGastos.mediaSemanal4Semanas, null);
  assert.equal(resultado.analiseGastos.variacaoPercentual, null);
  assert.equal(resultado.analiseGastos.variacaoEntradasPercentual, null);
  assert.equal(resultado.alertas.some(a => /acima da média/.test(a.titulo)), false);
});

test("quatro semanas com somente entradas não inventam variação de saídas a partir de zero", () => {
  const resultado = base([8, 15, 22, 29].map(dias => movimento(dias, 100, "entrada")));
  assert.equal(resultado.analiseGastos.mediaSemanal4Semanas, 0);
  assert.equal(resultado.analiseGastos.variacaoPercentual, null);
  assert.equal(resultado.alertas.some(a => a.titulo === "Saídas acima da média registrada"), false);
});

test("saídas não classificadas também são comparadas, sem chamá-las de compras", () => {
  const resultado = base([
    ...[8, 15, 22, 29].map(dias => movimento(dias, 100, "saida", "outros")),
    movimento(0, 150, "saida", "outros"),
  ]);
  const alerta = resultado.alertas.find(a => a.titulo === "Saídas acima da média registrada");
  assert.ok(alerta);
  assert.match(alerta.dado, /\+50%/);
  assert.equal(resultado.alertas.some(a => a.titulo === "Compras de peças acima da média"), false);
  assertObjective(alerta);
});

test("reserva, contas futuras, estoque e retiradas têm cinco partes objetivas sem histórico comparável", () => {
  const resultado = base([movimento(0, 100, "saida", "retirada pessoal")], {
    total: 90000, reserva: 100000, disponivel: 20000,
    contasPrevistas: 30000, estoqueBaixo: [{ modelo: "Tela A", quantidade: 2 }],
  });
  for (const titulo of ["Reserva abaixo da meta", "Contas previstas acima do disponível", "Estoque com poucas unidades", "Retiradas e disponibilidade"]) {
    const alerta = resultado.alertas.find(a => a.titulo === titulo);
    assert.ok(alerta, titulo);
    assertObjective(alerta);
  }
  assert.match(resultado.alertas.find(a => a.titulo === "Contas previstas acima do disponível")!.impacto, /ainda não foram debitadas/);
  assert.match(resultado.alertas.find(a => a.titulo === "Estoque com poucas unidades")!.impacto, /não altera o caixa por si só/);
});

test("sem saldo físico conhecido não afirma disponível nem alerta de reserva", () => {
  const resultado = base([movimento(0, 300, "saida", "outros"), ...[8, 15, 22, 29].map(d => movimento(d, 100, "saida", "outros"))], {
    total: null, disponivel: null,
  });
  const alerta = resultado.alertas.find(a => a.titulo === "Saídas acima da média registrada");
  assert.ok(alerta);
  assert.match(alerta.impacto, /não calculo a disponibilidade atual/);
  assert.equal(resultado.alertas.some(a => a.titulo === "Reserva abaixo da meta"), false);
});