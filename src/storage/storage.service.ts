import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';

type StorageDriver = 'local' | 's3';

// Stores private files in an S3-compatible bucket (RustFS, MinIO, AWS) or on local disk for development.
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: StorageDriver;
  private readonly localRoot: string;
  private readonly bucket: string;
  private client?: S3Client;
  private signer?: S3Client;

  constructor() {
    this.driver = process.env.STORAGE_DRIVER === 's3' ? 's3' : 'local';
    this.localRoot = path.resolve(process.env.STORAGE_LOCAL_DIR || './uploads');
    this.bucket = process.env.S3_BUCKET ?? '';

    if (this.driver === 's3') {
      const endpoint = process.env.S3_ENDPOINT;
      const accessKeyId = process.env.S3_ACCESS_KEY_ID;
      const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
      if (!this.bucket || !endpoint || !accessKeyId || !secretAccessKey) {
        throw new Error(
          'STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.',
        );
      }
      const base: S3ClientConfig = {
        region: process.env.S3_REGION || 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
        // Third-party S3 servers do not always support the SDK's default checksums.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      };
      this.client = new S3Client({ ...base, endpoint });
      // Signed links embed the host, so they use the address clients can actually reach.
      this.signer = new S3Client({
        ...base,
        endpoint: process.env.S3_PUBLIC_ENDPOINT || endpoint,
      });
    }
  }

  // Checks the configured storage on startup and logs a clear message instead of failing later.
  async onModuleInit() {
    if (this.driver === 's3') {
      try {
        await this.s3().send(new HeadBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Using S3 bucket "${this.bucket}"`);
      } catch (error) {
        this.logger.error(
          `Cannot reach S3 bucket "${this.bucket}": ${(error as Error).message}`,
        );
      }
      return;
    }
    await fs.mkdir(this.localRoot, { recursive: true });
    this.logger.log(`Using local file storage at ${this.localRoot}`);
  }

  // Saves a file under the given key.
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.driver === 's3') {
      await this.s3().send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
      return;
    }
    const target = this.localPath(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
  }

  // Reads a stored file fully into memory (uploads are capped at 5 MiB).
  async get(key: string): Promise<Buffer> {
    try {
      if (this.driver === 's3') {
        const response = await this.s3().send(
          new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        );
        if (!response.Body) {
          throw new NotFoundException('Stored file not found.');
        }
        return Buffer.from(await response.Body.transformToByteArray());
      }
      return await fs.readFile(this.localPath(key));
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      if (this.isMissing(error)) {
        throw new NotFoundException('Stored file not found.');
      }
      throw error;
    }
  }

  // Removes a stored file; deleting a missing key is not an error.
  async delete(key: string): Promise<void> {
    if (this.driver === 's3') {
      await this.s3().send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return;
    }
    await fs.rm(this.localPath(key), { force: true });
  }

  // Returns a short-lived link for displaying a file (S3 driver only); null for local storage.
  async getDownloadUrl(key: string, ttlSeconds = 600): Promise<string | null> {
    if (this.driver !== 's3' || !this.signer) return null;
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
  }

  private s3(): S3Client {
    if (!this.client) throw new Error('S3 storage is not configured.');
    return this.client;
  }

  // Resolves a key inside the local storage folder and blocks path traversal.
  private localPath(key: string): string {
    const full = path.resolve(this.localRoot, key);
    if (!full.startsWith(this.localRoot + path.sep)) {
      throw new Error('Invalid storage key.');
    }
    return full;
  }

  private isMissing(error: unknown): boolean {
    const e = error as {
      name?: string;
      code?: string;
      $metadata?: { httpStatusCode?: number };
    };
    return (
      e?.name === 'NoSuchKey' ||
      e?.code === 'ENOENT' ||
      e?.$metadata?.httpStatusCode === 404
    );
  }
}
