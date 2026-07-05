import html2canvas from "html2canvas";
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

  function esc(s: string | null | undefined): string {
    return String(s ?? "").replace(
      /[&<>"]/g,
      (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }) as Record<string, string>)[c],
    );
  }

  function row(label: string, value: string): string {
    return `<div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px;">
        <span style="color:#64748b;">${label}</span>
        <span style="color:#0f172a;font-weight:600;text-align:right;">${value}</span>
      </div>`;
  }

  // HTML autocontido do comprovante de garantia (usado tanto na imagem do
  // WhatsApp quanto na impressão).
  function cardHtml(order: Order): string {
    const inicio = fmtData(dataBase(order));
    const exp = expiry(order);
    const validade = exp ? fmtData(exp) : "—";
    const periodo =
      order.garantia && order.garantia !== "Sem garantia" ? order.garantia : "—";
    const cliente = order.nomeCliente ? esc(order.nomeCliente) : "—";
    const linha = order.linha ? ` (${esc(order.linha)})` : "";
    return `
    <div style="width:380px;box-sizing:border-box;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="background:#1a2236;color:#fff;padding:20px 22px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:38px;height:38px;border-radius:10px;background:#f5c518;display:flex;align-items:center;justify-content:center;font-size:20px;">🛡️</div>
          <div>
            <div style="font-size:20px;font-weight:800;letter-spacing:.5px;line-height:1;">GARANTIA</div>
            <div style="font-size:12px;opacity:.8;margin-top:3px;">Ismael Cell — Assistência Técnica</div>
          </div>
        </div>
      </div>
      <div style="padding:18px 22px 8px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:#64748b;margin-bottom:12px;">
          <span>OS <b style="color:#0f172a;">#${esc(order.codigo)}</b></span>
          <span>Emitido: ${fmtData(new Date())}</span>
        </div>
        ${row("Cliente", cliente)}
        ${row("Aparelho", esc(order.modelo) + linha)}
        ${row("Serviço", esc(order.servico))}
      </div>
      <div style="margin:6px 22px 16px;padding:14px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:11px;color:#b45309;text-transform:uppercase;letter-spacing:.5px;font-weight:700;">Período</div>
          <div style="font-size:22px;font-weight:800;color:#0f172a;line-height:1.1;">${esc(periodo)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:11px;color:#b45309;text-transform:uppercase;letter-spacing:.5px;font-weight:700;">Válida até</div>
          <div style="font-size:16px;font-weight:700;color:#0f172a;">${validade}</div>
        </div>
      </div>
      <div style="padding:0 22px 18px;font-size:10.5px;color:#64748b;line-height:1.5;">
        <b style="color:#334155;">O que cobre:</b> defeito no serviço/peça descrito acima.<br/>
        <b style="color:#334155;">Não cobre:</b> queda, contato com líquidos, mau uso, lacre violado ou reparo por terceiros.<br/>
        <span style="color:#94a3b8;">Início da garantia: ${inicio}. Apresente este comprovante para acionar a garantia.</span>
      </div>
    </div>`;
  }

  function mensagem(order: Order): string {
    const exp = expiry(order);
    return (
      `🛡️ *GARANTIA — Ismael Cell*\n` +
      `OS: #${order.codigo}\n` +
      (order.nomeCliente ? `Cliente: ${order.nomeCliente}\n` : "") +
      `Aparelho: ${order.modelo}\n` +
      `Serviço: ${order.servico}\n` +
      `Período: ${order.garantia ?? "—"}\n` +
      (exp ? `Válida até: ${fmtData(exp)}\n` : "") +
      `\nNão cobre queda, líquidos, mau uso ou lacre violado. Guarde este comprovante.`
    );
  }

  // Envia a garantia como IMAGEM (foto) pelo WhatsApp via share nativo; no desktop
  // baixa a imagem e abre o WhatsApp com o texto.
  export async function sendGarantiaWhatsApp(order: Order): Promise<void> {
    const text = mensagem(order);
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-10000px;top:0;z-index:-1;background:#ffffff;padding:16px;";
    holder.innerHTML = cardHtml(order);
    document.body.appendChild(holder);
    try {
      const el = holder.firstElementChild as HTMLElement;
      const canvas = await html2canvas(el, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
          "image/png",
        ),
      );
      const file = new File([blob], `garantia-${order.codigo}.png`, {
        type: "image/png",
      });
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
    } finally {
      document.body.removeChild(holder);
    }
  }

  // Abre a garantia numa janela pronta pra imprimir.
  export function printGarantia(order: Order): void {
    const html = cardHtml(order);
    const full = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>Garantia ${esc(order.codigo)} — Ismael Cell</title>
    <style>
      *{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      body{ margin:0; background:#f1f5f9; display:flex; flex-direction:column; align-items:center; padding:24px; font-family:-apple-system,'Segoe UI',Roboto,sans-serif; }
      .actions{ margin-bottom:16px; }
      .actions button{ background:#1a2236; color:#fff; border:none; padding:10px 22px; border-radius:22px; font-size:14px; font-weight:700; cursor:pointer; }
      @media print{ .actions{ display:none; } body{ background:#fff; padding:0; } }
    </style></head><body>
    <div class="actions"><button onclick="window.print()">Imprimir</button></div>
    ${html}
    <script>window.onload=function(){setTimeout(function(){window.print();},350);};<\/script>
    </body></html>`;
    const win = window.open("", "_blank", "width=440,height=760");
    if (!win) {
      const blob = new Blob([full], { type: "text/html" });
      window.open(URL.createObjectURL(blob), "_blank");
      return;
    }
    win.document.open();
    win.document.write(full);
    win.document.close();
  }
  