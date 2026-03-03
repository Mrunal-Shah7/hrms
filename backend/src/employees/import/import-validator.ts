export interface EmployeeImportRow {
  employee_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  department_code: string;
  designation_code: string;
  employment_type: string;
  date_of_joining: string;
  date_of_birth: string;
  reports_to_email: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  role: string;
}

export interface ValidationError {
  row: number;
  field: string;
  value: string;
  message: string;
}

export interface ImportLookupMaps {
  departmentsByCode: Map<string, string>;
  designationsByCode: Map<string, string>;
  existingEmails: Set<string>;
  existingEmployeeIds: Set<string>;
  usersByEmail: Map<string, string>;
  rolesByName: Map<string, string>;
  companyEmailDomain: string | null;
}

const REQUIRED_HEADERS = [
  'first_name',
  'last_name',
  'email',
  'department_code',
  'designation_code',
  'employment_type',
  'date_of_joining',
];

const EMPLOYMENT_TYPES = ['permanent', 'contract', 'intern', 'freelance'];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function trim(str: string): string {
  return (str ?? '').trim();
}

function parseRow(row: Record<string, string>): EmployeeImportRow {
  const get = (k: string) => trim(row[k] ?? row[k.toLowerCase?.()] ?? '');
  return {
    employee_id: get('employee_id'),
    first_name: get('first_name'),
    last_name: get('last_name'),
    email: get('email'),
    phone: get('phone'),
    department_code: get('department_code'),
    designation_code: get('designation_code'),
    employment_type: get('employment_type'),
    date_of_joining: get('date_of_joining'),
    date_of_birth: get('date_of_birth'),
    reports_to_email: get('reports_to_email'),
    emergency_contact_name: get('emergency_contact_name'),
    emergency_contact_phone: get('emergency_contact_phone'),
    role: get('role'),
  };
}

export function getNormalizedHeaders(row: string[]): string[] {
  return row.map((h) => (h ?? '').trim().toLowerCase().replace(/\s+/g, '_'));
}

export function validateHeaders(headers: string[]): { valid: boolean; missing?: string[] } {
  const normalized = new Set(headers.map((h) => h.toLowerCase()));
  const missing = REQUIRED_HEADERS.filter((h) => !normalized.has(h));
  if (missing.length > 0) {
    return { valid: false, missing };
  }
  return { valid: true };
}

export function validateEmployeeRow(
  row: EmployeeImportRow,
  rowIndex: number,
  maps: ImportLookupMaps,
  seenEmails: Map<string, number>,
  seenEmployeeIds: Map<string, number>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!row.first_name) {
    errors.push({ row: rowIndex, field: 'first_name', value: row.first_name, message: 'First name is required' });
  } else if (row.first_name.length > 100) {
    errors.push({ row: rowIndex, field: 'first_name', value: row.first_name, message: 'First name exceeds 100 characters' });
  }

  if (!row.last_name) {
    errors.push({ row: rowIndex, field: 'last_name', value: row.last_name, message: 'Last name is required' });
  } else if (row.last_name.length > 100) {
    errors.push({ row: rowIndex, field: 'last_name', value: row.last_name, message: 'Last name exceeds 100 characters' });
  }

  if (!row.email) {
    errors.push({ row: rowIndex, field: 'email', value: row.email, message: 'Email is required' });
  } else if (!EMAIL_REGEX.test(row.email)) {
    errors.push({ row: rowIndex, field: 'email', value: row.email, message: 'Invalid email format' });
  } else {
    const emailLower = row.email.toLowerCase();
    const prevRow = seenEmails.get(emailLower);
    if (prevRow !== undefined) {
      errors.push({ row: rowIndex, field: 'email', value: row.email, message: `Duplicate email in file (row ${prevRow})` });
    } else if (maps.existingEmails.has(emailLower)) {
      errors.push({ row: rowIndex, field: 'email', value: row.email, message: 'Email already exists in the system' });
    } else {
      seenEmails.set(emailLower, rowIndex);
    }
  }

  if (row.phone && row.phone.length > 20) {
    errors.push({ row: rowIndex, field: 'phone', value: row.phone, message: 'Phone exceeds 20 characters' });
  }

  if (!row.department_code) {
    errors.push({ row: rowIndex, field: 'department_code', value: row.department_code, message: 'Department code is required' });
  } else {
    const codeKey = row.department_code.toUpperCase().trim();
    if (!maps.departmentsByCode.has(codeKey)) {
      errors.push({ row: rowIndex, field: 'department_code', value: row.department_code, message: `Department code '${row.department_code}' not found` });
    }
  }

  if (!row.designation_code) {
    errors.push({ row: rowIndex, field: 'designation_code', value: row.designation_code, message: 'Designation code is required' });
  } else {
    const codeKey = row.designation_code.toUpperCase().trim();
    if (!maps.designationsByCode.has(codeKey)) {
      errors.push({ row: rowIndex, field: 'designation_code', value: row.designation_code, message: `Designation code '${row.designation_code}' not found` });
    }
  }

  if (!row.employment_type) {
    errors.push({ row: rowIndex, field: 'employment_type', value: row.employment_type, message: 'Employment type is required' });
  } else if (!EMPLOYMENT_TYPES.includes(row.employment_type.toLowerCase())) {
    errors.push({ row: rowIndex, field: 'employment_type', value: row.employment_type, message: 'Invalid employment type. Must be: permanent, contract, intern, or freelance' });
  }

  if (!row.date_of_joining) {
    errors.push({ row: rowIndex, field: 'date_of_joining', value: row.date_of_joining, message: 'Date of joining is required' });
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date_of_joining) || isNaN(Date.parse(row.date_of_joining))) {
    errors.push({ row: rowIndex, field: 'date_of_joining', value: row.date_of_joining, message: 'Invalid date format. Use YYYY-MM-DD' });
  }

  if (row.date_of_birth) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date_of_birth) || isNaN(Date.parse(row.date_of_birth))) {
      errors.push({ row: rowIndex, field: 'date_of_birth', value: row.date_of_birth, message: 'Invalid date format' });
    } else if (new Date(row.date_of_birth) >= new Date()) {
      errors.push({ row: rowIndex, field: 'date_of_birth', value: row.date_of_birth, message: 'Date of birth must be in the past' });
    }
  }

  if (row.reports_to_email) {
    const emailLower = row.reports_to_email.toLowerCase();
    if (!maps.usersByEmail.has(emailLower)) {
      errors.push({ row: rowIndex, field: 'reports_to_email', value: row.reports_to_email, message: `Manager with email '${row.reports_to_email}' not found or inactive` });
    }
  }

  if (row.emergency_contact_name && row.emergency_contact_name.length > 255) {
    errors.push({ row: rowIndex, field: 'emergency_contact_name', value: row.emergency_contact_name, message: 'Emergency contact name exceeds 255 characters' });
  }

  if (row.emergency_contact_phone && row.emergency_contact_phone.length > 20) {
    errors.push({ row: rowIndex, field: 'emergency_contact_phone', value: row.emergency_contact_phone, message: 'Emergency contact phone exceeds 20 characters' });
  }

  if (row.employee_id) {
    if (row.employee_id.length > 50) {
      errors.push({ row: rowIndex, field: 'employee_id', value: row.employee_id, message: 'Employee ID exceeds 50 characters' });
    } else {
      const prevRow = seenEmployeeIds.get(row.employee_id);
      if (prevRow !== undefined) {
        errors.push({ row: rowIndex, field: 'employee_id', value: row.employee_id, message: `Duplicate employee ID in file (row ${prevRow})` });
      } else if (maps.existingEmployeeIds.has(row.employee_id)) {
        errors.push({ row: rowIndex, field: 'employee_id', value: row.employee_id, message: 'Employee ID already exists in the system' });
      } else {
        seenEmployeeIds.set(row.employee_id, rowIndex);
      }
    }
  }

  if (row.role) {
    const roles = row.role.split(';').map((r) => r.trim()).filter(Boolean);
    for (const roleName of roles) {
      const key = roleName.toLowerCase();
      if (!maps.rolesByName.has(key)) {
        errors.push({ row: rowIndex, field: 'role', value: row.role, message: `Role '${roleName}' not found` });
        break;
      }
    }
  }

  return errors;
}

export function mapCsvRecordToRow(record: Record<string, string>, headerMap: Map<string, string>): Record<string, string> {
  const row: Record<string, string> = {};
  for (const [origKey, canonicalKey] of headerMap) {
    row[canonicalKey] = record[origKey] ?? '';
  }
  return row;
}

export function parseRowToEmployee(row: Record<string, string>): EmployeeImportRow {
  return parseRow(row);
}
