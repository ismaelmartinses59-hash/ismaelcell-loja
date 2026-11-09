import assert from "node:assert/strict";
import test from "node:test";
import { detectInvoiceMimeType } from "./invoice-file-type.js";

test("detects supported invoice document signatures", () => {
  assert.equal(detectInvoiceMimeType(Buffer.from("%PDF-1.7", "ascii")), "application/pdf");
  assert.equal(detectInvoiceMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(
    detectInvoiceMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "image/png",
  );
  assert.equal(detectInvoiceMimeType(Buffer.from("RIFF0000WEBP", "ascii")), "image/webp");
  assert.equal(detectInvoiceMimeType(Buffer.from("GIF89a", "ascii")), "image/gif");
});

test("detects HEIC, HEIF, and AVIF ISO-BMFF brands", () => {
  const withBrand = (brand: string) => {
    const bytes = Buffer.alloc(24);
    bytes.write("ftyp", 4, "ascii");
    bytes.write(brand, 8, "ascii");
    return bytes;
  };

  assert.equal(detectInvoiceMimeType(withBrand("heic")), "image/heic");
  assert.equal(detectInvoiceMimeType(withBrand("mif1")), "image/heif");
  assert.equal(detectInvoiceMimeType(withBrand("avif")), "image/avif");
});

test("rejects unknown file signatures", () => {
  assert.equal(detectInvoiceMimeType(Buffer.from("not an invoice", "ascii")), null);
});
