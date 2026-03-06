'use client';

import { useState } from 'react';
import { BalanceImportDialog } from '../../../../../components/modules/leave/balance-import-dialog';

/**
 * Balance Management — /leave/admin/balances.
 * Section 1: Balance status card (year, totals, missing, last generated).
 * Section 2: Generate balances (year, optional user, preview + generate). Warning banner about preserving used.
 * Import Balances button opens balance-import-dialog.
 */
export default function BalanceManagementPage() {
  const [importOpen, setImportOpen] = useState(false);
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Leave Balance Management</h1>
      <p className="text-muted-foreground">Generate and manage employee leave allocations.</p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700"
        >
          Import Balances
        </button>
      </div>
      {/* TODO: Status card + balance-generation-dialog */}
      <BalanceImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={() => {}}
      />
    </div>
  );
}
