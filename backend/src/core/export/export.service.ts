import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { parse } from 'json2csv';

export interface ColumnDef {
  key: string;
  header: string;
  width?: number;
  format?: (value: unknown) => string;
}

export interface CsvOptions {
  filename?: string;
}

export interface XlsxOptions {
  sheetName?: string;
  filename?: string;
}

export interface PdfOptions {
  title?: string;
  filename?: string;
}

@Injectable()
export class ExportService {
  async toCsv(
    data: Record<string, unknown>[],
    columns: ColumnDef[],
    _options?: CsvOptions,
  ): Promise<Buffer> {
    const formatted = data.map((row) => {
      const out: Record<string, unknown> = {};
      columns.forEach((c) => {
        const v = row[c.key];
        out[c.key] = c.format ? c.format(v) : v;
      });
      return out;
    });
    const fields = columns.map((c) => ({ label: c.header, value: c.key }));
    const csv = parse(formatted, { fields });
    const bom = '\uFEFF';
    return Buffer.from(bom + csv, 'utf-8');
  }

  async toXlsx(
    data: Record<string, unknown>[],
    columns: ColumnDef[],
    options?: XlsxOptions,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(options?.sheetName ?? 'Export', {
      headerFooter: { firstHeader: '', firstFooter: '' },
    });
    const headerRow = columns.map((c) => c.header);
    sheet.addRow(headerRow);
    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF011552' },
    };
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    columns.forEach((col, i) => {
      sheet.getColumn(i + 1).width = col.width ?? 15;
    });
    data.forEach((row) => {
      const values = columns.map((c) => {
        const v = row[c.key];
        return c.format ? c.format(v) : v;
      });
      sheet.addRow(values);
    });
    sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + columns.length)}1` };
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async toPdf(
    data: Record<string, unknown>[],
    columns: ColumnDef[],
    options?: PdfOptions,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(16).text(options?.title ?? 'Export', { align: 'center' });
      doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
      doc.moveDown();

      const colWidths = columns.map((c) => c.width ?? 80);
      const totalWidth = colWidths.reduce((a, b) => a + b, 0);
      const startX = 40;
      const rowHeight = 20;
      const headerY = doc.y;

      doc.rect(startX, headerY, totalWidth, rowHeight).fill('#011552');
      doc.fillColor('#ffffff').fontSize(10);
      let x = startX;
      columns.forEach((col, i) => {
        doc.text(col.header, x + 5, headerY + 5, { width: colWidths[i] - 10 });
        x += colWidths[i];
      });
      doc.y = headerY + rowHeight + 5;
      doc.fillColor('#000000');

      data.forEach((row) => {
        if (doc.y > 500) {
          doc.addPage({ size: 'A4', layout: 'landscape', margin: 40 });
        }
        x = startX;
        columns.forEach((col, i) => {
          const v = row[col.key];
          const text = col.format ? col.format(v) : String(v ?? '');
          doc.text(text, x + 5, doc.y + 3, { width: colWidths[i] - 10 });
          x += colWidths[i];
        });
        doc.y += rowHeight;
      });

      doc.end();
    });
  }
}
