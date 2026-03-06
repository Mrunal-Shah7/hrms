'use client';

import { useState, useEffect, useCallback } from 'react';
import { listReviewCycles, deleteReviewCycle, updateReviewCycle, type ReviewCycleListItem } from '../../../../services/review-cycles';
import { ReviewCycleFormDrawer } from '../../../../components/modules/performance/review-cycle-form-drawer';

const STATUS_BADGES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
};

export default function ReviewCyclesPage() {
  const [cycles, setCycles] = useState<ReviewCycleListItem[]>([]);
  const [meta, setMeta] = useState<{ page: number; limit: number; total: number; totalPages: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchCycles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listReviewCycles({ limit: 50 });
      if (res.data) setCycles(res.data);
      else setCycles([]);
      if (res.meta) setMeta(res.meta);
      else setMeta(null);
    } catch {
      setCycles([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCycles();
  }, [fetchCycles]);

  const handleActivate = async (id: string) => {
    const cycle = cycles.find((c) => c.id === id);
    const count = cycle?.reviewCount ?? 0;
    if (!confirm(`Activating this cycle will create review records for all manager–reportee pairs (${count} reviews). Continue?`)) return;
    try {
      await updateReviewCycle(id, { status: 'active' });
      fetchCycles();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleComplete = async (id: string) => {
    try {
      await updateReviewCycle(id, { status: 'completed' });
      fetchCycles();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this review cycle? This can only be done for draft cycles.')) return;
    try {
      await deleteReviewCycle(id);
      fetchCycles();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Review Cycles</h1>
        <button type="button" onClick={() => { setEditingId(null); setFormOpen(true); }} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          Create Cycle
        </button>
      </div>
      {loading ? (
        <p className="text-gray-500 dark:text-gray-400">Loading…</p>
      ) : cycles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-600">
          <p className="text-gray-500 dark:text-gray-400">No review cycles</p>
          <button type="button" onClick={() => setFormOpen(true)} className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Create Cycle</button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Cycle Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Type</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Date Range</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Reviews</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {cycles.map((c) => (
                <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 capitalize">{c.type}</td>
                  <td className="px-4 py-3">{new Date(c.startDate).toLocaleDateString()} – {new Date(c.endDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3"><span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGES[c.status] ?? ''}`}>{c.status}</span></td>
                  <td className="px-4 py-3">{c.reviewCount} / {c.submittedCount} / {c.acknowledgedCount}</td>
                  <td className="px-4 py-3 flex gap-2">
                    <button type="button" onClick={() => { setEditingId(c.id); setFormOpen(true); }} className="text-blue-600 hover:underline dark:text-blue-400">Edit</button>
                    {c.status === 'draft' && <button type="button" onClick={() => handleActivate(c.id)} className="text-blue-600 hover:underline dark:text-blue-400">Activate</button>}
                    {c.status === 'active' && <button type="button" onClick={() => handleComplete(c.id)} className="text-blue-600 hover:underline dark:text-blue-400">Complete</button>}
                    {c.status === 'draft' && <button type="button" onClick={() => handleDelete(c.id)} className="text-red-600 hover:underline dark:text-red-400">Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ReviewCycleFormDrawer open={formOpen} onClose={() => { setFormOpen(false); setEditingId(null); }} cycleId={editingId} onSuccess={fetchCycles} />
    </div>
  );
}
