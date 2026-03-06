'use client';

/**
 * Balance generation wizard.
 * Year selector, optional "generate for specific employee" + lookup, Preview (dryRun) and Generate buttons.
 * Warning: regeneration preserves used days.
 */
interface BalanceGenerationDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function BalanceGenerationDialog({ open, onClose, onSuccess }: BalanceGenerationDialogProps) {
  return (
    <div data-dialog="balance-generation" data-open={open}>
      {/* TODO: Year, optional user, Preview / Generate */}
      <button type="button" onClick={onClose}>Close</button>
    </div>
  );
}
