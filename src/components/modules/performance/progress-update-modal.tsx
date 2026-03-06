'use client';

import { useState, useEffect } from 'react';
import { getGoal, updateGoalProgress } from '../../../services/goals';

interface ProgressUpdateModalProps {
  open: boolean;
  goalId: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function ProgressUpdateModal({ open, goalId, onClose, onSuccess }: ProgressUpdateModalProps) {
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState('');
  const [currentProgress, setCurrentProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !goalId) return;
    setError(null);
    getGoal(goalId)
      .then((res) => {
        if (res.data) {
          setCurrentProgress(res.data.progress);
          setProgress(res.data.progress);
        }
      })
      .catch(() => setProgress(0));
    setNote('');
  }, [open, goalId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goalId) return;
    if (progress === currentProgress) {
      setError('Progress value is unchanged');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateGoalProgress(goalId, { progress, note: note || undefined });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" aria-hidden onClick={onClose} />
      <div className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">
        <h2 className="text-lg font-semibold mb-4">Update Progress</h2>
        {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Progress: {progress}%
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={progress}
              onChange={(e) => setProgress(Number(e.target.value))}
              className="w-full h-2 rounded-full appearance-none bg-gray-200 dark:bg-gray-700 accent-blue-600"
            />
          </div>
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              What did you accomplish? (optional)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
              className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              placeholder="Add a note..."
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
