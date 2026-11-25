import { getAiWithRetries } from "@workspace/integrations-gemini-ai";

const QUALIDADES_TELA = ["Diamond", "Gold Pro", "NN", "WEFIX", "INCELL", "ORI CHINA"];
const QUALIDADES_CONHECIDAS: Record<string, string> = {
  diamonds: "Diamond",
  "diamonds s/a": "Diamond",
  skaiky: "Skaiky",
  foxcomm: "Foxcomm",
  "original china": "Original China",
};
const TEMPO_MAXIMO_LEITURA_MS = 60_000;

function ehMarcadorSemAro(texto: string): boolean {
  return /^S\s*\/\s*A$/i.test(texto.normalize("NFKC").trim());
}

function incluirMarcadorSemAro(modelo: string): string {
  return /\bS\s*\/\s*A\b/i.test(modelo) ? modelo : `${modelo} S/A`;
}

export interface NotaImportItem {
  modelo: string;
  modeloOriginal: string;
  quantidade: number;
  custo: string;
  qualidade: string;
}

export class NotaReaderError extends Error {
  constructor(
    message: string,
    readonly statusCode: 502 | 503,
    readonly diagnosticCode?: string,
    readonly providerStatus?: number,
  ) {
    super(message);
    this.name = "NotaReaderError";
  }
}

export function normalizarItensNota(parsed: unknown): NotaImportItem[] {
  const itensRaw = Array.isArray(parsed) ? parsed : (parsed as { itens?: unknown } | null)?.itens;
  if (!Array.isArray(itensRaw)) {
    throw new NotaReaderError("Não encontrei itens na nota.", 502);
  }
  return itensRaw
    .map((item): NotaImportItem | null => {
      const value = (item ?? {}) as Record<string, unknown>;
      const modeloBase = String(value.modelo ?? "").trim();
      if (!modeloBase) return null;
      const quantidade = parseInt(String(value.quantidade ?? "1"), 10);
      const custo = String(value.custo ?? "").replace(",", ".").replace(/[^0-9.]/g, "");
      const qualidadeRaw = String(value.qualidade ?? "").trim();
      const marcadorSemAro = ehMarcadorSemAro(qualidadeRaw);
      const modelo = marcadorSemAro ? incluirMarcadorSemAro(modeloBase) : modeloBase;
      const modeloOriginalRaw = String(value.modeloOriginal ?? modeloBase).trim() || modeloBase;
      const modeloOriginal = marcadorSemAro ? incluirMarcadorSemAro(modeloOriginalRaw) : modeloOriginalRaw;
      const chaveQualidade = qualidadeRaw.toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
      const qualidade = marcadorSemAro
        ? ""
        :
        QUALIDADES_TELA.find((itemQuality) => itemQuality.toLowerCase() === chaveQualidade) ??
        QUALIDADES_CONHECIDAS[chaveQualidade] ??
        qualidadeRaw;
      return {
        modelo,
        modeloOriginal,
        quantidade: Number.isFinite(quantidade) && quantidade > 0 ? quantidade : 1,
        custo,
        qualidade,
      };
    })
    .filter((item): item is NotaImportItem => item !== null);
}

export async function interpretarNota(
  fileBase64: string,
  mimeType: string,
  onInvalidJson?: (raw: string) => void,
): Promise<NotaImportItem[]> {
  const prompt = [
    "Você recebe a NOTA/PEDIDO de um fornecedor de peças de celular (telas/displays, baterias etc).",
    "Extraia CADA item da nota. Para cada item devolva:",
    '- "modeloOriginal": o nome completo da peça como está escrito na nota, incluindo marcadores de variante como S/A.',
    '- "modelo": nome curto para o estoque: preserve tipo e todos os modelos compatíveis/separadores; retire qualidade, cor e texto comercial. Preserve qualquer característica que diferencie o produto, incluindo S/A e C/A, que são marcadores da peça e nunca qualidades. Não descarte cor/detalhe técnico se não puder separá-lo em outro campo. Copie marcas e modelos sem abreviar nem alterar a grafia (REDMI deve continuar REDMI; ex: "TELA REDMI 13C/POCO C65").',
    '- "quantidade": número inteiro de unidades daquele item (se não achar, use 1).',
    '- "custo": leia a coluna PREÇO UNIT. e devolva esse valor unitário em reais, só números com ponto decimal (ex: "85.00"). Não use o TOTAL da linha como custo. Se o preço unitário estiver visível, não deixe vazio; use "" apenas se estiver ilegível ou ausente.',
    `- "qualidade": copie somente a qualidade realmente indicada na nota. Use a forma padrão mais próxima quando for claramente equivalente a uma destas: ${QUALIDADES_TELA.join(", ")}. Se o fornecedor escrever outra qualidade, preserve o texto como aparece (ex.: SKAIKY, TITAN S/A, ORI S/A). S/A sozinho é marcador da peça, não é qualidade: coloque-o no modelo e use "" se não houver outra qualidade indicada.`,
    'Responda APENAS um JSON no formato: { "itens": [ { "modeloOriginal": "", "modelo": "", "quantidade": 1, "custo": "", "qualidade": "" } ] }.',
    "Não invente itens que não estão na nota. Não adicione comentários.",
  ].join("\n");

  let raw = "";
  try {
    const response = await getAiWithRetries().models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType, data: fileBase64 } },
          { text: prompt },
        ],
      }],
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
        httpOptions: {
          timeout: TEMPO_MAXIMO_LEITURA_MS,
        },
      },
    });
    raw = response.text ?? "";
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const providerStatus =
      err && typeof err === "object" && "status" in err &&
      typeof err.status === "number" && Number.isInteger(err.status) &&
      err.status >= 100 && err.status <= 599
        ? err.status
        : undefined;
    if (/timeout|timed out|deadline|abort/i.test(message)) {
      throw new NotaReaderError(
        "A leitura passou de 60 segundos. Tente novamente; se continuar, envie uma foto menor ou mais próxima da nota.",
        503,
        "timeout",
        providerStatus,
      );
    }
    if (message.includes("AI_INTEGRATIONS_GEMINI_API_KEY")) {
      throw new NotaReaderError(
        "A leitura automática de notas não está configurada neste servidor.",
        503,
        "missing-api-key",
        providerStatus,
      );
    }
    const diagnosticCode =
      providerStatus === 429 ? "rate-limited" :
      providerStatus === 401 || providerStatus === 403 ? "auth-or-permission" :
      providerStatus !== undefined && providerStatus >= 500 ? "provider-unavailable" :
      providerStatus !== undefined ? "provider-request-failed" :
      "network-or-client-error";
    throw new NotaReaderError(
      "O leitor de notas ficou indisponível por alguns instantes. Tente novamente.",
      503,
      diagnosticCode,
      providerStatus,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    onInvalidJson?.(raw);
    throw new NotaReaderError("Não consegui ler a nota. Tente uma foto mais nítida.", 502);
  }

  return normalizarItensNota(parsed);
}
