import { ai } from "@workspace/integrations-gemini-ai";

const QUALIDADES_TELA = ["Diamond", "Gold Pro", "NN", "WEFIX", "INCELL", "ORI CHINA"];

export interface NotaImportItem {
  modelo: string;
  quantidade: number;
  custo: string;
  qualidade: string;
}

export class NotaReaderError extends Error {
  constructor(
    message: string,
    readonly statusCode: 502 | 503,
  ) {
    super(message);
    this.name = "NotaReaderError";
  }
}

export async function interpretarNota(
  fileBase64: string,
  mimeType: string,
  onInvalidJson?: (raw: string) => void,
): Promise<NotaImportItem[]> {
  const prompt = [
    "Você recebe a NOTA/PEDIDO de um fornecedor de peças de celular (telas/displays, baterias etc).",
    "Extraia CADA item da nota. Para cada item devolva:",
    '- "modelo": o nome COMPLETO da peça como está escrito. Preserve todos os aparelhos compatíveis e os separadores (ex: "TELA REALME C63/C61/NARZO N63/NOTE 60/NOTE 60X"). Não reduza uma lista de compatibilidade a um único modelo.',
    '- "quantidade": número inteiro de unidades daquele item (se não achar, use 1).',
    '- "custo": o valor UNITÁRIO em reais que aparece na nota, só números com ponto decimal (ex: "85.00"). Se não houver, use "".',
    `- "qualidade": SE a nota indicar a qualidade da tela, escolha a mais próxima desta lista: ${QUALIDADES_TELA.join(", ")}. Se não indicar, use "".`,
    'Responda APENAS um JSON no formato: { "itens": [ { "modelo": "", "quantidade": 1, "custo": "", "qualidade": "" } ] }.',
    "Não invente itens que não estão na nota. Não adicione comentários.",
  ].join("\n");

  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | null = null;
  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{
          role: "user",
          parts: [
            { inlineData: { mimeType, data: fileBase64 } },
            { text: prompt },
          ],
        }],
        config: { responseMimeType: "application/json", maxOutputTokens: 8192 },
      });
      break;
    } catch (err) {
      ultimoErro = err;
      if (tentativa < 3) await new Promise((resolve) => setTimeout(resolve, tentativa * 700));
    }
  }

  if (!response) {
    const message = ultimoErro instanceof Error ? ultimoErro.message : "";
    if (message.includes("AI_INTEGRATIONS_GEMINI_API_KEY")) {
      throw new NotaReaderError("A leitura automática de notas não está configurada neste servidor.", 503);
    }
    throw new NotaReaderError("O leitor de notas ficou indisponível por alguns instantes. Tente novamente.", 503);
  }

  const raw = response.text ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    onInvalidJson?.(raw);
    throw new NotaReaderError("Não consegui ler a nota. Tente uma foto mais nítida.", 502);
  }

  const itensRaw = Array.isArray(parsed) ? parsed : (parsed as { itens?: unknown } | null)?.itens;
  if (!Array.isArray(itensRaw)) {
    throw new NotaReaderError("Não encontrei itens na nota.", 502);
  }

  return itensRaw
    .map((item): NotaImportItem | null => {
      const value = (item ?? {}) as Record<string, unknown>;
      const modelo = String(value.modelo ?? "").trim();
      if (!modelo) return null;
      const quantidade = parseInt(String(value.quantidade ?? "1"), 10);
      const custo = String(value.custo ?? "").replace(",", ".").replace(/[^0-9.]/g, "");
      const qualidadeRaw = String(value.qualidade ?? "").trim();
      const qualidade = QUALIDADES_TELA.find((itemQuality) => itemQuality.toLowerCase() === qualidadeRaw.toLowerCase()) ?? "";
      return {
        modelo,
        quantidade: Number.isFinite(quantidade) && quantidade > 0 ? quantidade : 1,
        custo,
        qualidade,
      };
    })
    .filter((item): item is NotaImportItem => item !== null);
}
