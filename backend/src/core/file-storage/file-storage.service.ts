import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IFileStorageProvider, FileMetadata } from './file-storage.interface';
import { PostgresFileStorageProvider } from './providers/postgres.provider';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FileStorageService {
  private readonly provider: IFileStorageProvider;
  private readonly maxSizeBytes: number;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const providerType = this.config.get<string>('FILE_STORAGE_PROVIDER', 'postgres');
    if (providerType === 'postgres') {
      this.provider = new PostgresFileStorageProvider(this.prisma);
    } else if (providerType === 's3') {
      throw new Error('S3 provider not yet implemented');
    } else {
      this.provider = new PostgresFileStorageProvider(this.prisma);
    }
    const maxMb = parseInt(this.config.get<string>('MAX_FILE_SIZE_MB', '10'), 10);
    this.maxSizeBytes = maxMb * 1024 * 1024;
  }

  async upload(file: Buffer, metadata: FileMetadata, schemaName: string): Promise<{ id: string; url: string }> {
    if (file.length > this.maxSizeBytes) {
      const maxMb = this.config.get<string>('MAX_FILE_SIZE_MB', '10');
      throw new BadRequestException(`File exceeds maximum size of ${maxMb}MB`);
    }
    return this.provider.upload(file, metadata, schemaName);
  }

  async download(id: string, schemaName: string): Promise<{ data: Buffer; metadata: FileMetadata }> {
    return this.provider.download(id, schemaName);
  }

  async delete(id: string, schemaName: string): Promise<void> {
    return this.provider.delete(id, schemaName);
  }

  async getUrl(id: string): Promise<string> {
    return this.provider.getUrl(id);
  }
}
