export interface FileMetadata {
  fileName: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: string;
  context?: string;
  contextId?: string;
}

export interface IFileStorageProvider {
  upload(file: Buffer, metadata: FileMetadata, schemaName: string): Promise<{ id: string; url: string }>;
  download(id: string, schemaName: string): Promise<{ data: Buffer; metadata: FileMetadata }>;
  delete(id: string, schemaName: string): Promise<void>;
  getUrl(id: string): Promise<string>;
}
