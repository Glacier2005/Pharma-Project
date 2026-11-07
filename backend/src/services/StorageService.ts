import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';

export interface StorageProvider {
  uploadFile(buffer: Buffer, originalFilename: string): Promise<string>;
  getFileStream(storageKey: string): Promise<NodeJS.ReadableStream>;
  deleteFile(storageKey: string): Promise<void>;
}

export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;

  constructor() {
    this.baseDir = path.join(process.env.STORAGE_ROOT || path.join(process.cwd(), 'storage'), 'prescriptions');
    // Ensure directory exists
    fs.mkdir(this.baseDir, { recursive: true }).catch(console.error);
  }

  async uploadFile(buffer: Buffer, originalFilename: string): Promise<string> {
    const ext = path.extname(originalFilename);
    const key = `prescriptions/${randomUUID()}${ext}`;
    const fullPath = path.join(process.env.STORAGE_ROOT || path.join(process.cwd(), 'storage'), key);
    
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    return key;
  }

  async getFileStream(storageKey: string): Promise<NodeJS.ReadableStream> {
    const fullPath = path.join(process.env.STORAGE_ROOT || path.join(process.cwd(), 'storage'), storageKey);
    
    // Check if file exists and access is permitted
    await fs.access(fullPath, fs.constants.R_OK);
    
    const { createReadStream } = await import('fs');
    return createReadStream(fullPath);
  }

  async deleteFile(storageKey: string): Promise<void> {
    const fullPath = path.join(process.env.STORAGE_ROOT || path.join(process.cwd(), 'storage'), storageKey);
    try {
      await fs.unlink(fullPath);
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
}

export class S3StorageProvider implements StorageProvider {
  private client: import('@aws-sdk/client-s3').S3Client;
  private bucket: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET || '';
    if (!this.bucket) throw new Error('S3_BUCKET is required for S3 storage');

    const { S3Client } = require('@aws-sdk/client-s3');

    this.client = new S3Client({
      region: process.env.S3_REGION || 'us-east-1',
      endpoint: process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      },
      forcePathStyle: !!process.env.S3_ENDPOINT,
    });
  }

  async uploadFile(buffer: Buffer, originalFilename: string): Promise<string> {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const ext = path.extname(originalFilename);
    const key = `prescriptions/${randomUUID()}${ext}`;
    
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
    }));
    
    return key;
  }

  async getFileStream(storageKey: string): Promise<NodeJS.ReadableStream> {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    }));
    return (response as any).Body as NodeJS.ReadableStream;
  }

  async deleteFile(storageKey: string): Promise<void> {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    }));
  }

  async getSignedUrl(storageKey: string): Promise<string> {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });
    return getSignedUrl(this.client, command, { expiresIn: 300 });
  }
}

export class StorageService {
  private static instance: StorageProvider;

  static getProvider(): StorageProvider {
    if (!this.instance) {
      if (process.env.STORAGE_PROVIDER === 's3') {
        this.instance = new S3StorageProvider();
      } else {
        this.instance = new LocalStorageProvider();
      }
    }
    return this.instance;
  }
}
