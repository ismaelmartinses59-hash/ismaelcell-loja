const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function isoBmffBrands(bytes: Uint8Array): string[] {
  if (bytes.length < 12 || String.fromCharCode(...bytes.slice(4, 8)) !== "ftyp") return [];
  const brands: string[] = [String.fromCharCode(...bytes.slice(8, 12))];
  for (let offset = 16; offset + 4 <= bytes.length; offset += 4) {
    brands.push(String.fromCharCode(...bytes.slice(offset, offset + 4)));
  }
  return brands;
}

export function detectInvoiceMimeType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, PDF_SIGNATURE)) return "application/pdf";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, PNG_SIGNATURE)) return "image/png";
  if (bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return "image/gif";

  const brands = isoBmffBrands(bytes);
  if (brands.some((brand) => ["heic", "heix", "hevc", "hevx"].includes(brand))) return "image/heic";
  if (brands.some((brand) => ["avif", "avis"].includes(brand))) return "image/avif";
  if (brands.some((brand) => ["mif1", "msf1"].includes(brand))) return "image/heif";
  return null;
}
