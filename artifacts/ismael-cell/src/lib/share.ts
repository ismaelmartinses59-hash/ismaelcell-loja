import html2canvas from "html2canvas";
import { Order } from "@workspace/api-client-react";

export async function shareOrderAsImage(
  order: Order,
  containerEl: HTMLElement,
  statusUrl: string
): Promise<void> {
  // Build WhatsApp text with the clickable link
  const text =
    `📱 *ISMAEL CELL* — Ordem de Serviço\n` +
    `Aparelho: ${order.modelo}\n` +
    `Serviço: ${order.servico}\n` +
    `Valor: R$ ${order.valor}\n\n` +
    `🔗 Acompanhe sua ordem:\n${statusUrl}`;

  const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;

  // Open WhatsApp FIRST (must be synchronous/before any await to avoid popup blocker)
  const waWindow = window.open(waUrl, "_blank");

  // Now capture the image and download it
  try {
    const canvas = await html2canvas(containerEl, {
      backgroundColor: "#f0f2f5",
      scale: 2,
      useCORS: true,
      logging: false,
    });

    const imgDataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = imgDataUrl;
    link.download = `ismael-cell-${order.codigo}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch {
    // If image capture fails, WhatsApp was already opened with the text link
    if (!waWindow) {
      window.open(waUrl, "_blank");
    }
  }
}
