'use client';

/**
 * Leave type create/edit drawer.
 * Fields: name, code (auto from name, editable), color (8 presets + custom hex), icon (grid ~15 Lucide icons),
 * paid toggle, max consecutive days (optional).
 */
interface LeaveTypeFormDrawerProps {
  open: boolean;
  onClose: () => void;
  editId?: string | null;
  onSuccess?: () => void;
}

export function LeaveTypeFormDrawer({ open, onClose, editId, onSuccess }: LeaveTypeFormDrawerProps) {
  return (
    <div data-drawer="leave-type" data-open={open} data-edit-id={editId ?? undefined}>
      {/* TODO: Drawer UI with form; code auto-generated from name; color picker; icon selector */}
      <button type="button" onClick={onClose}>Close</button>
    </div>
  );
}
