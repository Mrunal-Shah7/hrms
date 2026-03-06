'use client';

import { getLeavePoliciesExportUrl } from '../../../../../services/leave-policies';

/**
 * Leave Policies config — /leave/admin/policies.
 * Filters: leave type, department. Table: leave type, designation, department, employment type, annual allocation, accrual, carry forward, actions.
 * Add Policy opens leave-policy-form-drawer with scope + impact preview.
 */
export default function LeavePoliciesAdminPage() {
  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Leave Policies</h1>
          <p className="text-muted-foreground">Define allocation rules for each leave type per employee segment.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.open(getLeavePoliciesExportUrl('csv'), '_blank')}
            className="rounded border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => window.open(getLeavePoliciesExportUrl('xlsx'), '_blank')}
            className="rounded border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
          >
            Export XLSX
          </button>
        </div>
      </div>
      {/* TODO: DataTable + Add Policy + leave-policy-form-drawer */}
    </div>
  );
}
