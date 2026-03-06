'use client';

/**
 * Tenant app shell — sidebar + main content.
 * Profile picture at bottom left links to /account.
 */
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SIDEBAR_NAV = [
  { href: '/dashboard', label: 'Home' },
  { href: '/leave', label: 'Leave' },
  { href: '/performance', label: 'Performance' },
];

export default function TenantLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-950">
      <aside className="flex w-60 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <nav className="flex-1 overflow-y-auto p-2" aria-label="Main navigation">
          {SIDEBAR_NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-gray-200 p-2 dark:border-gray-800">
          <Link
            href="/account"
            className="flex items-center gap-3 rounded-lg p-2 text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            aria-label="Go to account"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-medium text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
              {/* Profile picture / avatar — replace with user photo when available */}
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 8zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </span>
            <span className="min-w-0 truncate text-sm font-medium">Account</span>
          </Link>
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
