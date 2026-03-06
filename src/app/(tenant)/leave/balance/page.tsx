'use client';

import { useState, useEffect, useCallback } from 'react';
import { getLeaveBalance, type BalanceRow } from '../../../../services/leave-summary';
import { ApplyLeaveModal } from '../../../../components/modules/leave/apply-leave-modal';

export default function LeaveBalancePage() {
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [year, setYear] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [preselectedLeaveTypeId, setPreselectedLeaveTypeId] = useState<string | undefined>(undefined);

  const fetchBalances = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLeaveBalance(year);
      if (res.data) setBalances(res.data);
      else setBalances([]);
    } catch {
      setBalances([]);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  const openApplyForType = (leaveTypeId: string) => {
    setPreselectedLeaveTypeId(leaveTypeId);
    setApplyModalOpen(true);
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Leave Balance</h1>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : balances.length === 0 ? (
        <p className="text-muted-foreground">No balance data for this year.</p>
      ) : (
        <div className="space-y-4">
          {balances.map((row) => {
            const color = row.leaveType.color ?? '#6b7280';
            const isLWP = row.leaveType.code === 'LWP' || !row.leaveType.isPaid;
            const showApply = isLWP || row.available > 0;
            return (
              <div
                key={row.leaveType.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="flex items-center gap-4">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-full text-white"
                    style={{ backgroundColor: color }}
                  >
                    {row.leaveType.icon ?? row.leaveType.code?.slice(0, 2) ?? '—'}
                  </div>
                  <div>
                    <p className="font-medium">{row.leaveType.name}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Available: <span style={{ color }}>{row.available}</span> · Booked: {row.used}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    Allocated: {row.totalAllocated} · Carried: {row.carriedForward} · Pending: {row.pending}
                  </span>
                  {showApply && (
                    <button
                      type="button"
                      onClick={() => openApplyForType(row.leaveType.id)}
                      className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      Apply Leave
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ApplyLeaveModal
        open={applyModalOpen}
        onClose={() => {
          setApplyModalOpen(false);
          setPreselectedLeaveTypeId(undefined);
        }}
        onSuccess={fetchBalances}
        preselectedLeaveTypeId={preselectedLeaveTypeId}
      />
    </div>
  );
}
