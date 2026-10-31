import fs from "node:fs/promises";
import path from "node:path";
import { env } from "./env";
import { encrypt, decrypt } from "./crypto";

/**
 * Object storage. Bytes are AES-256-GCM encrypted by the app before they leave the process,
 * so documents are encrypted at rest on any backend (local disk, S3, R2, MinIO, B2).
 * S3 uploads additionally request SSE so the provider encrypts too.
 */
interface Driver {
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

class LocalDriver implements Driver {
  constructor(private root: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root))) throw new Error("Invalid storage key");
    return p;
  }
  async put(key: string, body: Buffer) {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body, { flag: "wx" }); // never overwrite an original
  }
  async get(key: string) {
    return fs.readFile(this.resolve(key));
  }
}

class S3Driver implements Driver {
  private clientP = (async () => {
    const { S3Client } = await import("@aws-sdk/client-s3");
    const e = env();
    return new S3Client({
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT || undefined,
      forcePathStyle: e.S3_FORCE_PATH_STYLE === "true",
      credentials:
        e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  })();
  private bucket = env().S3_BUCKET!;
  async put(key: string, body: Buffer) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.clientP).send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: "application/octet-stream",
        ServerSideEncryption: "AES256",
        IfNoneMatch: "*",
      }),
    );
  }
  async get(key: string) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const res = await (await this.clientP).send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
}

let driver: Driver | null = null;
function getDriver(): Driver {
  if (!driver) {
    const e = env();
    if (e.STORAGE_DRIVER === "s3") {
      if (!e.S3_BUCKET) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
      driver = new S3Driver();
    } else {
      driver = new LocalDriver(e.STORAGE_LOCAL_DIR);
    }
  }
  return driver;
}

export async function putObject(key: string, plain: Buffer) {
  await getDriver().put(key, encrypt(plain));
}

export async function getObject(key: string): Promise<Buffer> {
  return decrypt(await getDriver().get(key));
}
