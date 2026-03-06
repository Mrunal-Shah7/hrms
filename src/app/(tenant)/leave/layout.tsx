'use client';

/**
 * Leave module layout — Sprint 4A.
 * Top tabs: My Data | Team | Holidays | (Admin gear dropdown).
 * Sub-tabs under My Data: Leave Summary | Leave Balance | Leave Requests | Shift (placeholder).
 * Admin dropdown (visible when user has leave:create:* or leave:edit:*): Leave Types, Leave Policies, Holidays, Balance Management.
 */
import React from 'react';

export default function LeaveLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="leave-module">
      {/* TODO: Top tab bar — My Data | Team | Holidays | Admin gear icon */}
      {/* TODO: Admin dropdown: /leave/admin/types, /leave/admin/policies, /leave/admin/holidays, /leave/admin/balances */}
      {/* TODO: Under My Data: sub-tabs Summary | Balance | Requests | Shift */}
      <main>{children}</main>
    </div>
  );
}
