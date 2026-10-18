          ? cents(sessao.valorContado ?? sessao.valorFinal ?? sessao.valorInicial)
          : cents(sessao.valorInicial);
        const movimentos = await tx.select().from(caixaTable).where(gte(caixaTable.createdAt, dataBase));
        dinheiroAtual = saldoBase + movimentos.reduce((soma, row) => {
          if (row.formaPagamento && row.formaPagamento !== "dinheiro") return soma;
          return soma + (row.tipo === "entrada" ? 1 : -1) * cents(row.valor);
        }, 0);
        const pixRegistrados = await tx.select({ tipo: caixaTable.tipo, valor: caixaTable.valor })
          .from(caixaTable).where(eq(caixaTable.formaPagamento, "pix"));
        pixAtual = pixRegistrados.reduce((soma, row) =>
          soma + (row.tipo === "entrada" ? 1 : -1) * cents(row.valor), 0);
      }
    }
    const totalAtual = dinheiroAtual === null ? total : dinheiroAtual + pixAtual;
    const reconciliarSemana = migrarAcumulacaoReserva && ativa && protecaoAlocadaSemana > 0;
    const reservaSemanaBase = reconciliarSemana ? 0 : reservaSemanaAtual;
    const aumentoPlanejado = reconciliarSemana || entradaNovaSemana > 0
      ? calcularAumentoReservaSemanal(
          totalAtual, reservaSemanaBase, protecaoAlocadaSemana,
          entradaNovaSemana, ativa, reconciliarSemana,
        )
      : 0;
    const novo = atual + aumentoPlanejado;
    const aposContas = Math.max(0, (totalAtual ?? 0) - contasPrevistas);
    const pedidosPreservados = Math.min(compra, Math.max(0, aposContas - novo));
    reservaSemanaAtual = Math.min(novo, reservaSemanaBase);
    const aumento = novo - atual;
    if (aumento > 0) {
      reservaSemanaAtual += aumento;
      // A reserva da semana é parte do total protegido, nunca um valor adicional.
      reservaSemanaAtual = Math.min(novo, reservaSemanaAtual);
    }
    if (novo > atual) {
      await tx.insert(appConfigTable).values({ key: keys.reserva, value: (novo / 100).toFixed(2) })
        .onConflictDoUpdate({
          target: appConfigTable.key,
          set: { value: (novo / 100).toFixed(2), updatedAt: new Date() },
        });
      if (novos.length && !reconciliarSemana) {
        await tx.insert(reservaAjustesTable).values({
          valorAnterior: atual,
          aumento: novo - atual,
          valorNovo: novo,
          entradaNova,
          percentual: percentualProtecao,
          contasProtegidas: contasPrevistas,
          pedidosProtegidos: Math.min(pedidosPreservados, Math.max(0, aposContas - novo)),
          ultimoLancamentoId: novos.at(-1)!.id,
        });
      }
    }
    // Sem base física, não consome a entrada; tenta novamente após abrir a gaveta.
    if (novos.length && (entradaNova === 0 || !ativa || dinheiroAtual !== null)) {
      await tx.insert(appConfigTable).values({ key: keys.ultimoLancamentoReserva, value: String(novos.at(-1)!.id) })
        .onConflictDoUpdate({
          target: appConfigTable.key,
          set: { value: String(novos.at(-1)!.id), updatedAt: new Date() },
        });
    }
    const reservaSemanaSalva = (reservaSemanaAtual / 100).toFixed(2);
    const cicloSalvoJson = JSON.stringify(ciclo);
    if (
      config.get(keys.reservaSemana) !== reservaSemanaSalva ||
      config.get(keys.cicloReservaSemana) !== cicloSalvoJson ||
      (reconciliarSemana && config.get(keys.modeloAcumulacaoReserva) !== MODELO_ACUMULACAO_RESERVA)
    ) {
      for (const [key, value] of [
        [keys.reservaSemana, reservaSemanaSalva],
        [keys.cicloReservaSemana, cicloSalvoJson],
        ...(reconciliarSemana ? [[keys.modeloAcumulacaoReserva, MODELO_ACUMULACAO_RESERVA]] : []),
      ]) await tx.insert(appConfigTable).values({ key, value })
        .onConflictDoUpdate({ target: appConfigTable.key, set: { value, updatedAt: new Date() } });
    }
    return {
      reserva: novo, reservaSemana: reservaSemanaAtual, aporte: novo - atual,
      entradaNova: dinheiroAtual === null ? 0 : entradaNova, inicioAgora: false,
      compraPlanejada: Math.min(pedidosPreservados, Math.max(0, aposContas - novo)),
      protecaoAtiva: ativa,
      saldosAtuais: dinheiroAtual === null ? null : { dinheiro: dinheiroAtual, pix: pixAtual },
    };
  });
}

async function snapshot() {
  const now = new Date();
  const today = dayIndex(now);
  const todayString = daySP(now);
  const [config, sessoes, cashRecent, pixRows, pecas, ultimoFechamento, reservaUsosAtivos] = await Promise.all([
    readConfig(),
    db.select().from(caixaSessoesTable).orderBy(desc(caixaSessoesTable.aberturaAt)).limit(1),
    db.select().from(caixaTable).where(gte(caixaTable.createdAt, new Date(Date.now() - 120 * 86400000))),
    db.select({ tipo: caixaTable.tipo, valor: caixaTable.valor })
      .from(caixaTable).where(eq(caixaTable.formaPagamento, "pix")),
    db.select().from(pecasTable),
    db.select({ fechamentoAt: caixaSessoesTable.fechamentoAt }).from(caixaSessoesTable)
      .where(isNotNull(caixaSessoesTable.fechamentoAt))
      .orderBy(desc(caixaSessoesTable.fechamentoAt)).limit(1),
    db.select({ caixaId: reservaUtilizacoesTable.caixaId }).from(reservaUtilizacoesTable)
      .where(isNull(reservaUtilizacoesTable.estornadaAt)),
  ]);
  // Despesas financiadas pela reserva continuam no Caixa real, mas não reduzem
  // novamente o orçamento operacional da IA.
  const caixasPagosPelaReserva = new Set(reservaUsosAtivos
    .map(row => row.caixaId).filter((id): id is number => id !== null));
  const recent = cashRecent.filter(row => !caixasPagosPelaReserva.has(row.id));
  const produtos = pecas.filter(p => p.setor === "cliente");
  const custoPorId = new Map(pecas.map(p => [p.id, p.valorCusto]));
  const sessao = sessoes[0] ?? null;
  // A gaveta não é a soma histórica: cada abertura/fechamento faz um novo balanço físico.
  const dataBase = sessao?.fechamentoAt ?? sessao?.aberturaAt ?? null;
  const saldoBase = sessao?.fechamentoAt
    ? cents(sessao.valorContado ?? sessao.valorFinal ?? sessao.valorInicial)
    : cents(sessao?.valorInicial);
  const movimentosGaveta = dataBase
    ? await db.select().from(caixaTable).where(gte(caixaTable.createdAt, dataBase))
    : [];
  let dinheiro = dataBase
    ? saldoBase + movimentosGaveta.reduce((sum, row) => {
      if (row.formaPagamento && row.formaPagamento !== "dinheiro") return sum;
      return sum + (row.tipo === "entrada" ? 1 : -1) * cents(row.valor);
    }, 0) : null;
  let pix = pixRows.reduce((sum, row) =>
    sum + (row.tipo === "entrada" ? 1 : -1) * cents(row.valor), 0);
  const weekStart = today - ((new Date(`${todayString}T12:00:00Z`).getUTCDay() + 6) % 7);
  const totalPeriod = (min: number, max: number) => {
    const rows = recent.filter(row => {
      const day = dayIndex(row.createdAt);
      return day >= min && day <= max;
    });
    let entradas = 0, saidas = 0, retiradas = 0, compras = 0, custo = 0, custoAusente = false;
    const categoriasTotais: Record<string, number> = {};
    const vendasCusto = new Set<number>();
    for (const row of rows) {
      const amount = cents(row.valor);
      if (row.tipo === "entrada") {
        entradas += amount;
        if (row.pecaId && (!row.vendaId || !vendasCusto.has(row.vendaId))) {
          if (row.vendaId) vendasCusto.add(row.vendaId);
          const custoPeca = custoPorId.get(row.pecaId);
          if (custoPeca && cents(custoPeca) > 0) custo += cents(custoPeca);
          else custoAusente = true;
        }
      } else {
        saidas += amount;
        const categoria = classificar(row.categoria, row.motivo);
        if (categoria) categoriasTotais[categoria] = (categoriasTotais[categoria] ?? 0) + amount;
        if (categoria === "retirada pessoal") retiradas += amount;
        if (categoria === "pecas") compras += amount;
      }
    }
    // Compra de mercadoria é caixa, mas o custo da peça vendida já integra o lucro
    // estimado; retirar ambos aqui duplicaria o custo.
    const outrasSaidas = saidas - compras - retiradas;
    return {
      entradas, saidas, retiradas, compras, custo,
      lucro: custoAusente ? null : entradas - custo - outrasSaidas,
      categorias: categoriasTotais, registros: rows.length,
      custoAusente,
    };
  };
  const week = totalPeriod(weekStart, today);
  const dia = totalPeriod(today, today);
  const previousWeek = totalPeriod(weekStart - 7, weekStart - 1);
  const month = totalPeriod(today - 29, today);
  const previousMonth = totalPeriod(today - 59, today - 30);
  const purchaseRows = recent.filter(row => row.tipo === "saida" &&
    (row.formaPagamento === "dinheiro" || row.formaPagamento === "pix") &&
    classificar(row.categoria, row.motivo) === "pecas" &&
    dayIndex(row.createdAt) >= today - 56);
  const biggestExpense = recent.filter(row => row.tipo === "saida")
    .sort((a, b) => cents(b.valor) - cents(a.valor))[0];
  const byWeek = new Map<number, number>();
  const byDay = new Map<number, number>();
  for (const row of purchaseRows) {
    const date = dayIndex(row.createdAt);
    const weekday = new Date(date * 86400000 + 43200000).getUTCDay();
    const monday = date - ((weekday + 6) % 7);
    byWeek.set(monday, (byWeek.get(monday) ?? 0) + cents(row.valor));
    byDay.set(weekday, (byDay.get(weekday) ?? 0) + 1);
  }
  const purchaseValues = [...byWeek.values()];
  const purchaseAverage = mediaDasSemanasComCompra(purchaseValues);
  const commonDay = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
  const preferredDay = commonDay && commonDay[1] >= 3 ? commonDay[0] : null;
  const stockLow = produtos.filter(p => p.quantidade <= 2)
    .map(p => ({ id: p.id, modelo: p.modelo, quantidade: p.quantidade })).slice(0, 8);
  // Gastos futuros configurados no módulo Financeiro: não são saídas realizadas.
  const expenses: { nome: string; valor: number; vencimento: string }[] = [];
  for (const name of ["aluguel", "energia", "internet", "agua"]) {
    const amount = cents(config.rows.get(`fin_custo_${name}`));
    const due = Number(config.rows.get(`fin_dia_${name}`) ?? "7");
    const paid = config.rows.get(`fin_pago_${name}`);
    for (let offset = 0; offset <= 7; offset++) {
      const date = new Date((today + offset) * 86400000 + 43200000);
      const dateString = date.toISOString().slice(0, 10);
      if (amount > 0 && date.getUTCDate() === due && paid?.slice(0, 7) !== dateString.slice(0, 7))
        expenses.push({ nome: name, valor: amount, vencimento: dateString });
    }
  }
  try {
    const extras = JSON.parse(config.rows.get("fin_contas_extras") ?? "[]") as
      { nome?: string; valor?: string; diaVencimento?: number; pagoEm?: string }[];
    if (Array.isArray(extras)) for (const extra of extras) {
      for (let offset = 0; offset <= 7; offset++) {
        const date = new Date((today + offset) * 86400000 + 43200000);
        const dateString = date.toISOString().slice(0, 10);
        if (date.getUTCDate() === extra.diaVencimento &&
          extra.pagoEm?.slice(0, 7) !== dateString.slice(0, 7) && cents(extra.valor) > 0)
          expenses.push({ nome: extra.nome ?? "Conta", valor: cents(extra.valor), vencimento: dateString });
      }
    }
  } catch { /* configuração legada inválida: não inventar vencimentos */ }
  const expensesTotal = expenses.reduce((sum, e) => sum + e.valor, 0);
  const movimentosRecentes = recent.map(row => ({
    dia: dayIndex(row.createdAt),
    tipo: row.tipo,
    formaPagamento: row.formaPagamento,
    valorCentavos: cents(row.valor),
  }));
  const movimentosElegiveisSemana = somarMovimentosElegiveisDoPeriodo(
    movimentosRecentes, weekStart, today,
  );
  const periodosAnteriores = [1, 2, 3, 4].map(i => {
    const min = weekStart - i * 7, max = min + 6;
    const registros = movimentosRecentes.filter(row =>
      row.dia >= min && row.dia <= max &&
      (row.formaPagamento === "dinheiro" || row.formaPagamento === "pix") &&
      (row.tipo === "entrada" || row.tipo === "saida"),
    );
    return {
      saidas: registros.filter(row => row.tipo === "saida")
        .reduce((sum, row) => sum + row.valorCentavos, 0),
      comHistoricoElegivel: registros.length > 0,
    };
  });
  const mediaSemanalSaidas = periodosAnteriores.every(periodo => periodo.comHistoricoElegivel)
    ? Math.round(periodosAnteriores.reduce((sum, periodo) => sum + periodo.saidas, 0) / 4)
    : null;
  const compraOperacional = config.meta > 0 ? config.meta : purchaseAverage ?? 0;
  const alocacaoSemana = calcularAlocacaoSemanal(
    movimentosElegiveisSemana.entradas,
    movimentosElegiveisSemana.saidas,
    mediaSemanalSaidas,
    expensesTotal + compraOperacional,
    config.proteger,
  );
  const entradasSemana = movimentosElegiveisSemana.entradas;
  const taxaReserva = alocacaoSemana.percentualProtecao;
  const reservaAutomatica = await atualizarReservaGradual(
    dinheiro === null ? null : dinheiro + pix, config.reserva, config.reservaSemana,
    compraOperacional,
    expensesTotal,
    alocacaoSemana.protecaoCentavos,
    alocacaoSemana.necessidadeOperacionalCentavos,
    taxaReserva,
    today,
    weekStart,
  );
  const historicoReserva = await db.select().from(reservaAjustesTable)
    .orderBy(desc(reservaAjustesTable.id));
  if (reservaAutomatica.saldosAtuais) {
    dinheiro = reservaAutomatica.saldosAtuais.dinheiro;
    pix = reservaAutomatica.saldosAtuais.pix;
  }
  const total = dinheiro === null ? null : dinheiro + pix;
  config.reserva = reservaAutomatica.reserva;
  if (reservaAutomatica.protecaoAtiva !== null) config.proteger = reservaAutomatica.protecaoAtiva;
  const movimentosSemFormaSemana = movimentosRecentes.filter(row =>
    row.dia >= weekStart && row.dia <= today &&
    !row.formaPagamento &&
    (row.tipo === "entrada" || row.tipo === "saida"),
  );
  const semFormaEntradas = movimentosSemFormaSemana
    .filter(row => row.tipo === "entrada")
    .reduce((sum, row) => sum + row.valorCentavos, 0);
  const semFormaSaidas = movimentosSemFormaSemana
    .filter(row => row.tipo === "saida")
    .reduce((sum, row) => sum + row.valorCentavos, 0);
  const saldos = calcularDisponibilidade(dinheiro, pix, config.reserva, config.proteger, 0, 0);
  const disponivel = saldos.disponivel;
  const spending = calcularDisponibilidade(dinheiro, pix, config.reserva, config.proteger, expensesTotal, config.meta);
  const safeToSpend = spending.podeGastar;
  const recentDays = totalPeriod(today - 27, today);
  const distinctDays = new Set(recent.filter(row => dayIndex(row.createdAt) >= today - 27)
    .map(row => daySP(row.createdAt))).size;
  const projected = total === null || distinctDays < 7 ? null
    : total + Math.round((recentDays.entradas - recentDays.saidas) / 28 * 7);
  const { alertas: alerts, analiseGastos } = analisarAlertasFinanceiros({
    movimentos: recent.map(row => ({
      dia: dayIndex(row.createdAt),
      tipo: row.tipo === "entrada" ? "entrada" as const : "saida" as const,
      valor: cents(row.valor),
      categoria: row.tipo === "saida" ? classificar(row.categoria, row.motivo) : null,
    })),
    hoje: today, disponivel, total, reserva: config.reserva, proteger: config.proteger,
    mediaCompras: purchaseAverage, semanasComCompras: purchaseValues.length,
    contasPrevistas: expensesTotal, estoqueBaixo: stockLow,
  });
  const situacao = alerts.some(a => a.nivel === "risco") ? "risco" :
    alerts.some(a => a.nivel === "atencao") ? "atencao" :
    alerts.some(a => a.nivel === "positivo") ? "saudavel" : recent.length === 0 ? "sem_dados" : "sem_alertas";
  return {
    atualizadoEm: now.toISOString(),
    ultimoFechamentoCaixa: ultimoFechamento[0]?.fechamentoAt?.toISOString() ?? null,
    saldos: {
      dinheiro: dinheiro === null ? null : money(dinheiro),
      pix: money(pix), total: total === null ? null : money(total),
      reserva: money(config.reserva), protecaoAtiva: config.proteger,
      disponivel: disponivel === null ? null : money(disponivel),
      podeGastar: safeToSpend === null ? null : money(safeToSpend),
      base: sessao ? `Dinheiro: ${sessao.status === "aberto" ? "abertura" : "último fechamento"} da gaveta e movimentos posteriores. PIX: saldo líquido dos lançamentos registrados desde o início; transferências fora do sistema não estão incluídas.` : "Sem sessão do Caixa registrada: saldo físico e disponibilidade não calculáveis.",
    },
    metaCompra: money(config.meta),
    reservaAutomatica: {
      reservaSemana: money(reservaAutomatica.reservaSemana),
      aporte: money(reservaAutomatica.aporte),
      entradaNova: money(reservaAutomatica.entradaNova),
      percentual: taxaReserva,
      entradasSemana: money(entradasSemana),
      // Mantém o campo antigo para consumidores que ainda não migraram o nome.
      entradas7Dias: money(entradasSemana),
      compraProtegida: money(reservaAutomatica.compraPlanejada),
      contasProtegidas: money(expensesTotal),
      estado: !config.proteger ? "pausada" : total === null ? "sem_saldo"
        : reservaAutomatica.aporte > 0 ? "acumulando"
        : reservaAutomatica.inicioAgora ? "iniciando"
        : reservaAutomatica.entradaNova <= 0 ? "sem_entradas"
        : "sem_aumento",
      historico: historicoReserva.map(ajuste => ({
        id: ajuste.id,
        data: ajuste.createdAt.toISOString(),
        anterior: money(ajuste.valorAnterior),
        aumento: money(ajuste.aumento),
        novo: money(ajuste.valorNovo),
        entradaNova: money(ajuste.entradaNova),
        percentual: ajuste.percentual,
        contasProtegidas: money(ajuste.contasProtegidas),
        pedidosProtegidos: money(ajuste.pedidosProtegidos),
      })),
    },
    movimentoSemana: {
      inicio: daySP(new Date(weekStart * 86400000 + 43200000)),
      fim: todayString,
      entradas: money(movimentosElegiveisSemana.entradas),
      saidas: money(movimentosElegiveisSemana.saidas),
      percentualProtecao: config.proteger ? taxaReserva : 0,
      protecao: money(alocacaoSemana.protecaoCentavos),
      alocacaoOperacao: money(alocacaoSemana.operacaoCentavos),
      necessidadeOperacional: money(alocacaoSemana.necessidadeOperacionalCentavos),
      saldoOperacional: money(alocacaoSemana.fluxoLiquidoCentavos),
      entradasSemForma: money(semFormaEntradas),
      saidasSemForma: money(semFormaSaidas),
    },
    faltamMeta: spending.faltaMeta === null ? null : money(spending.faltaMeta),
    dia: { entradas: money(dia.entradas), saidas: money(dia.saidas), retiradas: money(dia.retiradas) },
    semana: {
      entradas: money(week.entradas), saidas: money(week.saidas),
      retiradas: money(week.retiradas), compras: money(week.compras),
      custo: money(week.custo), lucro: week.lucro === null ? null : money(week.lucro),
      registros: week.registros, custoAusente: week.custoAusente,
    },
    mes: { entradas: money(month.entradas), saidas: money(month.saidas), lucro: month.lucro === null ? null : money(month.lucro) },
    comparacao: { semanaAnterior: { entradas: money(previousWeek.entradas), saidas: money(previousWeek.saidas) }, periodoAnterior: { entradas: money(previousMonth.entradas), saidas: money(previousMonth.saidas) } },
    analiseGastos,
    compras: {
      totalSemana: money(week.compras), mediaSemanal: purchaseAverage === null ? null : money(purchaseAverage),
      menor: purchaseValues.length ? money(Math.min(...purchaseValues)) : null,
      maior: purchaseValues.length ? money(Math.max(...purchaseValues)) : null,
      tendencia: purchaseValues.length < 2 ? null : money(purchaseValues.at(-1)! - purchaseValues.at(-2)!),
      diaHabitual: preferredDay,
      semanasRegistradas: purchaseValues.length,
    },
    categorias: Object.fromEntries(Object.entries(week.categorias).map(([key, v]) => [key, money(v)])),
    maiorDespesa: biggestExpense ? {
      valor: money(cents(biggestExpense.valor)),
      motivo: biggestExpense.motivo,
      data: daySP(biggestExpense.createdAt),
      categoria: classificar(biggestExpense.categoria, biggestExpense.motivo) ?? "não classificada",
    } : null,
    estoqueBaixo: stockLow,
    despesasPrevistas: { total: money(expensesTotal), contas: expenses.map(e => ({ ...e, valor: money(e.valor) })) },
    projecao7Dias: projected === null ? null : money(projected),
    situacao, observacoes: alerts.slice(0, 5),
    avisos: [
      "Disponível = dinheiro físico apurado + PIX registrado − reserva protegida. Cartão não é dinheiro disponível.",
      "Lucro estimado depende dos custos das peças cadastrados; não inclui custos de serviços não registrados.",
      "Compras semanais consideram apenas semanas com compras de peças identificáveis no Caixa.",
      "Projeção baseada nos últimos 28 dias, não é garantia de saldo futuro.",
    ],
  };
}

router.get("/financeiro-ia", async (_req, res) => {
  try { res.json(await snapshot()); }
  catch (err) { _req.log.error({ err }, "financeiro-ia"); res.status(500).json({ error: "Não foi possível analisar o Caixa." }); }
});

router.put("/financeiro-ia/config", async (req, res) => {
  const reserva = inputMoney(req.body?.reserva);
  const meta = inputMoney(req.body?.metaCompra);
  const proteger = req.body?.protecaoAtiva;
  if (reserva === null || meta === null || typeof proteger !== "boolean") {
    res.status(400).json({ error: "Informe o saldo protegido atual, a compra planejada e o estado da proteção." }); return;
  }
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(65812004)`);
      const rows = await tx.select().from(appConfigTable);
      const semanaManual = Math.min(
        reserva,
        cents(new Map(rows.map(row => [row.key, row.value])).get(keys.reservaSemana) ?? "0"),
      );
      for (const [key, value] of [
        [keys.reserva, (reserva / 100).toFixed(2)],
        [keys.reservaSemana, (semanaManual / 100).toFixed(2)],
        [keys.meta, (meta / 100).toFixed(2)],
        [keys.proteger, String(proteger)],
      ]) await tx.insert(appConfigTable).values({ key, value })
        .onConflictDoUpdate({ target: appConfigTable.key, set: { value, updatedAt: new Date() } });
    });
    res.json(await snapshot());
  } catch (err) { req.log.error({ err }, "financeiro-ia/config"); res.status(500).json({ error: "Não foi possível salvar a configuração." }); }
});

router.get("/financeiro-ia/reserva", async (_req, res) => {
  const [config, ajustes, usos, saidas] = await Promise.all([
    readConfig(),
    db.select().from(reservaAjustesTable).orderBy(desc(reservaAjustesTable.id)),
    db.select().from(reservaUtilizacoesTable).orderBy(desc(reservaUtilizacoesTable.createdAt)),
    db.select().from(caixaTable).where(eq(caixaTable.tipo, "saida")).orderBy(desc(caixaTable.createdAt)).limit(100),
  ]);
  const vinculadas = new Set(usos.filter(uso => uso.estornadaAt === null).map(uso => uso.caixaId).filter((id): id is number => id !== null));
  const contribuicoes = ajustes.reduce((total, ajuste) => total + ajuste.aumento, 0);
  const usado = usos.filter(uso => uso.estornadaAt === null).reduce((total, uso) => total + uso.valorCentavos, 0);
  const saldo = cents(config.rows.get(keys.reserva) ?? "0");
  const saldoInicial = Math.max(0, saldo + usado - contribuicoes);
  res.json({
    saldo: money(saldo),
    saldoInicial: money(saldoInicial),
    totalContribuido: money(contribuicoes),
    totalUtilizado: money(usado),
    saidasDisponiveis: saidas.filter(saida => !vinculadas.has(saida.id)).map(saida => ({
      id: saida.id, valor: saida.valor, motivo: saida.motivo,
      categoria: saida.categoria, createdAt: saida.createdAt.toISOString(),
      formaPagamento: saida.formaPagamento,
    })),
    historico: [
      ...ajustes.map(ajuste => ({
        id: `aporte-${ajuste.id}`, tipo: "contribuicao" as const,
        valor: money(ajuste.aumento), data: ajuste.createdAt.toISOString(),
        motivo: "Contribuição automática da reserva", estornada: false,
        saldoAnterior: money(ajuste.valorAnterior), saldoNovo: money(ajuste.valorNovo),
      })),
      ...usos.flatMap(uso => [
        {
          id: `uso-${uso.id}`, usoId: uso.id, tipo: uso.tipo,
          valor: money(uso.valorCentavos), data: uso.createdAt.toISOString(),
          motivo: uso.motivo, categoria: uso.categoria, descricao: uso.descricao,
          caixaId: uso.caixaId, formaPagamento: uso.formaPagamento,
          estornada: uso.estornadaAt !== null,
          saldoAnterior: money(uso.saldoAnteriorCentavos), saldoNovo: money(uso.saldoNovoCentavos),
        },
        ...(uso.estornadaAt ? [{
          id: `estorno-${uso.id}`, tipo: "estorno" as const,
          valor: money(uso.valorCentavos), data: uso.estornadaAt.toISOString(),
          motivo: uso.motivoEstorno ?? `Estorno de ${uso.motivo}`, estornada: false,
          saldoAnterior: money(uso.saldoAnteriorEstornoCentavos ?? uso.saldoNovoCentavos),
          saldoNovo: money(uso.saldoNovoEstornoCentavos ?? uso.saldoAnteriorCentavos),
        }] : []),
      ]),
    ].sort((a, b) => Date.parse(b.data) - Date.parse(a.data)),
  });
});

router.post("/financeiro-ia/reserva/utilizacoes", async (req, res) => {
  const requestKey = String(req.body?.requestKey ?? "").trim();
  const valorCentavos = inputMoney(req.body?.valor);
  const tipo = req.body?.tipo === "transferencia" ? "transferencia" : "despesa";
  const categoria = String(req.body?.categoria ?? "outros").trim().slice(0, 40);
  const motivo = String(req.body?.motivo ?? "").trim().slice(0, 120);
  const descricao = String(req.body?.descricao ?? "").trim().slice(0, 500) || null;
  const dataRaw = String(req.body?.data ?? "");
  const data = new Date(dataRaw);
  const caixaIdRaw = req.body?.caixaId;
  const caixaId = caixaIdRaw == null || caixaIdRaw === "" ? null : Number(caixaIdRaw);
  let forma = req.body?.formaPagamento === "pix" ? "pix" : req.body?.formaPagamento === "dinheiro" ? "dinheiro" : null;
  const origemDinheiro = String(req.body?.origemDinheiro ?? "").trim().slice(0, 80);
  if (tipo === "transferencia") forma = origemDinheiro || null;
  if (requestKey.length < 8 || requestKey.length > 120 || valorCentavos === null || valorCentavos <= 0 ||
    !motivo || !categoria || !Number.isFinite(data.getTime()) || data.getTime() > Date.now() ||
    (tipo === "despesa" && caixaId !== null && !Number.isSafeInteger(caixaId)) ||
    (tipo === "despesa" && caixaId === null && !forma)) {
    res.status(400).json({ error: "Informe valor, data/hora, motivo e os dados da saída." }); return;
  }
  try {
    const result = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(65812004)`);
      const [prior] = await tx.select().from(reservaUtilizacoesTable)
        .where(eq(reservaUtilizacoesTable.requestKey, requestKey)).for("update");
      if (prior) return { duplicated: true, id: prior.id };
      const config = new Map((await tx.select().from(appConfigTable)).map(row => [row.key, row.value]));
      const saldoAnterior = cents(config.get(keys.reserva) ?? "0");
      if (valorCentavos > saldoAnterior) throw new Error("O valor ultrapassa o saldo protegido disponível.");
      let linkedCashId: number | null = null;
      let dataMovimento = data;
      if (tipo === "despesa") {
        if (caixaId !== null) {
          const [saida] = await tx.select().from(caixaTable).where(eq(caixaTable.id, caixaId)).for("update");
          if (!saida || saida.tipo !== "saida") throw new Error("Selecione uma saída válida do Caixa.");
          if (cents(saida.valor) !== valorCentavos) throw new Error("O valor precisa ser igual ao da saída já registrada.");
          dataMovimento = saida.createdAt;
          forma = saida.formaPagamento;
          const [usoExistente] = await tx.select({ id: reservaUtilizacoesTable.id })
            .from(reservaUtilizacoesTable)
            .where(and(eq(reservaUtilizacoesTable.caixaId, caixaId), isNull(reservaUtilizacoesTable.estornadaAt)));
          if (usoExistente) throw new Error("Esta saída já está vinculada a uma utilização da reserva.");
          linkedCashId = caixaId;
        } else {
          const [saida] = await tx.insert(caixaTable).values({
            tipo: "saida", valor: (valorCentavos / 100).toFixed(2).replace(".", ","),
            motivo, observacao: descricao, categoria, formaPagamento: forma,
            createdAt: data,
          }).returning({ id: caixaTable.id });
          linkedCashId = saida.id;
        }
      }
      const saldoNovo = saldoAnterior - valorCentavos;
      const saldoSemana = cents(config.get(keys.reservaSemana) ?? "0");
      await tx.insert(reservaUtilizacoesTable).values({
        requestKey, valorCentavos, saldoAnteriorCentavos: saldoAnterior,
        saldoNovoCentavos: saldoNovo, tipo, categoria, motivo, descricao,
        formaPagamento: forma, caixaId: linkedCashId, createdAt: dataMovimento,
      });
      for (const [key, value] of [
        [keys.reserva, (saldoNovo / 100).toFixed(2)],
        [keys.reservaSemana, (Math.min(saldoNovo, Math.max(0, saldoSemana - valorCentavos)) / 100).toFixed(2)],
      ]) await tx.insert(appConfigTable).values({ key, value })
        .onConflictDoUpdate({ target: appConfigTable.key, set: { value, updatedAt: new Date() } });
      return { duplicated: false };
    });
    res.status(result.duplicated ? 200 : 201).json({ ...result, resumo: await snapshot() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Não foi possível registrar a utilização.";
    res.status(message.includes("saldo protegido") || message.includes("vinculada") || message.includes("saída") ? 409 : 500)
      .json({ error: message });
  }
});

router.post("/financeiro-ia/reserva/utilizacoes/:id/estornar", async (req, res) => {
  const id = Number(req.params.id);
  const motivo = String(req.body?.motivo ?? "").trim().slice(0, 200) || "Utilização estornada";
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Utilização inválida." }); return; }
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(65812004)`);
      const [uso] = await tx.select().from(reservaUtilizacoesTable)
        .where(eq(reservaUtilizacoesTable.id, id)).for("update");
      if (!uso) throw new Error("Utilização não encontrada.");
      if (uso.estornadaAt) return;
      const config = new Map((await tx.select().from(appConfigTable)).map(row => [row.key, row.value]));
      const saldo = cents(config.get(keys.reserva) ?? "0");
      const semana = cents(config.get(keys.reservaSemana) ?? "0");
      const novo = saldo + uso.valorCentavos;
      const hoje = dayIndex(new Date());
      const semanaInicio = hoje - ((new Date(`${daySP(new Date())}T12:00:00Z`).getUTCDay() + 6) % 7);
      const semanaNova = dayIndex(uso.createdAt) >= semanaInicio
        ? Math.min(novo, semana + uso.valorCentavos) : Math.min(novo, semana);
      await tx.update(reservaUtilizacoesTable)
        .set({
          estornadaAt: new Date(), motivoEstorno: motivo,
          saldoAnteriorEstornoCentavos: saldo, saldoNovoEstornoCentavos: novo,
        })
        .where(eq(reservaUtilizacoesTable.id, id));
      for (const [key, value] of [
        [keys.reserva, (novo / 100).toFixed(2)],
        [keys.reservaSemana, (semanaNova / 100).toFixed(2)],
      ]) await tx.insert(appConfigTable).values({ key, value })
        .onConflictDoUpdate({ target: appConfigTable.key, set: { value, updatedAt: new Date() } });
    });
    res.json({ resumo: await snapshot() });
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "Não foi possível estornar." });
  }
});

router.post("/financeiro-ia/retiradas", async (req, res) => {
    const amount = question.match(/(?:r\$\s*)?((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?)/i);
  const motivo = String(req.body?.motivo ?? "").trim().slice(0, 120);
  const observacao = String(req.body?.observacao ?? "").trim().slice(0, 500);
  const date = String(req.body?.data ?? "");
  const forma = req.body?.formaPagamento;
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : null;
  const validDate = parsedDate !== null && Number.isFinite(parsedDate.getTime()) &&
    parsedDate.toISOString().slice(0, 10) === date;
  if (amount === null || amount <= 0 || !motivo || !validDate ||
    dayIndex(new Date(`${date}T12:00:00Z`)) > dayIndex(new Date()) ||
    (forma !== "dinheiro" && forma !== "pix")) {
    res.status(400).json({ error: "Informe valor positivo, motivo, data válida e dinheiro ou PIX." }); return;
  }
  try {
    const [row] = await db.insert(caixaTable).values({
      tipo: "saida", valor: (amount / 100).toFixed(2).replace(".", ","),
      motivo, observacao, categoria: "retirada pessoal", formaPagamento: forma,
      createdAt: new Date(`${date}T15:00:00Z`),
    }).returning();
    res.status(201).json({ id: row.id, resumo: await snapshot() });
  } catch (err) { req.log.error({ err }, "financeiro-ia/retiradas"); res.status(500).json({ error: "Não foi possível registrar a retirada." }); }
});

function formatConcern(a: { aconteceu: string; dado: string; impacto: string; continuidade: string; sugestao: string }) {
  return [`O que aconteceu? ${a.aconteceu}`, `Qual dado provocou o alerta? ${a.dado}`, `Como isso afetou o caixa? ${a.impacto}`, `O que pode acontecer se continuar? ${a.continuidade}`, `Qual ação considerar? ${a.sugestao}`].join("\n");
}

function normalize(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
const insufficient = "Não tenho dados suficientes registrados no Caixa para calcular isso.";
function respostaConsultivaValida(resposta: string): boolean {
  const texto = normalize(resposta);
  if (/\b(errad[oa]s?|ruim|administrando mal|gastando demais|gastou demais)\b/.test(texto)) return false;
  if (texto === normalize(insufficient)) return true;
  return ["o que aconteceu?", "qual dado", "como isso afetou o caixa?", "o que pode acontecer se continuar?", "qual acao considerar?"].every(parte => texto.includes(parte));
}
router.post("/financeiro-ia/transcrever", async (req, res): Promise<void> => {
  const audioBase64 = req.body?.audioBase64;
  const mimeType = String(req.body?.mimeType ?? "").split(";")[0];
  if (typeof audioBase64 !== "string" || !audioBase64 || audioBase64.length > 7_000_000
    || audioBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(audioBase64)
    || !["audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/ogg"].includes(mimeType)) {
    res.status(400).json({ error: "Envie um áudio válido de até 5 MB." });
    return;
  }
  if (Buffer.from(audioBase64, "base64").byteLength > 5 * 1024 * 1024) {
    res.status(413).json({ error: "Áudio muito grande. Faça uma pergunta mais curta." });
    return;
  }
  const key = req.ip ?? "sem-ip";
  const now = Date.now();
  if (voiceRequests.size > 2000) {
    for (const [ip, value] of voiceRequests) if (value.resetAt <= now) voiceRequests.delete(ip);
  }
  const previous = voiceRequests.get(key);
  if (previous && previous.resetAt > now && previous.count >= 8) {
    res.status(429).json({ error: "Muitas perguntas por voz. Aguarde um minuto." });
    return;
  }
  voiceRequests.set(key, previous && previous.resetAt > now
    ? { count: previous.count + 1, resetAt: previous.resetAt }
    : { count: 1, resetAt: now + 60_000 });

  try {
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `Você é um assistente financeiro de uma loja. Responda em português usando SOMENTE os fatos JSON a seguir; se a pergunta exigir dados ausentes, diga exatamente "${insufficient}". Nunca proponha ações automáticas, nunca invente valores nem faça julgamentos vagos (errado, ruim, administrando mal). Se identificar algo que merece atenção, use cinco partes: O que aconteceu? Qual dado provocou o alerta? Como isso afetou o caixa? O que pode acontecer se continuar? Qual ação considerar? Diferencie fatos de riscos condicionais, e deixe a decisão com o usuário. Fatos: ${facts}. Pergunta: ${question}`,
        });
    const parsed: unknown = JSON.parse(response.text ?? "{}");
    const text = String((parsed as { pergunta?: unknown })?.pergunta ?? "").trim();
    if (!text || text.length > 400) {
      res.status(422).json({ error: "Não consegui entender a pergunta. Tente falar mais devagar." });
      return;
    }
    res.json({ pergunta: text });
  } catch (err) {
    req.log.warn({ err }, "financeiro-ia transcrição indisponível");
    res.status(502).json({ error: "Não consegui transcrever a pergunta agora. Tente novamente." });
  }
});

router.post("/financeiro-ia/perguntar", async (req, res) => {
  const question = String(req.body?.pergunta ?? "").trim();
  if (!question || question.length > 400) {
    res.status(400).json({ error: "Escreva uma pergunta de até 400 caracteres." }); return;
  }
  try {
    const s = await snapshot();
    const q = normalize(question);
    const saldo = s.saldos;
    let answer: string | null = null;
    const amount = question.match(/(?:r\$\s*)?((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?)/i);
    const target = amount ? inputMoney(amount[1].replace(/\./g, "")) : null;
    if (/posso comprar|comprar.*peca|comprar.*estoque/.test(q)) {
      if (saldo.disponivel === null) answer = insufficient;
      else if (target === null) answer = `Disponível após a reserva protegida: ${reais(Math.round(saldo.disponivel * 100))}. Margem conservadora depois das contas previstas e da meta de compra: ${saldo.podeGastar === null ? "indisponível" : reais(Math.round(saldo.podeGastar * 100))}. Informe o valor do pedido para comparar.`;
      else if (target > Math.round(saldo.disponivel * 100)) {
        const gap = target - Math.round(saldo.disponivel * 100);
        answer = formatConcern({
          aconteceu: "A compra consultada excede o disponível após a reserva protegida.",
          dado: `Compra: ${reais(target)}; disponível sem reserva: ${reais(Math.round(saldo.disponivel * 100))}; diferença: ${reais(gap)}.`,
          impacto: `Se a compra fosse paga agora em dinheiro/PIX, ultrapassaria o disponível em ${reais(gap)}. Nenhum valor foi movimentado.`,
          continuidade: "Se compras acima do disponível ocorrerem antes de novas entradas, a reserva poderá ser comprometida.",
          sugestao: "Considere ajustar a lista de peças ou aguardar entradas efetivamente recebidas; a decisão é sua."
        });
      } else if (saldo.podeGastar !== null && target > Math.round(saldo.podeGastar * 100)) {
        const margem = Math.round(saldo.podeGastar * 100);
        answer = `O pedido de ${reais(target)} cabe no disponível após a reserva protegida (${reais(Math.round(saldo.disponivel * 100))}), mas ultrapassa em ${reais(target - margem)} a margem conservadora (${reais(margem)}), que preserva contas previstas nos próximos 7 dias e a meta de compra. Ele pode comprometer esse planejamento; nenhum valor foi movimentado.`;
      } else if (saldo.podeGastar === null) {
        answer = `O pedido de ${reais(target)} cabe no disponível após a reserva protegida (${reais(Math.round(saldo.disponivel * 100))}), mas não há dados suficientes para confirmar que cabe sem afetar contas previstas e a meta de compra. Nenhum valor foi movimentado.`;
      } else {
        answer = `O pedido de ${reais(target)} cabe na margem conservadora de ${reais(Math.round(saldo.podeGastar * 100))}, após a reserva protegida, as contas previstas nos próximos 7 dias e a meta de compra. Nenhum valor foi movimentado automaticamente.`;
      }
    } else if (/quanto.*(gastar|retirar|separar para mim)/.test(q)) {
      answer = saldo.podeGastar === null ? insufficient
        : `Limite conservador registrado: ${reais(Math.round(saldo.podeGastar * 100))}. Cálculo: ${reais(Math.round(saldo.disponivel! * 100))} disponível − ${reais(Math.round(s.despesasPrevistas.total * 100))} em contas previstas nos próximos 7 dias − ${reais(Math.round(s.metaCompra * 100))} da meta de compra. Não inclui despesas não cadastradas.`;
    } else if (/reserva|disponivel|caixa/.test(q)) {
      const positivo = Math.max(0, Math.round(s.movimentoSemana.saldoOperacional * 100));
      answer = `Nesta semana, de ${s.movimentoSemana.inicio} até ${s.movimentoSemana.fim}, entraram ${reais(Math.round(s.movimentoSemana.entradas * 100))} em dinheiro/PIX e saíram ${reais(Math.round(s.movimentoSemana.saidas * 100))}. Primeiro, o saldo líquido é calculado: ${reais(Math.round(s.movimentoSemana.entradas * 100))} − ${reais(Math.round(s.movimentoSemana.saidas * 100))} = ${reais(Math.round(s.movimentoSemana.saldoOperacional * 100))}. ${positivo > 0 && s.saldos.protecaoAtiva ? `Com a proteção ativa, a divisão é 60% para operação (${reais(Math.round(s.movimentoSemana.alocacaoOperacao * 100))}) e 40% para proteção (${reais(Math.round(s.movimentoSemana.protecao * 100))}); os valores somam exatamente ${reais(positivo)} após o arredondamento.` : positivo > 0 ? `Com a proteção desativada, os ${reais(positivo)} ficam na operação.` : "Como o saldo líquido não é positivo, não há parcelas positivas para dividir."} O valor calculado para proteção é somado ao total protegido conforme entram novos lançamentos elegíveis; é uma classificação contábil, não uma saída nem transferência. Há lançamentos sem forma de pagamento informada que foram excluídos: ${reais(Math.round(s.movimentoSemana.entradasSemForma * 100))} em entradas e ${reais(Math.round(s.movimentoSemana.saidasSemForma * 100))} em saídas. O Caixa + PIX registrado agora soma ${saldo.total === null ? "indisponível" : reais(Math.round(saldo.total * 100))}; após a reserva protegida total de ${reais(Math.round(saldo.reserva * 100))}, ficam ${saldo.disponivel === null ? "indisponível" : reais(Math.round(saldo.disponivel * 100))} disponíveis. A margem conservadora para gastos após contas previstas e meta de compra é ${saldo.podeGastar === null ? "indisponível" : reais(Math.round(saldo.podeGastar * 100))}. O valor considerado protegido nesta semana foi ${reais(Math.round(s.reservaAutomatica.reservaSemana * 100))}. O saldo protegido total continua acumulando sem teto máximo.`;
    } else if (/maior despesa/.test(q)) {
      answer = s.maiorDespesa
        ? `Maior saída registrada nos últimos 120 dias: ${reais(Math.round(s.maiorDespesa.valor * 100))}, ${s.maiorDespesa.motivo} (${s.maiorDespesa.categoria}), em ${s.maiorDespesa.data}.`
        : insufficient;
    } else if (/(preciso|falta).*fatur.*compra|quanto.*(proxima|pr[oó]xima) compra/.test(q)) {
      const goal = s.metaCompra > 0 ? s.metaCompra : s.compras.mediaSemanal;
      if (saldo.disponivel === null || goal === null) answer = insufficient;
      else {
        const gap = Math.max(0, Math.round((goal - saldo.disponivel) * 100));
        answer = gap === 0 ? `A ${s.metaCompra > 0 ? "meta planejada" : "média semanal registrada"} de ${reais(Math.round(goal * 100))} já cabe no disponível registrado de ${reais(Math.round(saldo.disponivel * 100))}, antes das contas futuras.` : formatConcern({
          aconteceu: "O disponível ainda está abaixo da próxima compra considerada.",
          dado: `Compra ${s.metaCompra > 0 ? "planejada" : "média registrada"}: ${reais(Math.round(goal * 100))}; disponível: ${reais(Math.round(saldo.disponivel * 100))}; diferença: ${reais(gap)}.`,
          impacto: `Sem novas entradas, uma compra desse valor ultrapassaria o disponível em ${reais(gap)}.`,
          continuidade: "Novas saídas antes da compra podem ampliar essa diferença; não é possível converter a diferença em faturamento bruto sem conhecer forma de recebimento e gastos futuros.",
          sugestao: "Considere acompanhar entradas efetivamente recebidas em dinheiro/PIX e revisar a compra antes de confirmá-la."
        });
      }
    } else if (/gasto.*mais|gastando demais/.test(q)) {
      const spendingAlert = s.observacoes.find(a => a.titulo === "Compras de peças acima da média" || a.titulo === "Saídas acima da média registrada");
      if (spendingAlert) {
        answer = formatConcern(spendingAlert);
      } else if (s.analiseGastos.mediaSemanal4Semanas === null) {
        answer = `${insufficient} Nos últimos 7 dias, as saídas registradas foram ${reais(Math.round(s.analiseGastos.ultimos7Dias * 100))}; não há registros em todas as quatro semanas anteriores para uma comparação responsável.`;
      } else {
        const a = s.analiseGastos;
        const percentual = a.variacaoPercentual;
        const direction = percentual === null ? "sem variação percentual calculável" : percentual > 0 ? `${percentual}% acima` : `${Math.abs(percentual)}% abaixo ou igual`;
        answer = [`O que aconteceu? As saídas registradas nos últimos 7 dias estão ${direction} da média recente.`,
          `Qual dado provocou a análise? Saídas: ${reais(Math.round(a.ultimos7Dias * 100))}; média semanal das quatro semanas anteriores: ${reais(Math.round(a.mediaSemanal4Semanas! * 100))}.`,
          `Como isso afetou o caixa? Essas saídas reduziram o fluxo em ${reais(Math.round(a.ultimos7Dias * 100))}; ${saldo.disponivel === null ? "não é possível calcular o disponível sem sessão da gaveta" : `o disponível atual, após outros movimentos e a reserva, é ${reais(Math.round(saldo.disponivel * 100))}`}.`,
          "O que pode acontecer se continuar? Saídas futuras sem entradas correspondentes podem reduzir a margem operacional; não é uma previsão certa.",
          "Qual ação considerar? Confira as categorias registradas e as contas previstas antes de decidir o próximo gasto."].join("\n");
      }
    } else if (/fatur|melhorando|evolu/.test(q)) {
      answer = s.semana.registros ? `Entradas hoje: ${reais(Math.round(s.dia.entradas * 100))}; nesta semana: ${reais(Math.round(s.semana.entradas * 100))}; semana anterior: ${reais(Math.round(s.comparacao.semanaAnterior.entradas * 100))}. Nos últimos 30 dias: ${reais(Math.round(s.mes.entradas * 100))}; 30 dias anteriores: ${reais(Math.round(s.comparacao.periodoAnterior.entradas * 100))}. A semana atual está em andamento; faturamento sozinho não mede lucro.`
        : insufficient;
    } else if (/lucro/.test(q)) {
      answer = s.semana.registros === 0 || s.semana.lucro === null ? insufficient
        : `Lucro estimado da semana: ${reais(Math.round(s.semana.lucro * 100))}. Entradas ${reais(Math.round(s.semana.entradas * 100))} menos custo das peças vendidas e despesas operacionais registradas; compras de estoque e retiradas não são descontadas duas vezes. Custos de serviços não registrados não entram.`;
    } else if (/peca|estoque|compra/.test(q)) {
      answer = s.compras.mediaSemanal === null ? insufficient
        : `Compras de peças nesta semana: ${reais(Math.round(s.compras.totalSemana * 100))}. Média: ${reais(Math.round(s.compras.mediaSemanal * 100))} por semana com compras registradas (${s.compras.semanasRegistradas} semana(s)). ${s.estoqueBaixo.length} produto(s) com estoque baixo.`;
    } else if (/proxim|previs|futuro/.test(q)) {
      answer = s.projecao7Dias === null ? insufficient
        : `Estimativa para os próximos 7 dias: ${reais(Math.round(s.projecao7Dias * 100))}, baseada na média diária dos últimos 28 dias registrados. Contas previstas até lá: ${reais(Math.round(s.despesasPrevistas.total * 100))}. É uma projeção, não uma garantia.`;
    }
    // Opcional no host externo: sem integração configurada, não há resposta
    // generativa que possa inventar números. As respostas essenciais acima funcionam.
    if (!answer && process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
      const facts = JSON.stringify({
        saldos: s.saldos, semana: s.semana, mes: s.mes, comparacao: s.comparacao,
        compras: s.compras, analiseGastos: s.analiseGastos, observacoes: s.observacoes, despesasPrevistas: s.despesasPrevistas,
        estoqueBaixo: s.estoqueBaixo, avisos: s.avisos,
      });
      try {
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `Você é um assistente financeiro de uma loja. Responda em português usando SOMENTE os fatos JSON a seguir; se a pergunta exigir dados ausentes, diga exatamente "${insufficient}". Nunca proponha ações automáticas, nunca invente valores nem faça julgamentos vagos (errado, ruim, administrando mal). Se identificar algo que merece atenção, use cinco partes: O que aconteceu? Qual dado provocou o alerta? Como isso afetou o caixa? O que pode acontecer se continuar? Qual ação considerar? Diferencie fatos de riscos condicionais, e deixe a decisão com o usuário. Fatos: ${facts}. Pergunta: ${question}`,
        });
        const generated = response.text?.trim() || insufficient;
        answer = respostaConsultivaValida(generated) ? generated : insufficient;
      } catch (err) {
        req.log.warn({ err }, "financeiro-ia modelo indisponível");
        answer = insufficient;
      }
    }
    res.json({ resposta: answer ?? insufficient, atualizadoEm: s.atualizadoEm });
  } catch (err) {
    req.log.error({ err }, "financeiro-ia/perguntar");
    res.status(500).json({ error: "Não foi possível analisar os dados neste momento." });
  }
});

export default router;
