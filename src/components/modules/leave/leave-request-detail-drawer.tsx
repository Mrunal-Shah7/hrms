'use client';

import { useState, useEffect } from 'react';
import {
  getLeaveRequest,
  reviewLeave,
  cancelLeaveRequest,
  type LeaveRequestDetail,
  type ReviewLeaveInput,
} from '../../../services/leave-requests';
import { LeaveCalendarStrip } from './leave-calendar-strip';

interface LeaveRequestDetailDrawerProps {
  requestId: string | null;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  currentUserId?: string;
  canApprove?: boolean;
}

function formatDate(s: string) {
  try {
    return new Date(s).toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
  return s;
}

function durationLabel(d: string) {
  if (d === 'first_half') return 'First Half';
  if (d === 'second_half') return 'Second Half';
  return 'Full Day';
}

export function LeaveRequestDetailDrawer({
  requestId,
  open,
  onClose,
  onSuccess,
  currentUserId,
  canApprove = false,
}: LeaveRequestDetailDrawerProps) {
  const [detail, setDetail] = useState<LeaveRequestDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | null>(null);
  const [reviewComment, setReviewComment] = useState('');

  useEffect(() => {
    if (!open || !requestId) {
      setDetail(null);
      setReviewAction(null);
      setReviewComment('');
      return;
    }
    setLoading(true);
    getLeaveRequest(requestId)
      .then((res) => {
        if (res.data) setDetail(res.data);
      })
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [open, requestId]);

  const isOwner = currentUserId && detail?.employee?.id === currentUserId;
  const canCancel =
    (isOwner && detail?.status === 'pending') ||
    (canApprove && (detail?.status === 'pending' || detail?.status === 'approved'));
  const showReviewActions = canApprove && detail?.status === 'pending' && !isOwner;
  const isOwnerApprovedNoCancel = isOwner && detail?.status === 'approved';

  const handleReview = async () => {
    if (!requestId || !reviewAction) return;
    setActionLoading(true);
    try {
      const body: ReviewLeaveInput = { action: reviewAction, comment: reviewComment.trim() || undefined };
      await reviewLeave(requestId, body);
      setReviewAction(null);
      setReviewComment('');
      onSuccess?.();
      const res = await getLeaveRequest(requestId);
      if (res.data) setDetail(res.data);
    } catch {
      // Error could be shown via toast
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!requestId || !confirm('Are you sure you want to cancel this leave request?')) return;
    setActionLoading(true);
    try {
      await cancelLeaveRequest(requestId);
      onSuccess?.();
      onClose();
    } catch {
      // Error via toast
    } finally {
      setActionLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl dark:bg-gray-900 sm:max-w-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 className="text-lg font-semibold">Leave Request Details</h2>
          <button type="button" onClick={onClose} className="p-2 text-gray-500 hover:text-gray-700" aria-label="Close">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-gray-500">Loading…</div>
          ) : !detail ? (
            <div className="p-6 text-gray-500">Request not found.</div>
          ) : (
            <div className="flex flex-col sm:flex-row">
              <div className="flex-1 space-y-4 p-6">
                <div className="flex items-center gap-3">
                  {detail.employee.photoUrl ? (
                    <img
                      src={detail.employee.photoUrl}
                      alt=""
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-200 text-sm font-medium text-gray-600 dark:bg-gray-600 dark:text-gray-300">
                      {(detail.employee.firstName?.[0] ?? '') + (detail.employee.lastName?.[0] ?? '')}
                    </div>
                  )}
                  <div>
                    <p className="font-medium">
                      {detail.employee.employeeId} — {detail.employee.firstName} {detail.employee.lastName}
                    </p>
                    {(detail.employee.department || detail.employee.designation) && (
                      <p className="text-sm text-gray-500">
                        {[detail.employee.department, detail.employee.designation].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
                <p className="font-medium" style={{ color: detail.leaveType.color ?? undefined }}>
                  {detail.leaveType.name}
                </p>
                {detail.breakdown?.length > 0 && (
                  <LeaveCalendarStrip breakdown={detail.breakdown} totalDays={detail.totalDays} />
                )}
                {detail.teamEmail && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Team Email: {detail.teamEmail}
                  </p>
                )}
                <p className="text-sm text-gray-500">
                  Date of request: {formatDate(detail.dateOfRequest ?? detail.createdAt)}
                </p>
                {detail.reason && (
                  <p className="text-sm text-gray-700 dark:text-gray-300">Reason: {detail.reason}</p>
                )}
              </div>
              <div className="w-full border-t border-gray-200 bg-gray-50 p-6 dark:border-gray-700 dark:bg-gray-800 sm:w-72 sm:border-t-0 sm:border-l">
                {detail.balanceImpact && (
                  <div className="space-y-3 text-sm">
                    <p className="font-medium">As on {detail.balanceImpact.asOnDate}</p>
                    <p>Available balance: {detail.balanceImpact.availableBalance}</p>
                    <p>Current booking: {detail.balanceImpact.currentBooking}</p>
                    <p>Balance after current booking: {detail.balanceImpact.balanceAfterBooking}</p>
                    <p className="font-medium">As on {detail.balanceImpact.asOnYearEnd}</p>
                    <p>Estimated balance: {detail.balanceImpact.estimatedBalance}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        {detail && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 p-4 dark:border-gray-700">
            {reviewAction ? (
              <>
                <input
                  type="text"
                  placeholder="Comment (optional)"
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white min-w-[200px]"
                  maxLength={500}
                />
                <button
                  type="button"
                  onClick={() => setReviewAction(null)}
                  className="rounded border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleReview}
                  disabled={actionLoading}
                  className={`rounded px-3 py-2 text-sm font-medium text-white ${
                    reviewAction === 'approve'
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-red-600 hover:bg-red-700'
                  } disabled:opacity-50`}
                >
                  {actionLoading ? '…' : reviewAction === 'approve' ? 'Approve' : 'Reject'}
                </button>
              </>
            ) : (
              <>
                {showReviewActions && (
                  <>
                    <button
                      type="button"
                      onClick={() => setReviewAction('reject')}
                      className="rounded border border-red-600 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => setReviewAction('approve')}
                      className="rounded bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
                    >
                      Approve
                    </button>
                  </>
                )}
                {isOwnerApprovedNoCancel && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    To cancel an approved leave, please contact your HR administrator.
                  </p>
                )}
                {canCancel && (
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={actionLoading}
                    className="rounded border border-red-600 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-900/20"
                  >
                    Cancel Leave
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                >
                  Close
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
