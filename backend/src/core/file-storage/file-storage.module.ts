import { Module } from '@nestjs/common';
import { FileStorageService } from './file-storage.service';
import { FileDownloadController } from './file-download.controller';

@Module({
  controllers: [FileDownloadController],
  providers: [FileStorageService],
  exports: [FileStorageService],
})
export class FileStorageModule {}
