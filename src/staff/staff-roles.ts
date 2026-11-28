import { UserRole } from '@prisma/client';

export const STAFF_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.SUPPORT,
];

export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(role: unknown): role is StaffRole {
  return STAFF_ROLES.includes(role as StaffRole);
}
