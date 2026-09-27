type Movimento = {
  dia: number;
  tipo: "entrada" | "saida";
  valor: number; // centavos
  categoria: string | null;
};

type Produto = { modelo: string; quantidade: number };
export type AlertaFinanceiro = {
  nivel: "risco" | "atencao" | "positivo";
  titulo: string;
  aconteceu: string;
  dado: string;
  impacto: string;
  continuidade: string;
  sugestao: string;
  texto: string;
};

const reais = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function analisarAlertasFinanceiros({
  movimentos, hoje, disponivel, total, reserva, proteger, mediaCompras, semanasComCompras,
  contasPrevistas, estoqueBaixo,
}: {
  movimentos: Movimento[];
  hoje: number;
  disponivel: number | null;
  total: number | null;
  reserva: number;
  proteger: boolean;
  mediaCompras: number | null;
  semanasComCompras: number;
  contasPrevistas: number;
  estoqueBaixo: Produto[];
}) {
  const periodo = (inicio: number, fim: number) => {
    let entradas = 0, saidas = 0, compras = 0, retiradas = 0, registros = 0;
    for (const movimento of movimentos) {
      if (movimento.dia < inicio || movimento.dia > fim) continue;
      registros++;
      if (movimento.tipo === "entrada") entradas += movimento.valor;
      else {
        saidas += movimento.valor;
        if (movimento.categoria === "pecas") compras += movimento.valor;
        if (movimento.categoria === "retirada pessoal") retiradas += movimento.valor;
      }
    }
    return { entradas, saidas, compras, retiradas, registros };
  };
  const ultimos7 = periodo(hoje - 6, hoje);
  const anteriores = [1, 2, 3, 4].map(i => periodo(hoje - 6 - i * 7, hoje - i * 7));
  // Uma semana sem movimentações não prova que o caixa esteve parado: pode faltar histórico.
  const comparavel = anteriores.every(p => p.registros > 0);
  const media = (chave: "entradas" | "saidas" | "compras") => comparavel
    ? Math.round(anteriores.reduce((soma, p) => soma + p[chave], 0) / 4) : null;
  const mediaSaidas = media("saidas");
  const mediaComprasAnteriores = media("compras");
  const mediaEntradas = media("entradas");
  const variacao = (atual: number, base: number | null) =>
    base !== null && base > 0 ? Math.round((atual - base) / base * 100) : null;
  const variacaoSaidas = variacao(ultimos7.saidas, mediaSaidas);
  const variacaoCompras = variacao(ultimos7.compras, mediaComprasAnteriores);
  const variacaoEntradas = variacao(ultimos7.entradas, mediaEntradas);
  const alertas: AlertaFinanceiro[] = [];
  const add = (nivel: AlertaFinanceiro["nivel"], titulo: string, aconteceu: string, dado: string, impacto: string, continuidade: string, sugestao: string) => {
    alertas.push({ nivel, titulo, aconteceu, dado, impacto, continuidade, sugestao, texto: [aconteceu, dado, impacto, continuidade, sugestao].join(" ") });
  };
  const impactoCaixa = (valor: number) => disponivel === null
    ? `Saídas registradas de ${reais(valor)} afetam o fluxo; sem sessão da gaveta não calculo a disponibilidade atual.`
    : `Saídas registradas de ${reais(valor)} reduzem o fluxo; o disponível atual, após outros movimentos e a reserva, é ${reais(disponivel)}.`;

  if (disponivel !== null && mediaCompras !== null && semanasComCompras >= 2 && disponivel < mediaCompras) {
    const diferenca = mediaCompras - disponivel;
    add("risco", "Compra de estoque acima do disponível",
      "O caixa operacional registrado está abaixo da média de compra de estoque.",
      `Disponível: ${reais(disponivel)}; média de ${semanasComCompras} semana(s) com compras registradas: ${reais(mediaCompras)}; diferença: ${reais(diferenca)}.`,
      `Uma compra dessa média hoje ultrapassaria o disponível em ${reais(diferenca)}, sem considerar contas ainda não pagas.`,
      "Se a compra ocorrer antes de novas entradas, pode ser necessário adiar parte dela ou comprometer a reserva protegida.",
      "Confira quais peças são necessárias e considere ajustar o valor ou esperar novas entradas; a decisão é sua.");
  }
  if (total !== null && proteger && total < reserva) {
    add("risco", "Reserva abaixo da meta",
      "O saldo registrado está abaixo do valor configurado para proteção.",
      `Saldo registrado em dinheiro e PIX: ${reais(total)}; reserva configurada: ${reais(reserva)}; diferença: ${reais(reserva - total)}.`,
      "Não há valor operacional livre calculado sem usar a meta protegida.",
      "Se novas saídas ocorrerem antes de entradas, a distância até a meta de reserva poderá aumentar.",
      "Considere revisar saídas programadas e acompanhar as próximas entradas antes de assumir novos gastos.");
  }
  if (variacaoCompras !== null && variacaoCompras > 25 && mediaComprasAnteriores !== null) {
    add("atencao", "Compras de peças acima da média",
      "As compras de peças registradas nos últimos 7 dias superaram a média recente.",
      `Compras: ${reais(ultimos7.compras)}; média semanal das quatro semanas anteriores: ${reais(mediaComprasAnteriores)}; variação: +${variacaoCompras}%. ${variacaoEntradas === null ? "Não há base comparável de entradas." : `Entradas registradas: ${reais(ultimos7.entradas)} contra média de ${reais(mediaEntradas!)} (${variacaoEntradas >= 0 ? "+" : ""}${variacaoEntradas}%).`}`,
      impactoCaixa(ultimos7.compras),
      "Se as compras mantiverem esse ritmo sem entradas suficientes, haverá menos recursos livres para outras operações.",
      "Antes da próxima compra, confira as peças de maior saída e considere priorizar as necessárias.");
  } else if (variacaoSaidas !== null && variacaoSaidas > 25 && mediaSaidas !== null) {
    add("atencao", "Saídas acima da média registrada",
      "As saídas dos últimos 7 dias superaram a média recente.",
      `Saídas: ${reais(ultimos7.saidas)}; média semanal das quatro semanas anteriores: ${reais(mediaSaidas)}; variação: +${variacaoSaidas}%.`,
      impactoCaixa(ultimos7.saidas),
      "Se as saídas continuarem acima da média sem entradas equivalentes, o disponível poderá diminuir.",
      "Considere revisar as categorias de saída e as contas próximas antes de planejar novos gastos.");
  }
  if (disponivel !== null && ultimos7.retiradas > 0 && ultimos7.retiradas > disponivel / 4) {
    add("atencao", "Retiradas e disponibilidade",
      "Houve retiradas registradas nos últimos 7 dias.",
      `Retiradas: ${reais(ultimos7.retiradas)}; disponível atual: ${reais(disponivel)}.`,
      `Essas saídas reduziram o fluxo em ${reais(ultimos7.retiradas)}; o disponível atual já considera os movimentos registrados.`,
      "Se retiradas semelhantes ocorrerem sem novas entradas, a margem para despesas e compras poderá diminuir.",
      "Considere comparar a próxima retirada com as contas previstas e a meta de compra antes de confirmá-la.");
  }
  if (contasPrevistas > 0 && disponivel !== null && contasPrevistas > disponivel) {
    add("risco", "Contas previstas acima do disponível",
      "O total das contas cadastradas para os próximos 7 dias supera o disponível registrado.",
      `Contas previstas: ${reais(contasPrevistas)}; disponível: ${reais(disponivel)}; diferença: ${reais(contasPrevistas - disponivel)}.`,
      "Essas contas ainda não foram debitadas; se fossem pagas agora sem novas entradas, ultrapassariam o disponível.",
      "Se nenhum recebimento ocorrer até os vencimentos, poderá faltar saldo operacional para pagá-las sem usar a reserva.",
      "Confira vencimentos e recebimentos esperados antes de programar novas compras.");
  }
  if (estoqueBaixo.length) {
    add("atencao", "Estoque com poucas unidades",
      "Há produtos com no máximo duas unidades cadastradas; este é um critério de atenção, não um estoque mínimo configurado.",
      `Itens encontrados: ${estoqueBaixo.slice(0, 3).map(p => `${p.modelo} (${p.quantidade})`).join(", ")}${estoqueBaixo.length > 3 ? ` e mais ${estoqueBaixo.length - 3}` : ""}.`,
      "Estoque baixo não altera o caixa por si só; não há dado suficiente para calcular eventual perda de vendas.",
      "Se houver procura por esses itens e eles acabarem, atendimentos poderão ser adiados.",
      "Confira a procura registrada e considere priorizar os itens necessários na próxima compra.");
  }
  if (variacaoEntradas !== null && variacaoEntradas > 25 && mediaEntradas !== null) {
    add("positivo", "Entradas acima da média",
      "As entradas registradas nos últimos 7 dias superaram a média recente.",
      `Entradas: ${reais(ultimos7.entradas)}; média semanal das quatro semanas anteriores: ${reais(mediaEntradas)}; variação: +${variacaoEntradas}%.`,
      "Entradas em dinheiro/PIX podem ampliar o disponível, mas vendas em cartão não são disponibilidade imediata.",
      "O resultado da próxima semana pode ser diferente; as saídas também influenciam o saldo.",
      "Considere acompanhar entradas recebidas e saídas antes de decidir o valor da próxima compra.");
  }
  return {
    alertas,
    analiseGastos: {
      ultimos7Dias: ultimos7.saidas / 100,
      mediaSemanal4Semanas: mediaSaidas === null ? null : mediaSaidas / 100,
      variacaoPercentual: variacaoSaidas,
      semanasComRegistros: anteriores.filter(p => p.registros > 0).length,
      entradas7Dias: ultimos7.entradas / 100,
      mediaEntradas4Semanas: mediaEntradas === null ? null : mediaEntradas / 100,
      variacaoEntradasPercentual: variacaoEntradas,
    },
  };
}