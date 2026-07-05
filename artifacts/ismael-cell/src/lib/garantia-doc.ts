import cartaoUrl from "@/assets/cartao-garantia.jpg";
  import type { Order } from "@workspace/api-client-react";

  const DIAS: Record<string, number> = {
    "7 dias": 7,
    "30 dias": 30,
    "90 dias": 90,
    "6 meses": 180,
    "1 ano": 365,
  };

  function garantiaDias(g: string | null | undefined): number | null {
    if (!g) return null;
    return DIAS[g] ?? null;
  }

  function dataBase(order: Order): Date {
    if (order.dataServico) {
      const [y, m, d] = order.dataServico.split("-").map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date(order.createdAt);
  }

  function fmtData(d: Date): string {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${d.getFullYear()}`;
  }

  function expiry(order: Order): Date | null {
    const dias = garantiaDias(order.garantia);
    if (!dias) return null;
    const e = new Date(dataBase(order));
    e.setDate(e.getDate() + dias);
    return e;
  }

  function dataServicoStr(order: Order): string {
    if (order.dataServico) {
      const [y, m, d] = order.dataServico.split("-");
      return `${d}/${m}/${y}`;
    }
    return fmtData(new Date(order.createdAt));
  }

  // Carrega a arte oficial (uma vez).
  let _tpl: HTMLImageElement | null = null;
  async function loadTemplate(): Promise<HTMLImageElement> {
    if (_tpl && _tpl.complete && _tpl.naturalWidth > 0) return _tpl;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = cartaoUrl;
    await img.decode();
    _tpl = img;
    return img;
  }

  // Posição vertical (centro) de cada campo na arte 1536x1024.
  const FIELD_X = 178;
  const FIELD_MAX_W = 380;

  function drawField(ctx: CanvasRenderingContext2D, text: string, cy: number): void {
    const value = text && text.trim() ? text.trim() : "—";
    let size = 30;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${size}px Arial, Helvetica, sans-serif`;
    while (ctx.measureText(value).width > FIELD_MAX_W && size > 18) {
      size -= 1;
      ctx.font = `600 ${size}px Arial, Helvetica, sans-serif`;
    }
    ctx.fillText(value, FIELD_X, cy);
  }

  async function renderCanvas(order: Order): Promise<HTMLCanvasElement> {
    const img = await loadTemplate();
    const W = img.naturalWidth || 1536;
    const H = img.naturalHeight || 1024;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas não suportado");
    ctx.drawImage(img, 0, 0, W, H);

    const exp = expiry(order);
    const periodo = order.garantia && order.garantia !== "Sem garantia" ? order.garantia : "—";

    drawField(ctx, order.nomeCliente ?? "—", 348); // CLIENTE
    drawField(ctx, order.modelo, 447); // APARELHO
    drawField(ctx, order.servico, 544); // SERVIÇO REALIZADO
    drawField(ctx, order.codigo, 640); // ORDEM DE SERVIÇO (OS)
    drawField(ctx, dataServicoStr(order), 736); // DATA DO SERVIÇO
    drawField(ctx, periodo, 829); // GARANTIA
    drawField(ctx, exp ? fmtData(exp) : "—", 927); // VÁLIDA ATÉ

    return canvas;
  }

  function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/jpeg",
        0.92,
      ),
    );
  }

  function mensagem(order: Order): string {
    const exp = expiry(order);
    return (
      `🛡️ *GARANTIA — Ismael Cell*\n` +
      `OS: ${order.codigo}\n` +
      (order.nomeCliente ? `Cliente: ${order.nomeCliente}\n` : "") +
      `Aparelho: ${order.modelo}\n` +
      `Serviço: ${order.servico}\n` +
      `Garantia: ${order.garantia ?? "—"}\n` +
      (exp ? `Válida até: ${fmtData(exp)}\n` : "") +
      `\nNão cobre queda, líquidos, mau uso ou violação do aparelho.`
    );
  }

  // Envia o cartão de garantia como imagem pelo WhatsApp (share nativo no celular;
  // no desktop baixa a imagem e abre o WhatsApp com o texto).
  export async function sendGarantiaWhatsApp(order: Order): Promise<void> {
    const canvas = await renderCanvas(order);
    const blob = await canvasToBlob(canvas);
    const file = new File([blob], `garantia-${order.codigo}.jpg`, { type: "image/jpeg" });
    const text = mensagem(order);

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

  // Abre o cartão de garantia pronto para imprimir.
  export async function printGarantia(order: Order): Promise<void> {
    const canvas = await renderCanvas(order);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>Garantia ${order.codigo} — Ismael Cell</title>
    <style>
      @page { size: landscape; margin: 8mm; }
      *{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      body{ margin:0; background:#0f172a; display:flex; flex-direction:column; align-items:center; font-family:Arial,sans-serif; }
      .bar{ padding:14px; }
      .bar button{ background:#1a2236; color:#fff; border:none; padding:10px 24px; border-radius:22px; font-size:14px; font-weight:700; cursor:pointer; }
      img{ width:100%; max-width:1100px; height:auto; display:block; }
      @media print{ .bar{ display:none; } body{ background:#fff; } img{ max-width:100%; } }
    </style></head><body>
    <div class="bar"><button onclick="window.print()">Imprimir</button></div>
    <img src="${dataUrl}" onload="setTimeout(function(){window.print();},300)"/>
    </body></html>`;
    const win = window.open("", "_blank", "width=980,height=720");
    if (!win) {
      const blob = new Blob([html], { type: "text/html" });
      window.open(URL.createObjectURL(blob), "_blank");
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }
  