import {
  Controller,
  Get,
  Param,
  UseGuards,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { FileStorageService } from './file-storage.service';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { TenantContext } from '../../common/decorators/tenant.decorator';
import * as Tenant from '../../tenant/tenant.interface';
import { ParseUUIDPipe } from '@nestjs/common/pipes';

@ApiTags('Files')
@Controller('files')
@UseGuards(TenantAuthGuard)
@ApiBearerAuth()
export class FileDownloadController {
  constructor(private readonly fileStorage: FileStorageService) {}

  @Get('download/:id')
  @ApiOperation({ summary: 'Download file by ID' })
  @ApiResponse({ status: 200, description: 'File binary data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async download(
    @TenantContext() tenant: Tenant.TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    try {
      const { data, metadata } = await this.fileStorage.download(id, tenant.schemaName);
      const isImage = metadata.mimeType?.startsWith('image/') ?? false;
      const disposition = isImage
        ? `inline; filename="${metadata.originalName}"`
        : `attachment; filename="${metadata.originalName}"`;

      return new StreamableFile(data, {
        type: metadata.mimeType,
        disposition,
        length: metadata.fileSize,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'File not found') {
        throw new NotFoundException('File not found');
      }
      throw err;
    }
  }
}
