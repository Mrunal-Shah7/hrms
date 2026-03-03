import { Injectable } from '@nestjs/common';
import type { IFileStorageProvider, FileMetadata } from '../file-storage.interface';
import type { PrismaClient } from '@prisma/client';

@Injectable()
export class PostgresFileStorageProvider implements IFileStorageProvider {
  constructor(
    private readonly prisma: {
      withTenantSchema: <T>(schema: string, cb: (tx: PrismaClient) => Promise<T>) => Promise<T>;
    },
  ) {}

  async upload(file: Buffer, metadata: FileMetadata, schemaName: string): Promise<{ id: string; url: string }> {
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO file_storage (id, file_name, original_name, mime_type, file_size, data, uploaded_by, context, context_id, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW())
         RETURNING id`,
        metadata.fileName,
        metadata.originalName,
        metadata.mimeType,
        metadata.fileSize,
        file,
        metadata.uploadedBy,
        metadata.context ?? null,
        metadata.contextId ?? null,
      );
    });
    const id = rows[0].id;
    const url = `/api/files/download/${id}`;
    return { id, url };
  }

  async download(id: string, schemaName: string): Promise<{ data: Buffer; metadata: FileMetadata }> {
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{
          data: Buffer;
          file_name: string;
          original_name: string;
          mime_type: string;
          file_size: number;
          uploaded_by: string;
          context: string | null;
          context_id: string | null;
        }>
      >(
        `SELECT data, file_name, original_name, mime_type, file_size, uploaded_by, context, context_id
         FROM file_storage WHERE id = $1`,
        id,
      );
    });
    if (rows.length === 0) throw new Error('File not found');
    const r = rows[0];
    return {
      data: r.data,
      metadata: {
        fileName: r.file_name,
        originalName: r.original_name,
        mimeType: r.mime_type,
        fileSize: Number(r.file_size),
        uploadedBy: r.uploaded_by,
        context: r.context ?? undefined,
        contextId: r.context_id ?? undefined,
      },
    };
  }

  async delete(id: string, schemaName: string): Promise<void> {
    await this.prisma.withTenantSchema(schemaName, async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM file_storage WHERE id = $1`, id);
    });
  }

  async getUrl(id: string): Promise<string> {
    return `/api/files/download/${id}`;
  }
}
