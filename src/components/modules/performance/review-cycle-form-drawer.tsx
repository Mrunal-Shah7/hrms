'use client';

import { useState, useEffect } from 'react';
import { createReviewCycle, updateReviewCycle, getReviewCycle } from '../../../services/review-cycles';

interface ReviewCycleFormDrawerProps {
  open: boolean;
  onClose: () => void;
  cycleId: string | null;
  onSuccess: () => void;
}

export function ReviewCycleFormDrawer({ open, onClose, cycleId, onSuccess }: ReviewCycleFormDrawerProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'quarterly' | 'annual' | 'custom'>('quarterly');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!cycleId;

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (cycleId) {
      getReviewCycle(cycleId)
        .then((res) => {
          if (res.data) {
            setName(res.data.name);
            setType(res.data.type as 'quarterly' | 'annual' | 'custom');
            setStartDate(res.data.startDate);
            setEndDate(res.data.endDate);
          }
        })
        .catch(() => setError('Failed to load cycle'));
    } else {
      setName('');
      setType('quarterly');
      setStartDate('');
      setEndDate('');
    }
  }, [open, cycleId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Name is required'); return; }
    if (!startDate || !endDate) { setError('Start and end dates are required'); return; }
    if (new Date(endDate) <= new Date(startDate)) { setError('End date must be after start date'); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await updateReviewCycle(cycleId!, { name: name.trim(), type, startDate, endDate });
      } else {
        await createReviewCycle({ name: name.trim(), type, startDate, endDate });
      }
      onSuccess();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" aria-hidden onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white shadow-xl dark:bg-gray-900 flex flex-col max-h-full overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Review Cycle' : 'Create Review Cycle'}</h2>
          <button type="button" onClick={onClose} className="rounded p-2 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Close">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto">
          {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Name *</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white" maxLength={255} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Type *</label>
              <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white">
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Start Date *</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">End Date *</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white" required />
            </div>
          </div>
          <div className="mt-6 flex gap-2">
            <button type="submit" disabled={saving} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Save</button>
            <button type="button" onClick={onClose} className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
