// Desenha o "EXTRATO DE DÉBITO" pixel a pixel num canvas 2D.
// Motivo: html2canvas renderiza TORTO no Safari do iPhone (texto/ícones
// desalinhados). Desenhar direto no canvas sai idêntico em qualquer aparelho.

export interface ExtratoItem {
  id: string | number;
  modelo: string;
  qualidade?: string | null;
  valor: string;
  createdAt: string;
}

export interface ExtratoPagamento {
  id: string | number;
  valor: string;
  createdAt: string;
}

export interface ExtratoData {
  nome: string;
  saldo: number;
  itens: ExtratoItem[];
  pagamentos?: ExtratoPagamento[];
  totalItens?: number;
  totalPago?: number;
}

const FONT = "Arial, Helvetica, sans-serif";

function formatMoney(val: string) {
  const n = parseFloat(val.replace(",", "."));
  if (isNaN(n)) return val;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function rrPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, str: string, maxW: number) {
  if (ctx.measureText(str).width <= maxW) return str;
  let s = str;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}

// Desenha um ícone vetorial usando coordenadas do viewBox 0..24,
// mapeadas para um quadrado [cx-half, cx+half] centrado em (cx, cy).
function strokeIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  half: number,
  draw: (c: CanvasRenderingContext2D) => void,
) {
  const k = (half * 2) / 24;
  ctx.save();
  ctx.translate(cx - half, cy - half);
  ctx.scale(k, k);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  draw(ctx);
  ctx.restore();
}

function iconPerson(c: CanvasRenderingContext2D) {
  c.beginPath();
  c.arc(12, 8, 4, 0, 2 * Math.PI);
  c.stroke();
  c.beginPath();
  c.moveTo(4, 20);
  c.bezierCurveTo(4, 16, 8, 14, 12, 14);
  c.bezierCurveTo(16, 14, 20, 16, 20, 20);
  c.stroke();
}
function iconCalendar(c: CanvasRenderingContext2D) {
  rrPath(c, 3, 4, 18, 18, 2);
  c.stroke();
  c.beginPath();
  c.moveTo(3, 9);
  c.lineTo(21, 9);
  c.moveTo(8, 2);
  c.lineTo(8, 6);
  c.moveTo(16, 2);
  c.lineTo(16, 6);
  c.stroke();
}
function iconClipboard(c: CanvasRenderingContext2D) {
  rrPath(c, 6, 3, 12, 4, 1);
  c.stroke();
  c.beginPath();
  c.moveTo(6, 5);
  c.lineTo(4, 5);
  c.lineTo(4, 21);
  c.lineTo(20, 21);
  c.lineTo(20, 5);
  c.lineTo(18, 5);
  c.stroke();
}
function iconWallet(c: CanvasRenderingContext2D) {
  rrPath(c, 2, 6, 20, 13, 2);
  c.stroke();
  c.beginPath();
  c.moveTo(2, 10);
  c.lineTo(22, 10);
  c.stroke();
  c.beginPath();
  c.arc(16.5, 12.5, 0.7, 0, 2 * Math.PI);
  c.stroke();
}
function iconWhatsapp(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 4);
  ctx.strokeStyle = "#ffffff";
  ctx.lineCap = "round";
  const L = r * 0.62;
  ctx.lineWidth = r * 0.4;
  ctx.beginPath();
  ctx.moveTo(0, -L);
  ctx.lineTo(0, L);
  ctx.stroke();
  ctx.lineWidth = r * 0.2;
  ctx.beginPath();
  ctx.moveTo(-r * 0.2, -L);
  ctx.lineTo(r * 0.2, -L);
  ctx.moveTo(-r * 0.2, L);
  ctx.lineTo(r * 0.2, L);
  ctx.stroke();
  ctx.restore();
}

function txt(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  font: string,
  color: string,
  align: CanvasTextAlign = "left",
  baseline: CanvasTextBaseline = "top",
) {
  ctx.font = `${font} ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(s, x, y);
}

export async function generateExtratoBlob(data: ExtratoData): Promise<Blob> {
  const { nome, saldo } = data;
  const itens = [...data.itens].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const pagamentos = [...(data.pagamentos ?? [])].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const nItens = Math.max(itens.length, 1);
  const nPag = pagamentos.length;
  const hasPag = nPag > 0;
  const totalItens = data.totalItens ?? itens.reduce((s, it) => s + (parseFloat(it.valor.replace(",", ".")) || 0), 0);
  const totalPago = data.totalPago ?? pagamentos.reduce((s, p) => s + (parseFloat(p.valor.replace(",", ".")) || 0), 0);

  // ── Geometria (px lógicos) ──
  const W = 640;
  const CX = 50; // conteúdo do painel
  const CW = 540;
  const RIGHT = CX + CW; // 590

  const titleTop = 136;
  const infoTop = titleTop + 34 + 20; // 190
  const itemsBarTop = infoTop + 64 + 20; // 274
  const itemsTop = itemsBarTop + 42 + 12; // 328
  const itemsBottom = itemsTop + nItens * 66;

  const pagBarTop = itemsBottom + 16;
  const pagTop = pagBarTop + 42 + 12;
  const PAG_ROW = 48;
  const pagBottom = hasPag ? pagTop + nPag * PAG_ROW : itemsBottom;

  const divTop = pagBottom + 16;
  const totalTop = divTop + 32 + 16;
  const totalH = totalPago > 0 ? 100 : 78;
  const totalBottom = totalTop + totalH;

  const panelTop = 112;
  const panelBottom = totalBottom + 24;
  const panelH = panelBottom - panelTop;

  const footerTop = panelBottom + 18;
  const H = footerTop + 100;

  const S = 2; // nitidez (saída ~1280px de largura)
  const canvas = document.createElement("canvas");
  canvas.width = W * S;
  canvas.height = H * S;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d indisponível");
  ctx.scale(S, S);

  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* ignore */
    }
  }

  // Fundo navy
  ctx.fillStyle = "#0c2256";
  ctx.fillRect(0, 0, W, H);

  // Cabeçalho / logo
  ctx.font = `800 40px ${FONT}`;
  const a = "ISMAEL ";
  const b = "CELL";
  const wa = ctx.measureText(a).width;
  const wb = ctx.measureText(b).width;
  const logoStart = 320 - (wa + wb) / 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(a, logoStart, 48);
  ctx.fillStyle = "#2f86ff";
  ctx.fillText(b, logoStart + wa, 48);
  txt(ctx, "ASSISTÊNCIA TÉCNICA ESPECIALIZADA", 320, 70, "700 12px", "#9db8e6", "center", "top");

  // Painel branco
  rrPath(ctx, 26, panelTop, 588, panelH, 18);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  // Título
  txt(ctx, "EXTRATO DE DÉBITO", 320, titleTop + 17, "800 28px", "#0c2256", "center", "middle");

  // Caixas: Cliente + Data de emissão
  const drawInfoBox = (
    x: number,
    icon: (c: CanvasRenderingContext2D) => void,
    label: string,
    value: string,
  ) => {
    rrPath(ctx, x, infoTop, 263, 64, 10);
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#0c2256";
    ctx.beginPath();
    ctx.arc(x + 30, infoTop + 32, 18, 0, 2 * Math.PI);
    ctx.fill();
    strokeIcon(ctx, x + 30, infoTop + 32, 9, icon);
    txt(ctx, label, x + 58, infoTop + 13, "700 10px", "#64748b", "left", "top");
    ctx.font = `800 16px ${FONT}`;
    txt(ctx, fitText(ctx, value, 191), x + 58, infoTop + 31, "800 16px", "#0c2256", "left", "top");
  };
  drawInfoBox(CX, iconPerson, "CLIENTE", nome);
  drawInfoBox(327, iconCalendar, "DATA DE EMISSÃO", new Date().toLocaleDateString("pt-BR"));

  // Barra de seção (Produtos)
  rrPath(ctx, CX, itemsBarTop, CW, 42, 8);
  ctx.fillStyle = "#0c2256";
  ctx.fill();
  strokeIcon(ctx, CX + 14 + 9, itemsBarTop + 12 + 9, 9, iconClipboard);
  txt(ctx, "PRODUTOS E SERVIÇOS", CX + 42, itemsBarTop + 21, "700 16px", "#ffffff", "left", "middle");

  // Lista de itens
  rrPath(ctx, CX, itemsTop, CW, nItens * 66, 10);
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.stroke();
  itens.forEach((item, i) => {
    const top = itemsTop + i * 66;
    ctx.fillStyle = "#0c2256";
    ctx.beginPath();
    ctx.arc(CX + 14 + 20, top + 13 + 20, 20, 0, 2 * Math.PI);
    ctx.fill();
    strokeIcon(ctx, CX + 14 + 20, top + 13 + 20, 10, iconClipboard);
    const nomeItem =
      item.modelo + (item.qualidade && item.qualidade !== "Serviço" ? ` (${item.qualidade})` : "");
    ctx.font = `800 16px ${FONT}`;
    txt(ctx, fitText(ctx, nomeItem, 356), CX + 66, top + 13, "800 16px", "#0c2256", "left", "top");
    const d = new Date(item.createdAt).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    txt(ctx, d, CX + 66, top + 36, "400 12px", "#64748b", "left", "top");
    txt(ctx, "Valor", RIGHT - 16, top + 15, "600 11px", "#64748b", "right", "top");
    txt(ctx, formatMoney(item.valor), RIGHT - 16, top + 29, "800 18px", "#16a34a", "right", "top");
    if (i < itens.length - 1) {
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(CX, top + 66);
      ctx.lineTo(RIGHT, top + 66);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  // Seção PAGAMENTOS (AV)
  if (hasPag) {
    rrPath(ctx, CX, pagBarTop, CW, 42, 8);
    ctx.fillStyle = "#16a34a";
    ctx.fill();
    txt(ctx, "$", CX + 23, pagBarTop + 21, "800 18px", "#ffffff", "center", "middle");
    txt(ctx, "PAGAMENTOS (AV)", CX + 42, pagBarTop + 21, "700 16px", "#ffffff", "left", "middle");

    rrPath(ctx, CX, pagTop, CW, nPag * PAG_ROW, 10);
    ctx.fillStyle = "#f0fdf4";
    ctx.fill();
    ctx.strokeStyle = "#bbf7d0";
    ctx.lineWidth = 1;
    ctx.stroke();
    pagamentos.forEach((p, i) => {
      const top = pagTop + i * PAG_ROW;
      const cy = top + PAG_ROW / 2;
      ctx.fillStyle = "#16a34a";
      ctx.beginPath();
      ctx.arc(CX + 14 + 14, cy, 14, 0, 2 * Math.PI);
      ctx.fill();
      txt(ctx, "$", CX + 14 + 14, cy, "800 15px", "#ffffff", "center", "middle");
      const d = new Date(p.createdAt).toLocaleDateString("pt-BR");
      txt(ctx, `Pagamento em ${d}`, CX + 56, cy, "600 14px", "#166534", "left", "middle");
      txt(ctx, formatMoney(p.valor), RIGHT - 16, cy, "800 16px", "#16a34a", "right", "middle");
      if (i < nPag - 1) {
        ctx.strokeStyle = "#bbf7d0";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(CX, top + PAG_ROW);
        ctx.lineTo(RIGHT, top + PAG_ROW);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
  }

  // Divisor $
  ctx.fillStyle = "#2f86ff";
  ctx.beginPath();
  ctx.arc(320, divTop + 16, 16, 0, 2 * Math.PI);
  ctx.fill();
  txt(ctx, "$", 320, divTop + 16, "800 16px", "#ffffff", "center", "middle");

  // Total
  rrPath(ctx, CX, totalTop, CW, totalH, 12);
  ctx.fillStyle = "#eafaf1";
  ctx.fill();
  ctx.strokeStyle = "#bbf7d0";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#16a34a";
  ctx.beginPath();
  ctx.arc(CX + 18 + 23, totalTop + 16 + 23, 23, 0, 2 * Math.PI);
  ctx.fill();
  strokeIcon(ctx, CX + 18 + 23, totalTop + 16 + 23, 11, iconWallet);
  if (totalPago > 0) {
    txt(ctx, "VALOR TOTAL DO DÉBITO", 128, totalTop + 13, "700 13px", "#166534", "left", "top");
    txt(ctx, fmtBRL(saldo), 128, totalTop + 30, "800 28px", "#16a34a", "left", "top");
    txt(
      ctx,
      `Total dos itens: ${fmtBRL(totalItens)}   •   Pago (AV): ${fmtBRL(totalPago)}`,
      128,
      totalTop + 70,
      "600 12px",
      "#64748b",
      "left",
      "top",
    );
  } else {
    txt(ctx, "VALOR TOTAL DO DÉBITO", 128, totalTop + 15, "700 13px", "#166534", "left", "top");
    txt(ctx, fmtBRL(saldo), 128, totalTop + 33, "800 30px", "#16a34a", "left", "top");
  }

  // Rodapé
  ctx.font = `800 18px ${FONT}`;
  const fa = "ISMAEL ";
  const fwa = ctx.measureText(fa).width;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(fa, 30, footerTop + 17);
  ctx.fillStyle = "#2f86ff";
  ctx.fillText("CELL", 30 + fwa, footerTop + 17);
  txt(ctx, "89 98144-8787", 610, footerTop + 17, "800 18px", "#ffffff", "right", "middle");
  ctx.fillStyle = "#25d366";
  ctx.beginPath();
  ctx.arc(447, footerTop + 17, 15, 0, 2 * Math.PI);
  ctx.fill();
  iconWhatsapp(ctx, 447, footerTop + 17, 15);
  txt(
    ctx,
    "Documento gerado automaticamente pelo sistema de gestão da ISMAEL CELL.",
    320,
    footerTop + 40,
    "400 11px",
    "#9db8e6",
    "center",
    "top",
  );
  txt(ctx, "ISMAEL CELL – CONFIANÇA QUE CONECTA!", 320, footerTop + 58, "700 11px", "#2f86ff", "center", "top");

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob falhou"))), "image/png"),
  );
}
