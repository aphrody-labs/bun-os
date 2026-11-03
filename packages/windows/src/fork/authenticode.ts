// SPDX-License-Identifier: MIT
// Ported from aphrody-labs/bun src/js/internal/authenticode.ts (commit 62fcdb38ec9, MIT, Copyright Oven and contributors) to upstream Bun
// for the Bun OS bun:* modules of @aphrody/windows (src/bun-plugin.ts).

// Authenticode certificate-table reader: WIN_CERTIFICATE -> PKCS#7 SignedData (DER) -> the signer
// certificate (matched by issuer and serial number) -> subject/issuer common names and the digest
// algorithm. Pure byte parsing, no execution. Reports what the image or catalog declares; the
// cryptographic chain is not verified here.

export type Authenticode = {
  /** Subject CN (else O) of the signing certificate. */
  signer: string | null;
  /** Issuer CN of the signing certificate. */
  issuer: string | null;
  /** Digest algorithm of the signer info (`sha256`, `sha1`...). */
  digest: string | null;
  certificates: number;
};

type Tlv = { tag: number; start: number; len: number; hdr: number; end: number };

function tlv(b: Uint8Array, off: number): Tlv {
  if (off + 2 > b.byteLength) throw new Error("truncated DER");
  const tag = b[off]!;
  let len = b[off + 1]!;
  let hdr = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || off + 2 + n > b.byteLength) throw new Error("invalid DER length");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[off + 2 + i]!;
    hdr += n;
  }
  const start = off + hdr;
  if (start + len > b.byteLength) throw new Error("DER out of bounds");
  return { tag, start, len, hdr, end: start + len };
}

function kids(b: Uint8Array, t: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let off = t.start;
  while (off < t.end && out.length < 4096) {
    const c = tlv(b, off);
    out.push(c);
    off = c.end;
  }
  return out;
}

const eq = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);
const raw = (b: Uint8Array, t: Tlv) => b.subarray(t.start - t.hdr, t.end);

const OID = {
  signedData: "2a864886f70d010702",
  cn: "550403",
  o: "55040a",
};

const DIGESTS: Record<string, string> = {
  "608648016503040201": "sha256",
  "608648016503040202": "sha384",
  "608648016503040203": "sha512",
  "2b0e03021a": "sha1",
  "2a864886f70d0205": "md5",
};

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

function nameAttr(b: Uint8Array, name: Tlv, oid: string): string | null {
  for (const rdn of kids(b, name)) {
    for (const atv of kids(b, rdn)) {
      const [type, value] = kids(b, atv);
      if (!type || !value || hex(b.subarray(type.start, type.end)) !== oid) continue;
      const bytes = b.subarray(value.start, value.end);
      // BMPString (0x1e) is UTF-16BE; the others are ASCII/UTF-8 compatible.
      if (value.tag === 0x1e) return Buffer.from(bytes).swap16().toString("utf16le");
      return new TextDecoder().decode(bytes);
    }
  }
  return null;
}

/** Parses the certificate table bytes (one or more WIN_CERTIFICATE structures; the first PKCS#7 one is used). */
function parseAuthenticode(table: Uint8Array): Authenticode | null {
  const v = new DataView(table.buffer, table.byteOffset, table.byteLength);
  if (table.byteLength < 8) return null;
  const length = v.getUint32(0, true);
  const type = v.getUint16(6, true);
  if (type !== 2 || length < 8 || length > table.byteLength) return null;
  return parseSignedData(table.subarray(8, length));
}

/**
 * Signer of a DER PKCS#7 ContentInfo (SignedData): an Authenticode blob or a whole security catalog (`.cat`).
 * The chain is not verified; this reads the declared signer certificate only.
 */
function parseSignedData(b: Uint8Array): Authenticode | null {
  if (b.byteLength < 4) return null;
  const contentInfo = tlv(b, 0);
  const [oid, explicit] = kids(b, contentInfo);
  if (!oid || hex(b.subarray(oid.start, oid.end)) !== OID.signedData || !explicit) return null;
  const signedData = kids(b, explicit)[0];
  if (!signedData) return null;
  const parts = kids(b, signedData);
  const certSet = parts.find(p => p.tag === 0xa0);
  const signerInfos = parts.at(-1);
  const certs = certSet ? kids(b, certSet).filter(c => c.tag === 0x30) : [];
  let issuerRaw: Uint8Array | null = null;
  let serialRaw: Uint8Array | null = null;
  let digest: string | null = null;
  const signerInfo = signerInfos && signerInfos.tag === 0x31 ? kids(b, signerInfos)[0] : undefined;
  if (signerInfo) {
    const si = kids(b, signerInfo);
    const sid = si[1];
    if (sid && sid.tag === 0x30) {
      const [iss, ser] = kids(b, sid);
      if (iss && ser) {
        issuerRaw = raw(b, iss);
        serialRaw = raw(b, ser);
      }
    }
    const alg = si[2] ? kids(b, si[2])[0] : undefined;
    if (alg) digest = DIGESTS[hex(b.subarray(alg.start, alg.end))] ?? hex(b.subarray(alg.start, alg.end));
  }
  let signer: string | null = null;
  let issuer: string | null = null;
  for (const cert of certs) {
    const tbs = kids(b, cert)[0];
    if (!tbs) continue;
    const f = kids(b, tbs);
    // tbsCertificate: [0] version (optional), serial, signature, issuer, validity, subject, ...
    const i = f[0]?.tag === 0xa0 ? 1 : 0;
    const serial = f[i];
    const iss = f[i + 2];
    const subject = f[i + 4];
    if (!serial || !iss || !subject) continue;
    const match = issuerRaw && serialRaw ? eq(raw(b, iss), issuerRaw) && eq(raw(b, serial), serialRaw) : false;
    if (match || (!issuerRaw && signer === null)) {
      signer = nameAttr(b, subject, OID.cn) ?? nameAttr(b, subject, OID.o);
      issuer = nameAttr(b, iss, OID.cn) ?? nameAttr(b, iss, OID.o);
      if (match) break;
    }
  }
  return { signer, issuer, digest, certificates: certs.length };
}

export default { parseAuthenticode, parseSignedData };
