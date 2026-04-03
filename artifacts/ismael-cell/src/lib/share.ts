import html2canvas from "html2canvas";
import { Order } from "@workspace/api-client-react";

export async function shareOrderAsImage(order: Order, containerEl: HTMLElement): Promise<void> {
  const canvas = await html2canvas(containerEl, {
    backgroundColor: "#f0f2f5",
    scale: 2,
    useCORS: true,
    logging: false,
  });

  const imgDataUrl = canvas.toDataURL("image/png");

  // Download the image first
  const link = document.createElement("a");
  link.href = imgDataUrl;
  link.download = `ismael-cell-${order.codigo}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Then open WhatsApp after a short delay so the download triggers first
  const statusUrl = `https://${window.location.host}/status/${order.codigo}`;
  const text = `*Ismael Cell* - Ordem de Serviço\n📱 ${order.modelo}\n🔧 ${order.servico}\n💰 R$ ${order.valor}\n\nAcompanhe o status: ${statusUrl}`;
  const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;

  setTimeout(() => {
    window.open(waUrl, "_blank");
  }, 500);
}
