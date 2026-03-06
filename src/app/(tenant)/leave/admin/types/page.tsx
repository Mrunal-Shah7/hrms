/**
 * Leave Types config — /leave/admin/types.
 * Table: color, icon, name, code, paid, max consecutive days, policy count, actions.
 * Add Leave Type button opens leave-type-form-drawer.
 */
export default function LeaveTypesAdminPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Leave Types</h1>
      <p className="text-muted-foreground">Configure the types of leave available in your organization.</p>
      {/* TODO: DataTable + Add Leave Type button + leave-type-form-drawer */}
    </div>
  );
}
