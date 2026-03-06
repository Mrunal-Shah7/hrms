'use client';

import { useState } from 'react';
import { getBalanceImportTemplateUrl, importLeaveBalances } from '../../../services/leave-balances';

interface BalanceImportDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type Step = 1 | 2 | 3;

export function BalanceImportDialog({ open, onClose, onSuccess }: BalanceImportDialogProps) {
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [dryRunResult, setDryRunResult] = useState<{
    summary: { totalRows: number; imported: number; errors: number };
    errors: Array<{ row: number; message: string }>;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setStep(1);
    setFile(null);
    setDryRunResult(null);
    setError(null);
    onClose();
  };

  const handleDownloadTemplate = () => {
    window.open(getBalanceImportTemplateUrl(), '_blank');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setFile(f ?? null);
    setError(null);
  };

  const handleDryRun = async () => {
    if (!file) {
      setError('Please select a CSV file.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await importLeaveBalances(file, true);
      if (res.data) {
        setDryRunResult({ summary: res.data.summary, errors: res.data.errors });
        setStep(2);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setImportLoading(true);
    setError(null);
    try {
      await importLeaveBalances(file, false);
      onSuccess?.();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImportLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl dark:bg-gray-900">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <h2 className="text-xl font-semibold">Import Leave Balances</h2>
        </div>
        <div className="space-y-4 p-6">
          {step === 1 && (
            <>
              <p className="rounded bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                Importing balances will overwrite existing balances for the matched employee + leave type + year
                combinations. Proceed with caution.
              </p>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="w-full rounded border border-gray-300 bg-white py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700"
              >
                Download CSV template
              </button>
              <div>
                <label className="mb-1 block text-sm font-medium">Upload CSV</label>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="w-full text-sm"
                />
              </div>
            </>
          )}
          {step === 2 && dryRunResult && (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Rows: {dryRunResult.summary.totalRows} · Would import: {dryRunResult.summary.imported} · Errors:{' '}
                {dryRunResult.summary.errors}
              </p>
              {dryRunResult.errors.length > 0 && (
                <ul className="max-h-40 overflow-y-auto rounded border border-gray-200 p-2 text-sm dark:border-gray-700">
                  {dryRunResult.errors.slice(0, 20).map((e) => (
                    <li key={e.row}>
                      Row {e.row}: {e.message}
                    </li>
                  ))}
                  {dryRunResult.errors.length > 20 && (
                    <li>… and {dryRunResult.errors.length - 20} more</li>
                  )}
                </ul>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded border border-gray-300 bg-white px-4 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={importLoading || dryRunResult.summary.errors > 0}
                  className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {importLoading ? 'Importing…' : 'Confirm import'}
                </button>
              </div>
            </>
          )}
          {error && (
            <p className="rounded bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </p>
          )}
          {step === 1 && (
            <button
              type="button"
              onClick={handleDryRun}
              disabled={!file || loading}
              className="w-full rounded bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Validating…' : 'Validate (dry run)'}
            </button>
          )}
        </div>
        <div className="border-t border-gray-200 p-4 dark:border-gray-700">
          <button
            type="button"
            onClick={handleClose}
            className="w-full rounded border border-gray-300 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
