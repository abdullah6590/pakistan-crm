// src/lib/backup/format.ts - Encrypted backup package (Report 22 §3).
// Layout: "PKCRMBK1" | header length (uint32 BE) | header JSON | AES-256-GCM ciphertext | 16-byte auth tag.
// The key is derived from the business's backup passphrase with scrypt and a random salt per backup, so a backup
// can be restored on any computer with the passphrase. The whole header (manifest included) is authenticated:
// changing a single byte of the header or the data makes decryption fail.
import crypto from "node:crypto";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("PKCRMBK1");
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export interface BackupManifest {
  format: "PKCRMBK1";
  backupId: string;
  tenantId: string;
  tenantName: string;
  scope: string; // "server", "hub-H01", "device-D03"
  type: "DAILY" | "FREQUENT" | "MANUAL" | "PRE_RESTORE";
  createdAt: string;
  appVersion: string;
  schemaVersion: string; // latest applied migration
  migrationCount: number;
  changeSeq: number;
  plainSha256: string;
  plainBytes: number;
  counts: Record<string, number>;
  dbEncrypted: boolean; // the snapshot inside is itself encrypted with the device key (wrapped below)
}

interface Header {
  v: 1;
  kdf: { alg: "scrypt"; N: number; r: number; p: number; salt: string };
  iv: string;
  manifest: BackupManifest;
  wrappedDbKey?: { iv: string; ct: string; tag: string };
}

export class BackupFormatError extends Error {}

function deriveKey(passphrase: string, salt: Buffer, params = SCRYPT): Buffer {
  if (!passphrase || passphrase.length < 12) throw new BackupFormatError("The backup passphrase must be at least 12 characters");
  return crypto.scryptSync(passphrase.normalize("NFKC"), salt, 32, params);
}

/** Encrypt `src` into `dst`. The device database key (if any) travels wrapped with the passphrase key. */
export async function sealBackup(src: string, dst: string, passphrase: string, manifest: BackupManifest, dbKey?: string) {
  const salt = crypto.randomBytes(16);
  const key = deriveKey(passphrase, salt);
  const header: Header = { v: 1, kdf: { alg: "scrypt", N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString("base64") }, iv: crypto.randomBytes(12).toString("base64"), manifest };
  if (dbKey) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([c.update(dbKey, "utf8"), c.final()]);
    header.wrappedDbKey = { iv: iv.toString("base64"), ct: ct.toString("base64"), tag: c.getAuthTag().toString("base64") };
  }
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(headerBytes.length);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
  cipher.setAAD(Buffer.concat([MAGIC, len, headerBytes]));
  const out = fs.createWriteStream(dst, { flags: "wx" });
  out.write(Buffer.concat([MAGIC, len, headerBytes]));
  await pipeline(fs.createReadStream(src), cipher, out, { end: false });
  await new Promise<void>((resolve, reject) => out.end(cipher.getAuthTag(), (e?: Error | null) => (e ? reject(e) : resolve())));
  const fd = fs.openSync(dst, "r+");
  fs.fsyncSync(fd); // the package is on disk before it is reported as written
  fs.closeSync(fd);
}

/** Read the manifest without the passphrase (it is authenticated when the backup is opened). */
export function readManifest(file: string): BackupManifest {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(12);
    fs.readSync(fd, head, 0, 12, 0);
    if (!head.subarray(0, 8).equals(MAGIC)) throw new BackupFormatError("Not a Pakistan CRM backup");
    const len = head.readUInt32BE(8);
    if (len > 1_000_000) throw new BackupFormatError("Corrupt backup header");
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 12);
    return (JSON.parse(buf.toString("utf8")) as Header).manifest;
  } finally {
    fs.closeSync(fd);
  }
}

/** Decrypt `file` into `dst`; returns the manifest and the unwrapped device database key (if any). */
export async function openBackup(file: string, dst: string, passphrase: string): Promise<{ manifest: BackupManifest; dbKey?: string }> {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, "r");
  let header: Header;
  let prefix: Buffer;
  let tag: Buffer;
  try {
    const head = Buffer.alloc(12);
    fs.readSync(fd, head, 0, 12, 0);
    if (!head.subarray(0, 8).equals(MAGIC)) throw new BackupFormatError("Not a Pakistan CRM backup");
    const len = head.readUInt32BE(8);
    const hb = Buffer.alloc(len);
    fs.readSync(fd, hb, 0, len, 12);
    header = JSON.parse(hb.toString("utf8"));
    prefix = Buffer.concat([head, hb]);
    tag = Buffer.alloc(16);
    fs.readSync(fd, tag, 0, 16, size - 16);
  } finally {
    fs.closeSync(fd);
  }
  const key = deriveKey(passphrase, Buffer.from(header.kdf.salt, "base64"), { N: header.kdf.N, r: header.kdf.r, p: header.kdf.p, maxmem: SCRYPT.maxmem });
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
  decipher.setAAD(prefix);
  decipher.setAuthTag(tag);
  try {
    await pipeline(fs.createReadStream(file, { start: prefix.length, end: size - 17 }), decipher, fs.createWriteStream(dst));
  } catch {
    fs.rmSync(dst, { force: true });
    throw new BackupFormatError("Wrong passphrase, or the backup has been altered or damaged");
  }
  let dbKey: string | undefined;
  if (header.wrappedDbKey) {
    const w = header.wrappedDbKey;
    const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(w.iv, "base64"));
    d.setAuthTag(Buffer.from(w.tag, "base64"));
    dbKey = Buffer.concat([d.update(Buffer.from(w.ct, "base64")), d.final()]).toString("utf8");
  }
  return { manifest: header.manifest, dbKey };
}

export async function sha256File(file: string): Promise<string> {
  const h = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), h);
  return h.digest("hex");
}
