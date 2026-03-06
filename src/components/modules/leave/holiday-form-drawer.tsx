'use client';

/**
 * Holiday create/edit drawer.
 * Fields: name, date (date picker), optional toggle.
 */
interface HolidayFormDrawerProps {
  open: boolean;
  onClose: () => void;
  editId?: string | null;
  onSuccess?: () => void;
}

export function HolidayFormDrawer({ open, onClose, editId, onSuccess }: HolidayFormDrawerProps) {
  return (
    <div data-drawer="holiday" data-open={open} data-edit-id={editId ?? undefined}>
      {/* TODO: Form with name, date, isOptional */}
      <button type="button" onClick={onClose}>Close</button>
    </div>
  );
}
