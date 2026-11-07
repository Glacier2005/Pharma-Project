import { S3StorageProvider } from '../src/services/StorageService';

jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({
      send: jest.fn().mockResolvedValue({ Body: 'mock-stream' })
    })),
    PutObjectCommand: jest.fn(),
    GetObjectCommand: jest.fn(),
    DeleteObjectCommand: jest.fn(),
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => {
  return {
    getSignedUrl: jest.fn().mockResolvedValue('https://mock-signed-url.com')
  };
});

describe('S3StorageProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('1. Provider initializes with valid configuration', () => {
    process.env.S3_BUCKET = 'test-bucket';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_ACCESS_KEY_ID = 'key';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';

    const provider = new S3StorageProvider();
    expect(provider).toBeDefined();
  });

  it('2. Missing required configuration fails clearly', () => {
    delete process.env.S3_BUCKET;
    expect(() => new S3StorageProvider()).toThrow('S3_BUCKET is required for S3 storage');
  });

  it('3. Generated storage keys are opaque and use extension', async () => {
    process.env.S3_BUCKET = 'test-bucket';
    const provider = new S3StorageProvider();
    
    const key = await provider.uploadFile(Buffer.from('test'), 'patient-rx-123.jpg');
    
    expect(key).toMatch(/^prescriptions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/);
  });

  it('4. Original filenames are not used as storage keys', async () => {
    process.env.S3_BUCKET = 'test-bucket';
    const provider = new S3StorageProvider();
    const originalFilename = 'my_secret_health_info.pdf';
    
    const key = await provider.uploadFile(Buffer.from('test'), originalFilename);
    expect(key).not.toContain('my_secret_health_info');
    expect(key.endsWith('.pdf')).toBe(true);
  });

  it('5. Upload command is correctly constructed', async () => {
    process.env.S3_BUCKET = 'test-bucket';
    const provider = new S3StorageProvider();
    
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await provider.uploadFile(Buffer.from('test'), 'file.png');
    
    expect(PutObjectCommand).toHaveBeenCalledTimes(1);
    const args = PutObjectCommand.mock.calls[0][0];
    expect(args.Bucket).toBe('test-bucket');
    expect(args.Key).toContain('prescriptions/');
    expect(args.Body).toBeInstanceOf(Buffer);
  });

  it('6. Presigned URL generation works and 7. Expires in 5 minutes', async () => {
    process.env.S3_BUCKET = 'test-bucket';
    const provider = new S3StorageProvider();
    
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    
    const url = await provider.getSignedUrl('prescriptions/test.png');
    expect(url).toBe('https://mock-signed-url.com');
    
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
    const args = getSignedUrl.mock.calls[0];
    expect(args[1]).toBeInstanceOf(GetObjectCommand);
    expect(args[2]).toEqual({ expiresIn: 300 }); // 5 minutes
  });

  it('8. Provider does not expose credentials', () => {
    process.env.S3_BUCKET = 'test-bucket';
    process.env.S3_ACCESS_KEY_ID = 'SUPER_SECRET_KEY';
    const provider = new S3StorageProvider();
    
    // Ensure the instance doesn't have secret properties easily accessible
    expect(Object.keys(provider)).not.toContain('credentials');
    expect(JSON.stringify(provider)).not.toContain('SUPER_SECRET_KEY');
  });
});
