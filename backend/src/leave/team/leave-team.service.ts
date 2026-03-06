import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantInfo } from '../../tenant/tenant.interface';

@Injectable()
export class LeaveTeamService {
  constructor(private readonly prisma: PrismaService) {}

  async getTeamOnLeave(
    tenant: TenantInfo,
    date: string,
    departmentId?: string,
  ) {
    const schemaName = tenant.schemaName;
    const d = date || new Date().toISOString().slice(0, 10);
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      let sql = `
        SELECT u.id, u.employee_id, u.first_name, u.last_name, u.photo_url,
               d.name AS department_name, des.name AS designation_name,
               lt.name AS leave_type_name, lt.color AS leave_type_color,
               lr.start_date, lr.end_date, lr.duration_type, lr.total_days
        FROM leave_requests lr
        JOIN users u ON lr.user_id = u.id
        JOIN leave_types lt ON lr.leave_type_id = lt.id
        LEFT JOIN employee_profiles ep ON u.id = ep.user_id
        LEFT JOIN departments d ON ep.department_id = d.id
        LEFT JOIN designations des ON ep.designation_id = des.id
        WHERE lr.status = 'approved'
          AND $1::date BETWEEN lr.start_date AND lr.end_date
          AND u.status = 'active'
      `;
      const params: unknown[] = [d];
      if (departmentId) {
        sql += ` AND ep.department_id = $2`;
        params.push(departmentId);
      }
      sql += ` ORDER BY u.first_name, u.last_name`;
      const rows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          employee_id: string | null;
          first_name: string;
          last_name: string;
          photo_url: string | null;
          department_name: string | null;
          designation_name: string | null;
          leave_type_name: string;
          leave_type_color: string | null;
          start_date: Date;
          end_date: Date;
          duration_type: string;
          total_days: number;
        }>
      >(sql, ...params);
      return rows.map((r) => ({
        employee: {
          id: r.id,
          employeeId: r.employee_id,
          firstName: r.first_name,
          lastName: r.last_name,
          photoUrl: r.photo_url,
          department: r.department_name,
          designation: r.designation_name,
        },
        leaveType: { name: r.leave_type_name, color: r.leave_type_color },
        startDate: r.start_date,
        endDate: r.end_date,
        durationType: r.duration_type,
        totalDays: r.total_days,
      }));
    });
  }

  async getReporteesOnLeave(tenant: TenantInfo, userId: string, date: string) {
    const schemaName = tenant.schemaName;
    const d = date || new Date().toISOString().slice(0, 10);
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          employee_id: string | null;
          first_name: string;
          last_name: string;
          photo_url: string | null;
          department_name: string | null;
          designation_name: string | null;
          leave_type_name: string;
          leave_type_color: string | null;
          start_date: Date;
          end_date: Date;
          duration_type: string;
          total_days: number;
        }>
      >(
        `SELECT u.id, u.employee_id, u.first_name, u.last_name, u.photo_url,
                d.name AS department_name, des.name AS designation_name,
                lt.name AS leave_type_name, lt.color AS leave_type_color,
                lr.start_date, lr.end_date, lr.duration_type, lr.total_days
         FROM leave_requests lr
         JOIN users u ON lr.user_id = u.id
         JOIN employee_profiles ep ON u.id = ep.user_id AND ep.reports_to = $1
         JOIN leave_types lt ON lr.leave_type_id = lt.id
         LEFT JOIN departments d ON ep.department_id = d.id
         LEFT JOIN designations des ON ep.designation_id = des.id
         WHERE lr.status = 'approved'
           AND $2::date BETWEEN lr.start_date AND lr.end_date
           AND u.status = 'active'
         ORDER BY u.first_name, u.last_name`,
        userId,
        d,
      );
      return rows.map((r) => ({
        employee: {
          id: r.id,
          employeeId: r.employee_id,
          firstName: r.first_name,
          lastName: r.last_name,
          photoUrl: r.photo_url,
          department: r.department_name,
          designation: r.designation_name,
        },
        leaveType: { name: r.leave_type_name, color: r.leave_type_color },
        startDate: r.start_date,
        endDate: r.end_date,
        durationType: r.duration_type,
        totalDays: r.total_days,
      }));
    });
  }
}
