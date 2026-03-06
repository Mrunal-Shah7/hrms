'use client';

import { useState, useEffect, useCallback } from 'react';
import { listLeaveTypes, type LeaveType } from '../../../services/leave-types';
import { getLeaveBalance, type BalanceRow } from '../../../services/leave-summary';
import {
  applyLeave,
  previewLeaveDays,
  type ApplyLeaveInput,
  type PreviewLeaveDaysResult,
} from '../../../services/leave-requests';
import { LeaveCalendarStrip } from './leave-calendar-strip';

interface ApplyLeaveModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  preselectedLeaveTypeId?: string;
}

export function ApplyLeaveModal({
  open,
  onClose,
  onSuccess,
  preselectedLeaveTypeId,
}: ApplyLeaveModalProps) {
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [leaveTypeId, setLeaveTypeId] = useState(preselectedLeaveTypeId ?? '');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [durationType, setDurationType] = useState<'full_day' | 'first_half' | 'second_half'>('full_day');
  const [teamEmail, setTeamEmail] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<PreviewLeaveDaysResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTypes = useCallback(async () => {
    const res = await listLeaveTypes({ limit: 100 });
    if (res.data) setLeaveTypes(res.data);
  }, []);

  const fetchBalances = useCallback(async () => {
    const res = await getLeaveBalance();
    if (res.data) setBalances(res.data);
  }, []);

  useEffect(() => {
    if (open) {
      setError(null);
      fetchTypes();
      fetchBalances();
      if (preselectedLeaveTypeId) setLeaveTypeId(preselectedLeaveTypeId);
    }
  }, [open, fetchTypes, fetchBalances, preselectedLeaveTypeId]);

  useEffect(() => {
    if (!open || !startDate || !endDate) {
      setPreview(null);
      return;
    }
    setLoading(true);
    previewLeaveDays(startDate, endDate, durationType)
      .then((res) => {
        if (res.data) setPreview(res.data);
      })
      .catch(() => setPreview(null))
      .finally(() => setLoading(false));
  }, [open, startDate, endDate, durationType]);

  const selectedBalance = balances.find((b) => b.leaveType.id === leaveTypeId);
  const selectedType = leaveTypes.find((t) => t.id === leaveTypeId);
  const isSingleDay = startDate && endDate && startDate === endDate;
  const totalDays = preview?.totalDays ?? 0;
  const available = selectedBalance?.available ?? 0;
  const isLWP = selectedType?.code === 'LWP' || selectedType?.isPaid === false;
  const insufficientBalance = !isLWP && totalDays > 0 && available < totalDays;
  const maxConsecutive = selectedType?.maxConsecutiveDays ?? null;
  const maxExceeded = maxConsecutive != null && totalDays > maxConsecutive;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaveTypeId || !startDate || !endDate) {
      setError('Please select leave type and date range.');
      return;
    }
    setError(null);
    setSubmitLoading(true);
    try {
      const body: ApplyLeaveInput = {
        leaveTypeId,
        startDate,
        endDate,
        durationType,
        reason: reason.trim() || undefined,
        teamEmail: teamEmail.trim() || undefined,
      };
      await applyLeave(body);
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit leave request');
    } finally {
      setSubmitLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-xl dark:bg-gray-900">
        <div className="sticky top-0 border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="text-xl font-semibold">Apply Leave</h2>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Leave Type *
            </label>
            <select
              value={leaveTypeId}
              onChange={(e) => setLeaveTypeId(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              required
            >
              <option value="">Select leave type</option>
              {leaveTypes.map((lt) => {
                const bal = balances.find((b) => b.leaveType.id === lt.id);
                const hint = bal != null ? ` — ${bal.available} available` : '';
                return (
                  <option key={lt.id} value={lt.id}>
                    {lt.name}{hint}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Start Date *
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                End Date *
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                required
              />
            </div>
          </div>

          {isSingleDay && (
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Duration
              </label>
              <div className="flex gap-4">
                {(['full_day', 'first_half', 'second_half'] as const).map((d) => (
                  <label key={d} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="durationType"
                      checked={durationType === d}
                      onChange={() => setDurationType(d)}
                    />
                    <span className="text-sm">
                      {d === 'full_day' ? 'Full Day' : d === 'first_half' ? 'First Half' : 'Second Half'}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Team Email ID (optional)
            </label>
            <input
              type="email"
              value={teamEmail}
              onChange={(e) => setTeamEmail(e.target.value)}
              placeholder="Notify your team about this leave"
              className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Reason for leave (optional)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={1000}
              className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
          </div>

          {startDate && endDate && (
            <>
              {loading ? (
                <p className="text-sm text-gray-500">Calculating days…</p>
              ) : preview && preview.breakdown.length > 0 ? (
                <LeaveCalendarStrip breakdown={preview.breakdown} totalDays={preview.totalDays} />
              ) : preview?.message ? (
                <p className="text-sm text-amber-600">{preview.message}</p>
              ) : null}

              {totalDays > 0 && (
                <div className="space-y-1 text-sm">
                  {isLWP ? (
                    <p className="text-blue-600 dark:text-blue-400">
                      Leave Without Pay has no balance limit.
                    </p>
                  ) : (
                    <p className="text-gray-700 dark:text-gray-300">
                      Available: {available} days → After this request: {Math.max(0, available - totalDays)} days
                    </p>
                  )}
                  {insufficientBalance && (
                    <p className="text-red-600 dark:text-red-400">
                      Insufficient balance. You have {available} days available.
                    </p>
                  )}
                  {maxExceeded && (
                    <p className="text-red-600 dark:text-red-400">
                      Maximum consecutive days for {selectedType?.name} is {maxConsecutive}. You requested {totalDays} days.
                    </p>
                  )}
                  {preview?.holidaysInRange?.length ? (
                    <p className="text-amber-600 dark:text-amber-400">
                      Your leave period includes {preview.holidaysInRange.length} holiday(s):{' '}
                      {preview.holidaysInRange.map((h) => h.name).join(', ')}. These days are not deducted from your balance.
                    </p>
                  ) : null}
                </div>
              )}
            </>
          )}

          {error && (
            <div className="rounded bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitLoading || !leaveTypeId || !startDate || !endDate || insufficientBalance || maxExceeded}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitLoading ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
