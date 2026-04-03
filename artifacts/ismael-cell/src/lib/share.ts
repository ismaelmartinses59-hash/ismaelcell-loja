import html2canvas from "html2canvas";
import { Order } from "@workspace/api-client-react";

export async function shareOrderAsImage(
  order: Order,
  containerEl: HTMLElement,
  statusUrl: string
): Promise<void> {
  const canvas = await html2canvas(containerEl, {
    backgroundColor: "#f0f2f5",
    scale: 2,
    useCORS: true,
    logging: false,
  });

  const imgDataUrl = canvas.toDataURL("image/png");

  // Download the image (which already contains the status link inside it)
  const link = document.createElement("a");
  link.href = imgDataUrl;
  link.download = `ismael-cell-${order.codigo}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Open WhatsApp with a short message containing the status link
  const text =
    `📱 *ISMAEL CELL* — Ordem de Serviço\n` +
    `Aparelho: ${order.modelo}\n` +
    `Serviço: ${order.servico}\n` +
    `Valor: R$ ${order.valor}\n\n` +
    `🔗 Acompanhe sua ordem:\n${statusUrl}`;

  const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;

  setTimeout(() => {
    window.open(waUrl, "_blank");
  }, 600);
}
