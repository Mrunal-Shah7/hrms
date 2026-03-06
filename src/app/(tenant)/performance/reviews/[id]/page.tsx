'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getReview, acknowledgeReview, submitReview, type ReviewDetail } from '../../../../../services/reviews';

export default function ReviewDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string | undefined;
  const [review, setReview] = useState<ReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitForm, setSubmitForm] = useState({ rating: 4, comments: '', strengths: '', improvements: '' });

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getReview(id)
      .then((res) => {
        if (res.data) setReview(res.data);
        else setReview(null);
      })
      .catch(() => setReview(null))
      .finally(() => setLoading(false));
  }, [id]);

  const handleAcknowledge = async () => {
    if (!id) return;
    setSubmitting(true);
    try {
      await acknowledgeReview(id);
      const res = await getReview(id);
      if (res.data) setReview(res.data);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSubmitting(true);
    try {
      await submitReview(id, { rating: submitForm.rating, comments: submitForm.comments || undefined, strengths: submitForm.strengths || undefined, improvements: submitForm.improvements || undefined });
      const res = await getReview(id);
      if (res.data) setReview(res.data);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!id) return null;
  if (loading) return <div className="p-6">Loading…</div>;
  if (!review) return <div className="p-6">Review not found. <button type="button" onClick={() => router.push('/performance/reviews')} className="text-blue-600 underline">Back to Reviews</button></div>;

  const canAcknowledge = review.status === 'submitted';
  const canSubmit = review.status === 'pending';

  return (
    <div className="p-6 max-w-2xl">
      <button type="button" onClick={() => router.push('/performance/reviews')} className="mb-4 text-sm text-blue-600 hover:underline dark:text-blue-400">← Back to Reviews</button>
      <h1 className="text-2xl font-semibold mb-6">Review: {review.cycle.name}</h1>
      <dl className="space-y-2 text-sm mb-6">
        <div><dt className="text-gray-500 dark:text-gray-400">Cycle</dt><dd>{review.cycle.name} ({review.cycle.type})</dd></div>
        <div><dt className="text-gray-500 dark:text-gray-400">Subject</dt><dd>{review.subject.firstName} {review.subject.lastName}</dd></div>
        <div><dt className="text-gray-500 dark:text-gray-400">Reviewer</dt><dd>{review.reviewer.firstName} {review.reviewer.lastName}</dd></div>
        <div><dt className="text-gray-500 dark:text-gray-400">Status</dt><dd>{review.status}</dd></div>
      </dl>
      {review.rating != null && (
        <p className="mb-4">Rating: {review.rating}/5</p>
      )}
      {review.comments && <div className="mb-4"><h3 className="font-medium text-gray-700 dark:text-gray-300">Comments</h3><p className="text-gray-600 dark:text-gray-400">{review.comments}</p></div>}
      {review.strengths && <div className="mb-4"><h3 className="font-medium text-gray-700 dark:text-gray-300">Strengths</h3><p className="text-gray-600 dark:text-gray-400">{review.strengths}</p></div>}
      {review.improvements && <div className="mb-6"><h3 className="font-medium text-gray-700 dark:text-gray-300">Areas for Improvement</h3><p className="text-gray-600 dark:text-gray-400">{review.improvements}</p></div>}

      {canSubmit && (
        <form onSubmit={handleSubmitReview} className="border-t border-gray-200 pt-6 dark:border-gray-700">
          <h3 className="font-medium mb-4">Submit Review</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rating (1-5) *</label>
              <select value={submitForm.rating} onChange={(e) => setSubmitForm((s) => ({ ...s, rating: Number(e.target.value) }))} className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white">
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Comments</label>
              <textarea value={submitForm.comments} onChange={(e) => setSubmitForm((s) => ({ ...s, comments: e.target.value }))} rows={3} className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Strengths</label>
              <textarea value={submitForm.strengths} onChange={(e) => setSubmitForm((s) => ({ ...s, strengths: e.target.value }))} rows={2} className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Areas for Improvement</label>
              <textarea value={submitForm.improvements} onChange={(e) => setSubmitForm((s) => ({ ...s, improvements: e.target.value }))} rows={2} className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white" />
            </div>
          </div>
          <button type="submit" disabled={submitting} className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Submit Review</button>
        </form>
      )}

      {canAcknowledge && (
        <div className="border-t border-gray-200 pt-6 dark:border-gray-700">
          <button type="button" onClick={handleAcknowledge} disabled={submitting} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            Acknowledge
          </button>
        </div>
      )}
    </div>
  );
}
