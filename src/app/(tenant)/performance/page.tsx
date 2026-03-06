/**
 * Performance module root — redirect to Goals (My Data).
 */
import { redirect } from 'next/navigation';

export default function PerformancePage() {
  redirect('/performance/goals');
}
