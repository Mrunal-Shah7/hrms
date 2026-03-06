'use client';

import { useState, useEffect, useCallback } from 'react';
import { getTeamOnLeave, getReporteesOnLeave } from '../../../../services/leave-summary';
import { TeamLeaveList } from '../../../../components/modules/leave/team-leave-list';
import type { TeamOnLeaveEntry } from '../../../../services/leave-summary';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function LeaveTeamPage() {
  const [date, setDate] = useState(todayStr());
  const [departmentId, setDepartmentId] = useState<string>('');
  const [teamEntries, setTeamEntries] = useState<TeamOnLeaveEntry[]>([]);
  const [reporteesEntries, setReporteesEntries] = useState<TeamOnLeaveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [reporteesLoading, setReporteesLoading] = useState(true);
  const [showReportees, setShowReportees] = useState(false);

  const fetchTeam = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getTeamOnLeave(date, departmentId || undefined);
      if (res.data) setTeamEntries(res.data);
      else setTeamEntries([]);
    } catch {
      setTeamEntries([]);
    } finally {
      setLoading(false);
    }
  }, [date, departmentId]);

  const fetchReportees = useCallback(async () => {
    setReporteesLoading(true);
    try {
      const res = await getReporteesOnLeave(date);
      if (res.data) {
        setReporteesEntries(res.data);
        setShowReportees(true);
      } else {
        setReporteesEntries([]);
        setShowReportees(false);
      }
    } catch {
      setReporteesEntries([]);
      setShowReportees(false);
    } finally {
      setReporteesLoading(false);
    }
  }, [date]);

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);

  useEffect(() => {
    fetchReportees();
  }, [fetchReportees]);

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold">Team on Leave</h1>
        <label className="flex items-center gap-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
        </label>
        {/* Department filter could be a dropdown from departments API - placeholder */}
        {/* <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>...</select> */}
      </div>

      {showReportees && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-medium">My Reportees</h2>
          {reporteesLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (
            <TeamLeaveList
              entries={reporteesEntries}
              emptyMessage={`No reportees on leave on ${date}.`}
            />
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-medium">Team</h2>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <TeamLeaveList
            entries={teamEntries}
            emptyMessage={`No one is on leave on ${date}.`}
          />
        )}
      </section>
    </div>
  );
}
