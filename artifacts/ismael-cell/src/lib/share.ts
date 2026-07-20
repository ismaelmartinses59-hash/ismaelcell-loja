import html2canvas from "html2canvas";
import { Order } from "@workspace/api-client-react";

export async function shareOrderAsImage(
  order: Order,
  containerEl: HTMLElement,
  statusUrl: string
): Promise<void> {
  const text =
    `📱 *ISMAEL CELL* — Ordem de Serviço\n` +
    `Aparelho: ${order.modelo}\n` +
    `Serviço: ${order.servico}\n` +
    `Valor: R$ ${order.valor}\n\n` +
    `🔗 Acompanhe sua ordem:\n${statusUrl}`;

  // Generate the image
  const canvas = await html2canvas(containerEl, {
    backgroundColor: "#f0f2f5",
    scale: 2,
    useCORS: true,
    logging: false,
  });

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png")
  );

  const file = new File([blob], `ismael-cell-${order.codigo}.png`, { type: "image/png" });

  // Use native share sheet if available (iOS/Android) — sends photo + text to WhatsApp at once
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({
      files: [file],
      text,
    });
    return;
  }

  // Fallback for desktop: download image + open WhatsApp with text
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);

  const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(waUrl, "_blank");
}
