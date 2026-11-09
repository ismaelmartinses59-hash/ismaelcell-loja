import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, like, lt } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import {
  ConsumeIosShortcutDraftBody,
  ConsumeIosShortcutDraftResponse,
  CreateIosShortcutTokenResponse,
  GetIosShortcutStatusResponse,
  ImportIosShortcutNoteBody,
  ImportIosShortcutNoteResponse,
} from "@workspace/api-zod";
import { appConfigTable, db } from "@workspace/db";
import { detectInvoiceMimeType } from "../lib/invoice-file-type.js";
import { interpretarNota, NotaReaderError } from "../lib/nota-reader.js";
import { requireFinanceSession } from "./auth.js";

const router: IRouter = Router();

const TOKEN_KEY = "ios_shortcut_upload_token_sha256_v1";
const DRAFT_PREFIX = "ios_shortcut_draft_v1:";
const DRAFT_TTL_MS = 15 * 60 * 1000;
const OLD_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

interface DraftContents {
  expiresAt: number;
  itens: Array<{ modelo: string; quantidade: number; custo: string; qualidade: string }>;
}

interface EncryptedDraft {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

function draftEncryptionKey(): Buffer {
  const sessionSecret = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD;
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET or ADMIN_PASSWORD is required to protect shortcut drafts");
  }
  return createHash("sha256").update("ios-shortcut-draft-v1:").update(sessionSecret).digest();
}

function encryptDraft(contents: DraftContents): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", draftEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(contents), "utf8"),
    cipher.final(),
  ]);
  const encrypted: EncryptedDraft = {
    version: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
  return JSON.stringify(encrypted);
}

function decryptDraft(value: string): DraftContents {
  const encrypted = JSON.parse(value) as Partial<EncryptedDraft>;
  if (encrypted.version !== 1 || !encrypted.iv || !encrypted.tag || !encrypted.ciphertext) {
    throw new Error("Invalid shortcut draft");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    draftEncryptionKey(),
    Buffer.from(encrypted.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  const contents = JSON.parse(plaintext) as Partial<DraftContents>;
  if (typeof contents.expiresAt !== "number" || !Array.isArray(contents.itens)) {
    throw new Error("Invalid shortcut draft");
  }
  return contents as DraftContents;
}

function requestOrigin(req: Request): string | null {
  const host = req.get("host");
  if (!host || !/^(?:[a-z0-9.-]+|\[[\da-f:]+\])(?::\d{1,5})?$/i.test(host)) return null;
  if (process.env.NODE_ENV === "production" && req.protocol !== "https") return null;
  return `${req.protocol}://${host}`;
}

router.get("/share-shortcut/ios/status", requireFinanceSession, async (_req, res): Promise<void> => {
  const [stored] = await db
    .select({ key: appConfigTable.key })
    .from(appConfigTable)
    .where(eq(appConfigTable.key, TOKEN_KEY))
    .limit(1);
  res.json(GetIosShortcutStatusResponse.parse({ configured: Boolean(stored) }));
});

router.post("/share-shortcut/ios/token", requireFinanceSession, async (_req, res): Promise<void> => {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db
    .insert(appConfigTable)
    .values({ key: TOKEN_KEY, value: tokenHash })
    .onConflictDoUpdate({
      target: appConfigTable.key,
      set: { value: tokenHash, updatedAt: new Date() },
    });
  res.status(201).json(CreateIosShortcutTokenResponse.parse({ token }));
});

router.delete("/share-shortcut/ios/token", requireFinanceSession, async (_req, res): Promise<void> => {
  await db.delete(appConfigTable).where(eq(appConfigTable.key, TOKEN_KEY));
  res.status(204).end();
});

router.post("/share-shortcut/ios/import", async (req, res): Promise<void> => {
  const authorization = req.get("authorization") ?? "";
  const token = /^Bearer\s+([A-Za-z0-9_-]+)$/i.exec(authorization)?.[1];
  if (!token) {
    res.status(401).json({ error: "Atalho não autorizado. Gere um novo código no Ismael Cell." });
    return;
  }
  const [stored] = await db
    .select({ value: appConfigTable.value })
    .from(appConfigTable)
    .where(eq(appConfigTable.key, TOKEN_KEY))
    .limit(1);
  const providedHash = createHash("sha256").update(token).digest();
  const savedHash = Buffer.from(stored?.value ?? "", "hex");
  if (savedHash.length !== providedHash.length || !timingSafeEqual(savedHash, providedHash)) {
    res.status(401).json({ error: "Código do Atalho inválido ou revogado." });
    return;
  }

  const body = ImportIosShortcutNoteBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Envie um PDF ou uma imagem de nota válida." });
    return;
  }
  const fileBase64 = body.data.fileBase64
    .replace(/^data:[^;]+;base64,/i, "")
    .replace(/\s/g, "");
  if (!fileBase64 || fileBase64.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(fileBase64)) {
    res.status(400).json({ error: "O conteúdo do arquivo não está em Base64 válido." });
    return;
  }
  const fileBytes = Buffer.from(fileBase64, "base64");
  if (fileBytes.length > 7.5 * 1024 * 1024) {
    res.status(413).json({ error: "Arquivo muito grande. O limite para o Atalho é cerca de 7 MB." });
    return;
  }
  const mimeType = detectInvoiceMimeType(fileBytes);
  if (!mimeType) {
    res.status(415).json({ error: "Formato não reconhecido. Envie um PDF ou uma foto JPEG, PNG, WebP, GIF ou HEIC." });
    return;
  }

  const origin = requestOrigin(req);
  if (!origin) {
    res.status(400).json({ error: "Não foi possível criar um link seguro para abrir o app." });
    return;
  }

  const leituraStartedAt = Date.now();
  try {
    const itens = await interpretarNota(fileBase64, mimeType, (raw) => {
      req.log.error({ raw }, "Atalho do iPhone: JSON inválido da IA");
    });
    req.log.info({
      durationMs: Date.now() - leituraStartedAt,
      mimeType,
      fileBytes: fileBytes.length,
      itemCount: itens.length,
    }, "Leitura da nota compartilhada concluída");
    if (itens.length === 0) {
      res.status(502).json({ error: "Não encontrei peças no PDF compartilhado." });
      return;
    }

    await db.delete(appConfigTable).where(and(
      like(appConfigTable.key, `${DRAFT_PREFIX}%`),
      lt(appConfigTable.updatedAt, new Date(Date.now() - OLD_DRAFT_TTL_MS)),
    ));

    const draftId = randomBytes(32).toString("base64url");
    const encryptedDraft = encryptDraft({ expiresAt: Date.now() + DRAFT_TTL_MS, itens });
    await db.insert(appConfigTable)
      .values({ key: `${DRAFT_PREFIX}${draftId}`, value: encryptedDraft })
      .onConflictDoNothing();

    const openUrl = new URL(`/ordens?shareImport=${encodeURIComponent(draftId)}`, origin).toString();
    res.json(ImportIosShortcutNoteResponse.parse({
      openUrl,
      itemCount: itens.length,
      expiresInMinutes: DRAFT_TTL_MS / 60_000,
    }));
  } catch (error) {
    const leituraMeta = {
      durationMs: Date.now() - leituraStartedAt,
      mimeType,
      fileBytes: fileBytes.length,
    };
    if (error instanceof NotaReaderError) {
      req.log.warn({ ...leituraMeta, err: error }, "Falha na leitura da nota compartilhada");
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    req.log.error({ ...leituraMeta, err: error }, "Falha ao preparar rascunho do Atalho");
    res.status(503).json({ error: "Não consegui preparar o rascunho. Tente novamente." });
  }
});

router.post("/share-shortcut/ios/draft", requireFinanceSession, async (req, res): Promise<void> => {
  const body = ConsumeIosShortcutDraftBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Link de importação inválido." });
    return;
  }

  const [stored] = await db.delete(appConfigTable)
    .where(eq(appConfigTable.key, `${DRAFT_PREFIX}${body.data.draftId}`))
    .returning({ value: appConfigTable.value });
  if (!stored) {
    res.status(410).json({ error: "Este rascunho já foi aberto ou expirou. Compartilhe o PDF novamente." });
    return;
  }

  try {
    const draft = decryptDraft(stored.value);
    if (draft.expiresAt <= Date.now()) {
      res.status(410).json({ error: "O rascunho expirou. Compartilhe o PDF novamente." });
      return;
    }
    res.json(ConsumeIosShortcutDraftResponse.parse({ itens: draft.itens }));
  } catch (error) {
    req.log.warn({ err: error }, "Rascunho temporário do Atalho inválido ou expirado");
    res.status(410).json({ error: "Este rascunho expirou ou não pode mais ser aberto. Compartilhe o PDF novamente." });
  }
});

export default router;
