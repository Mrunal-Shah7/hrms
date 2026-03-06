'use client';

/**
 * Holiday CSV import — 3-step: template download → dry-run → import.
 */
interface HolidayImportDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function HolidayImportDialog({ open, onClose, onSuccess }: HolidayImportDialogProps) {
  return (
    <div data-dialog="holiday-import" data-open={open}>
      {/* TODO: Step 1 template download, Step 2 upload + dry-run, Step 3 confirm import */}
      <button type="button" onClick={onClose}>Close</button>
    </div>
  );
}
