-- ============================================================================
-- ⚠️  SYNC WARNING: This DDL must stay in sync with prisma/schema.prisma.
--     Any table/column changes to tenant models in the Prisma schema
--     MUST be replicated here. This file is the source of truth for
--     what actually gets created in each tenant's PostgreSQL schema.
-- ============================================================================
--
-- TENANT SCHEMA DDL — Creates all ~65 tables for a single tenant.
-- __SCHEMA_NAME__ is replaced at runtime by the provisioning service.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS "__SCHEMA_NAME__";

SET search_path TO "__SCHEMA_NAME__";

-- === CORE: Users & Auth ===

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(50) UNIQUE,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    display_name VARCHAR(100),
    phone VARCHAR(20),
    photo_url TEXT,
    email_domain_type VARCHAR(20) NOT NULL DEFAULT 'company',
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    must_reset_password BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE password_reset_otps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    otp_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(255) NOT NULL,
    device_info JSONB NOT NULL DEFAULT '{}',
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- === CORE: RBAC ===

CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    resource VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(module, action, resource)
);

CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
    is_custom BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    UNIQUE(role_id, permission_id)
);

CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_by UUID,
    assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, role_id)
);

-- === SHARED SERVICES ===

CREATE TABLE file_storage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    data BYTEA,
    uploaded_by UUID NOT NULL REFERENCES users(id),
    context VARCHAR(100),
    context_id UUID,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE email_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(20) NOT NULL,
    config JSONB NOT NULL,
    from_email VARCHAR(255) NOT NULL,
    from_name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE notification_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_type VARCHAR(100) UNIQUE NOT NULL,
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
    module VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID NOT NULL,
    old_value JSONB,
    new_value JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE organization_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_name VARCHAR(255) NOT NULL,
    custom_domain VARCHAR(255),
    company_email_domain VARCHAR(255),
    default_timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
    date_format VARCHAR(20) NOT NULL DEFAULT 'DD-MMM-YYYY',
    financial_year_start_month INT NOT NULL DEFAULT 1,
    default_currency VARCHAR(10) NOT NULL DEFAULT 'USD'
);

CREATE TABLE user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date_format VARCHAR(20),
    timezone VARCHAR(50),
    language VARCHAR(10) NOT NULL DEFAULT 'en',
    profile_picture_visibility VARCHAR(20) NOT NULL DEFAULT 'everyone',
    new_sign_in_alert BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- === EMPLOYEE MANAGEMENT ===

CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    mail_alias VARCHAR(255),
    head_id UUID,
    parent_id UUID REFERENCES departments(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE designations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    hierarchy_level INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE employee_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id),
    designation_id UUID REFERENCES designations(id),
    reports_to UUID,
    employment_type VARCHAR(20) NOT NULL,
    date_of_joining DATE NOT NULL,
    date_of_birth DATE,
    gender VARCHAR(20),
    marital_status VARCHAR(20),
    blood_group VARCHAR(10),
    emergency_contact_name VARCHAR(255),
    emergency_contact_phone VARCHAR(20),
    emergency_contact_relation VARCHAR(50),
    present_address JSONB,
    permanent_address JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE reporting_hierarchy (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    designation_id UUID UNIQUE NOT NULL,
    reports_to_designation_id UUID,
    level INT NOT NULL DEFAULT 0
);

CREATE TABLE groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    added_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(group_id, user_id)
);

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    manager_id UUID NOT NULL,
    budget DECIMAL(12,2),
    start_date DATE,
    end_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE project_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role VARCHAR(50),
    added_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, user_id)
);

CREATE TABLE project_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    assignee_id UUID,
    status VARCHAR(20) NOT NULL DEFAULT 'todo',
    priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    due_date DATE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE delegations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delegator_id UUID NOT NULL,
    delegatee_id UUID NOT NULL,
    type VARCHAR(100) NOT NULL,
    description TEXT,
    start_date DATE NOT NULL,
    end_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- === LEAVE MANAGEMENT ===

CREATE TABLE leave_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    color VARCHAR(7),
    icon VARCHAR(50),
    is_paid BOOLEAN NOT NULL DEFAULT TRUE,
    max_consecutive_days INT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE leave_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
    designation_id UUID,
    department_id UUID,
    employment_type VARCHAR(20),
    annual_allocation FLOAT NOT NULL,
    carry_forward BOOLEAN NOT NULL DEFAULT FALSE,
    max_carry_forward FLOAT,
    accrual_type VARCHAR(20) NOT NULL DEFAULT 'annual',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE leave_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
    year INT NOT NULL,
    total_allocated FLOAT NOT NULL DEFAULT 0,
    carried_forward FLOAT NOT NULL DEFAULT 0,
    used FLOAT NOT NULL DEFAULT 0,
    UNIQUE(user_id, leave_type_id, year)
);

CREATE TABLE leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES leave_types(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    duration_type VARCHAR(20) NOT NULL DEFAULT 'full_day',
    total_days FLOAT NOT NULL,
    reason TEXT,
    team_email VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    reviewed_by UUID,
    review_comment TEXT,
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE holidays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    is_optional BOOLEAN NOT NULL DEFAULT FALSE,
    year INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- === TIME TRACKER ===

CREATE TABLE time_tracker_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    config JSONB NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sync_frequency VARCHAR(20) NOT NULL DEFAULT 'hourly',
    last_sync_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE time_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    punch_type VARCHAR(10) NOT NULL,
    punch_time TIMESTAMP NOT NULL,
    source VARCHAR(50) NOT NULL,
    raw_data JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE daily_time_summary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    date DATE NOT NULL,
    first_punch_in TIMESTAMP,
    last_punch_out TIMESTAMP,
    total_hours FLOAT NOT NULL DEFAULT 0,
    effective_hours FLOAT NOT NULL DEFAULT 0,
    overtime_hours FLOAT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'present',
    is_late BOOLEAN NOT NULL DEFAULT FALSE,
    is_early_departure BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, date)
);

-- === ATTENDANCE ===

CREATE TABLE work_schedule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    start_time VARCHAR(5) NOT NULL,
    end_time VARCHAR(5) NOT NULL,
    working_days JSONB NOT NULL,
    grace_period_minutes INT NOT NULL DEFAULT 0,
    min_hours_full_day FLOAT NOT NULL DEFAULT 8,
    min_hours_half_day FLOAT NOT NULL DEFAULT 4,
    overtime_threshold_hours FLOAT NOT NULL DEFAULT 9,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE attendance_regularizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    date DATE NOT NULL,
    reason TEXT NOT NULL,
    punch_in VARCHAR(5),
    punch_out VARCHAR(5),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    reviewed_by UUID,
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- === PERFORMANCE ===

CREATE TABLE goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    assigned_to_id UUID NOT NULL,
    assigned_to_type VARCHAR(20) NOT NULL DEFAULT 'user',
    created_by_id UUID NOT NULL REFERENCES users(id),
    priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    status VARCHAR(20) NOT NULL DEFAULT 'not_started',
    progress INT NOT NULL DEFAULT 0,
    start_date DATE,
    due_date DATE,
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE goal_progress_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    old_progress INT NOT NULL,
    new_progress INT NOT NULL,
    note TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE performance_review_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE performance_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id UUID NOT NULL REFERENCES performance_review_cycles(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES users(id),
    reviewer_id UUID NOT NULL REFERENCES users(id),
    rating INT,
    comments TEXT,
    strengths TEXT,
    improvements TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    submitted_at TIMESTAMP,
    acknowledged_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- === FILES ===

CREATE TABLE file_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES file_folders(id),
    scope VARCHAR(20) NOT NULL DEFAULT 'personal',
    owner_id UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE file_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    storage_id UUID NOT NULL,
    folder_id UUID REFERENCES file_folders(id),
    scope VARCHAR(20) NOT NULL DEFAULT 'personal',
    owner_id UUID NOT NULL,
    department_id UUID,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE file_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_record_id UUID NOT NULL REFERENCES file_records(id) ON DELETE CASCADE,
    shared_with_id UUID NOT NULL,
    permission VARCHAR(20) NOT NULL DEFAULT 'view',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(file_record_id, shared_with_id)
);

-- === COMPENSATION ===

CREATE TABLE salary_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    type VARCHAR(20) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE employee_salaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ctc DECIMAL(12,2) NOT NULL,
    effective_from DATE NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE salary_breakdowns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_salary_id UUID NOT NULL REFERENCES employee_salaries(id) ON DELETE CASCADE,
    component_id UUID NOT NULL REFERENCES salary_components(id),
    amount DECIMAL(12,2) NOT NULL
);

CREATE TABLE payslips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month INT NOT NULL,
    year INT NOT NULL,
    gross_pay DECIMAL(12,2) NOT NULL,
    deductions DECIMAL(12,2) NOT NULL,
    net_pay DECIMAL(12,2) NOT NULL,
    breakdown JSONB NOT NULL,
    pdf_storage_id UUID,
    generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, month, year)
);

CREATE TABLE appraisal_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    reviewer_id UUID NOT NULL REFERENCES users(id),
    effective_date DATE NOT NULL,
    previous_ctc DECIMAL(12,2) NOT NULL,
    new_ctc DECIMAL(12,2) NOT NULL,
    increment_percent FLOAT NOT NULL,
    comments TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- === RECRUITMENT ===

CREATE TABLE job_openings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    department_id UUID,
    designation_id UUID,
    employment_type VARCHAR(20) NOT NULL,
    experience VARCHAR(50),
    salary_range JSONB,
    location VARCHAR(255),
    openings INT NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    publish_token VARCHAR(100) UNIQUE,
    published_at TIMESTAMP,
    closed_at TIMESTAMP,
    created_by UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE candidate_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    order_index INT NOT NULL,
    color VARCHAR(7),
    is_default BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_opening_id UUID NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
    stage_id UUID NOT NULL REFERENCES candidate_stages(id),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    resume_storage_id UUID,
    cover_letter TEXT,
    source VARCHAR(50),
    owner_id UUID,
    rating INT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE candidate_stage_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    stage_id UUID NOT NULL REFERENCES candidate_stages(id),
    moved_by UUID NOT NULL,
    moved_at TIMESTAMP NOT NULL DEFAULT NOW(),
    note TEXT
);

CREATE TABLE candidate_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    author_id UUID NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE interviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_opening_id UUID NOT NULL REFERENCES job_openings(id),
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    scheduled_at TIMESTAMP NOT NULL,
    duration_minutes INT NOT NULL DEFAULT 60,
    type VARCHAR(50) NOT NULL,
    location VARCHAR(255),
    meeting_link TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    notes TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE interview_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
    interviewer_id UUID NOT NULL,
    rating INT,
    recommendation VARCHAR(20),
    comments TEXT,
    submitted_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    time_limit_minutes INT,
    created_by UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE assessment_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL,
    question TEXT NOT NULL,
    options JSONB,
    correct_answer TEXT,
    points INT NOT NULL DEFAULT 1,
    order_index INT NOT NULL
);

CREATE TABLE assessment_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES assessments(id),
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    answers JSONB NOT NULL,
    score INT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    submitted_at TIMESTAMP,
    evaluated_by UUID,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID,
    job_opening_id UUID,
    referred_by_id UUID NOT NULL,
    candidate_name VARCHAR(255) NOT NULL,
    candidate_email VARCHAR(255) NOT NULL,
    candidate_phone VARCHAR(20),
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'submitted',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE offer_letters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    designation VARCHAR(255) NOT NULL,
    ctc_offered DECIMAL(12,2) NOT NULL,
    joining_date DATE NOT NULL,
    content TEXT NOT NULL,
    pdf_storage_id UUID,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    sent_at TIMESTAMP,
    responded_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE recruitment_email_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    candidate_ids JSONB NOT NULL,
    sent_by UUID NOT NULL,
    sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
    status VARCHAR(20) NOT NULL DEFAULT 'sent',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- === ONBOARDING ===

CREATE TABLE onboarding_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE onboarding_checklist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES onboarding_templates(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    order_index INT NOT NULL
);

CREATE TABLE onboarding_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES onboarding_templates(id),
    candidate_name VARCHAR(255) NOT NULL,
    candidate_email VARCHAR(255) NOT NULL,
    candidate_phone VARCHAR(20),
    department_id UUID,
    designation_id UUID,
    source VARCHAR(50),
    candidate_id UUID,
    personal_details JSONB,
    sensitive_fields JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    converted_user_id UUID,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE onboarding_checklist_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    onboarding_id UUID NOT NULL REFERENCES onboarding_records(id) ON DELETE CASCADE,
    checklist_item_id UUID NOT NULL REFERENCES onboarding_checklist_items(id),
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    completed_by UUID,
    completed_at TIMESTAMP,
    notes TEXT,
    UNIQUE(onboarding_id, checklist_item_id)
);

-- === OFFBOARDING ===

CREATE TABLE offboarding_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE offboarding_template_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES offboarding_templates(id) ON DELETE CASCADE,
    notice_period_days INT NOT NULL DEFAULT 30,
    approval_chain JSONB NOT NULL
);

CREATE TABLE offboarding_clearances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES offboarding_templates(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    assigned_to VARCHAR(100) NOT NULL,
    order_index INT NOT NULL,
    fields JSONB
);

CREATE TABLE offboarding_exit_interview_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES offboarding_templates(id) ON DELETE CASCADE
);

CREATE TABLE exit_interview_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exit_interview_template_id UUID NOT NULL REFERENCES offboarding_exit_interview_templates(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    type VARCHAR(20) NOT NULL,
    options JSONB,
    order_index INT NOT NULL
);

CREATE TABLE offboarding_required_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES offboarding_templates(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    is_required BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE offboarding_workflow_triggers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES offboarding_templates(id) ON DELETE CASCADE,
    event VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    config JSONB
);

CREATE TABLE offboarding_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    template_id UUID NOT NULL REFERENCES offboarding_templates(id),
    type VARCHAR(20) NOT NULL,
    reason TEXT,
    last_working_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'initiated',
    current_step VARCHAR(20) NOT NULL DEFAULT 'preferences',
    approved_by UUID,
    approved_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE offboarding_clearance_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offboarding_id UUID NOT NULL REFERENCES offboarding_records(id) ON DELETE CASCADE,
    clearance_name VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    cleared_by UUID,
    cleared_at TIMESTAMP,
    notes TEXT
);

CREATE TABLE exit_interview_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offboarding_id UUID NOT NULL REFERENCES offboarding_records(id) ON DELETE CASCADE,
    question_id UUID NOT NULL,
    response TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE offboarding_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offboarding_id UUID NOT NULL REFERENCES offboarding_records(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    storage_id UUID NOT NULL,
    uploaded_by UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE data_retention_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    retention_days INT NOT NULL DEFAULT 365,
    auto_delete_enabled BOOLEAN NOT NULL DEFAULT FALSE
);

-- Create indexes for performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_employee_profiles_department ON employee_profiles(department_id);
CREATE INDEX idx_employee_profiles_designation ON employee_profiles(designation_id);
CREATE INDEX idx_employee_profiles_reports_to ON employee_profiles(reports_to);
CREATE INDEX idx_leave_requests_user ON leave_requests(user_id);
CREATE INDEX idx_leave_requests_status ON leave_requests(status);
CREATE INDEX idx_leave_balances_user_year ON leave_balances(user_id, year);
CREATE INDEX idx_time_logs_user_date ON time_logs(user_id, punch_time);
CREATE INDEX idx_daily_time_summary_user_date ON daily_time_summary(user_id, date);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_candidates_job ON candidates(job_opening_id);
CREATE INDEX idx_candidates_stage ON candidates(stage_id);
CREATE INDEX idx_goals_assigned ON goals(assigned_to_id);
