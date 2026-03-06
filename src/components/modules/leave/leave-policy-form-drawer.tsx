'use client';

/**
 * Leave policy create/edit drawer.
 * Fields: leave type (select), scope (designation, department, employment type), annual allocation,
 * accrual type, carry forward toggle, max carry forward (when on).
 * Impact preview: "This policy would affect N employees" (debounced 500ms from /leave/policies/preview).
 */
interface LeavePolicyFormDrawerProps {
  open: boolean;
  onClose: () => void;
  editId?: string | null;
  onSuccess?: () => void;
}

export function LeavePolicyFormDrawer({ open, onClose, editId, onSuccess }: LeavePolicyFormDrawerProps) {
  return (
    <div data-drawer="leave-policy" data-open={open} data-edit-id={editId ?? undefined}>
      {/* TODO: Form + scope selectors + impact preview */}
      <button type="button" onClick={onClose}>Close</button>
    </div>
  );
}
