'use client';

/**
 * Performance module layout.
 * Top tabs: My Data | Team. Sub-tabs under My Data: Goals | Reviews.
 * Admin: Review Cycles via link (performance:create:review_cycles).
 */
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const MY_DATA_TABS = [
  { href: '/performance/goals', label: 'Goals' },
  { href: '/performance/reviews', label: 'Reviews' },
];

export default function PerformanceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="performance-module min-h-full flex flex-col">
      <div className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center gap-6 px-6 pt-4">
          <span className="text-sm font-medium text-gray-500 dark:text-gray-400">My Data</span>
          <nav className="flex gap-1" aria-label="Performance sub-tabs">
            {MY_DATA_TABS.map((tab) => {
              const active = tab.href === '/performance/reviews'
  ? (pathname === '/performance/reviews' || (pathname.startsWith('/performance/reviews/') && !pathname.startsWith('/performance/reviews/cycles')))
  : pathname === tab.href;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`px-3 py-2 text-sm font-medium rounded-t transition-colors ${
                    active
                      ? 'text-blue-600 border-b-2 border-blue-600 bg-gray-50/50 dark:text-blue-400 dark:border-blue-400 dark:bg-gray-800/50'
                      : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
          <Link
            href="/performance/reviews/cycles"
            className="ml-auto text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Review Cycles
          </Link>
        </div>
      </div>
      <main className="flex-1">{children}</main>
    </div>
  );
}
