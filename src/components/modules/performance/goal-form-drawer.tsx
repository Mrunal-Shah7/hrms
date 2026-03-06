'use client';

import { useState, useEffect, useCallback } from 'react';
import { createGoal, updateGoal, getGoal, type CreateGoalInput } from '../../../services/goals';

const getBase = () =>
  (typeof window !== 'undefined' ? '' : process.env.NEXT_PUBLIC_API_URL ?? '') + '/api';

async function fetchEmployees(search: string) {
  if (!search || search.length < 2) return [];
  const res = await fetch(`${getBase()}/employees/lookup?search=${encodeURIComponent(search)}&limit=20`, {
    credentials: 'include',
  });
  const json = await res.json();
  const data = json?.data;
  return Array.isArray(data) ? data : [];
}

async function fetchGroups() {
  const res = await fetch(`${getBase()}/groups?limit=100`, { credentials: 'include' });
  const json = await res.json();
  const list = json?.data ?? [];
  return list;
}

async function fetchProjects() {
  const res = await fetch(`${getBase()}/projects?limit=100`, { credentials: 'include' });
  const json = await res.json();
  const list = json?.data ?? [];
  return list;
}

type AssignToType = 'user' | 'group' | 'project';

interface GoalFormDrawerProps {
  open: boolean;
  onClose: () => void;
  goalId: string | null;
  onSuccess: () => void;
}

export function GoalFormDrawer({ open, onClose, goalId, onSuccess }: GoalFormDrawerProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedToType, setAssignedToType] = useState<AssignToType>('user');
  const [assignedToId, setAssignedToId] = useState('');
  const [assignedToLabel, setAssignedToLabel] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [userOptions, setUserOptions] = useState<Array<{ id: string; firstName: string; lastName: string }>>([]);
  const [groupOptions, setGroupOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [projectOptions, setProjectOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!goalId;

  const loadOptions = useCallback(() => {
    if (assignedToType === 'group') fetchGroups().then((list) => setGroupOptions(list));
    if (assignedToType === 'project') fetchProjects().then((list) => setProjectOptions(list));
  }, [assignedToType]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (goalId) {
      getGoal(goalId)
        .then((res) => {
          if (res.data) {
            const g = res.data;
            setTitle(g.title);
            setDescription(g.description ?? '');
            setAssignedToType(g.assignedTo.type as AssignToType);
            setAssignedToId(g.assignedTo.id);
            setAssignedToLabel(g.assignedTo.name);
            setPriority(g.priority as 'low' | 'medium' | 'high' | 'critical');
            setStartDate(g.startDate ?? '');
            setDueDate(g.dueDate ?? '');
          }
        })
        .catch(() => setError('Failed to load goal'));
    } else {
      setTitle('');
      setDescription('');
      setAssignedToType('user');
      setAssignedToId('');
      setAssignedToLabel('');
      setPriority('medium');
      setStartDate('');
      setDueDate('');
    }
    loadOptions();
  }, [open, goalId, loadOptions]);

  useEffect(() => {
    if (assignedToType !== 'user' || userSearch.length < 2) {
      setUserOptions([]);
      return;
    }
    const t = setTimeout(() => {
      fetchEmployees(userSearch).then((list) =>
        setUserOptions(list.map((u: { id: string; first_name: string; last_name: string }) => ({ id: u.id, firstName: u.first_name, lastName: u.last_name })))
      );
    }, 300);
    return () => clearTimeout(t);
  }, [assignedToType, userSearch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    if (!assignedToId) {
      setError('Please select an assignee');
      return;
    }
    if (dueDate && startDate && dueDate < startDate) {
      setError('Due date must be on or after start date');
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await updateGoal(goalId!, { title: title.trim(), description: description || undefined, priority, startDate: startDate || undefined, dueDate: dueDate || undefined });
      } else {
        const body: CreateGoalInput = {
          title: title.trim(),
          description: description || undefined,
          assignedToId,
          assignedToType,
          priority,
          startDate: startDate || undefined,
          dueDate: dueDate || undefined,
        };
        await createGoal(body);
      }
      onSuccess();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" aria-hidden onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white shadow-xl dark:bg-gray-900 flex flex-col max-h-full overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Goal' : 'Add Goals'}</h2>
          <button type="button" onClick={onClose} className="rounded p-2 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Close">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-y-auto p-6">
          {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <section className="mb-6">
            <h3 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">Goal Details</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Goal Name *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  maxLength={255}
                  required
                />
              </div>
              {!isEdit && (
                <>
                  <div>
                    <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Assign To Type</span>
                    <div className="flex gap-4">
                      {(['user', 'group', 'project'] as const).map((t) => (
                        <label key={t} className="flex items-center gap-2">
                          <input type="radio" name="assignToType" checked={assignedToType === t} onChange={() => { setAssignedToType(t); setAssignedToId(''); setAssignedToLabel(''); setUserSearch(''); loadOptions(); }} />
                          <span className="text-sm capitalize">{t}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Assign To *</label>
                    {assignedToType === 'user' && (
                      <>
                        <input
                          type="text"
                          value={userSearch || assignedToLabel}
                          onChange={(e) => { setUserSearch(e.target.value); if (!e.target.value) setAssignedToId(''); setAssignedToLabel(''); }}
                          placeholder="Search employees..."
                          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                        />
                        <ul className="mt-1 max-h-40 overflow-auto rounded border border-gray-200 dark:border-gray-700">
                          {userOptions.map((u) => (
                            <li key={u.id}>
                              <button type="button" onClick={() => { setAssignedToId(u.id); setAssignedToLabel(`${u.firstName} ${u.lastName}`); setUserSearch(''); setUserOptions([]); }} className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
                                {u.firstName} {u.lastName}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {assignedToType === 'group' && (
                      <select
                        value={assignedToId}
                        onChange={(e) => { const o = groupOptions.find((g) => g.id === e.target.value); setAssignedToId(e.target.value); setAssignedToLabel(o?.name ?? ''); }}
                        className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                      >
                        <option value="">Select group</option>
                        {groupOptions.map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    )}
                    {assignedToType === 'project' && (
                      <select
                        value={assignedToId}
                        onChange={(e) => { const o = projectOptions.find((p) => p.id === e.target.value); setAssignedToId(e.target.value); setAssignedToLabel(o?.name ?? ''); }}
                        className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                      >
                        <option value="">Select project</option>
                        {projectOptions.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Priority</label>
                <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Start Date</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Due Date</label>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Description</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white" />
              </div>
            </div>
          </section>
          <div className="flex gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
            <button type="submit" disabled={saving} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              Submit
            </button>
            <button type="button" onClick={onClose} className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
