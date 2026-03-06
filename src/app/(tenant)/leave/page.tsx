/**
 * Leave module root — redirect to /leave/summary (Sprint 4B).
 */
import { redirect } from 'next/navigation';

export default function LeavePage() {
  redirect('/leave/summary');
}
