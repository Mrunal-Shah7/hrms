-- CreateTable
CREATE TABLE "super_admin_otps" (
    "id" UUID NOT NULL,
    "super_admin_id" UUID NOT NULL,
    "otp_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "super_admin_otps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "candidates_job_opening_id_idx" ON "candidates"("job_opening_id");

-- CreateIndex
CREATE INDEX "candidates_stage_id_idx" ON "candidates"("stage_id");

-- CreateIndex
CREATE INDEX "daily_time_summary_user_id_date_idx" ON "daily_time_summary"("user_id", "date");

-- CreateIndex
CREATE INDEX "employee_profiles_department_id_idx" ON "employee_profiles"("department_id");

-- CreateIndex
CREATE INDEX "employee_profiles_designation_id_idx" ON "employee_profiles"("designation_id");

-- CreateIndex
CREATE INDEX "employee_profiles_reports_to_idx" ON "employee_profiles"("reports_to");

-- CreateIndex
CREATE INDEX "goals_assigned_to_id_idx" ON "goals"("assigned_to_id");

-- CreateIndex
CREATE INDEX "leave_balances_user_id_year_idx" ON "leave_balances"("user_id", "year");

-- CreateIndex
CREATE INDEX "leave_requests_user_id_idx" ON "leave_requests"("user_id");

-- CreateIndex
CREATE INDEX "leave_requests_status_idx" ON "leave_requests"("status");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "time_logs_user_id_punch_time_idx" ON "time_logs"("user_id", "punch_time");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- AddForeignKey
ALTER TABLE "super_admin_otps" ADD CONSTRAINT "super_admin_otps_super_admin_id_fkey" FOREIGN KEY ("super_admin_id") REFERENCES "super_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
