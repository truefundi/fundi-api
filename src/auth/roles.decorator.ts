import { SetMetadata } from '@nestjs/common';

// Attaches the roles allowed to call a controller route.
export const ROLES_KEY = 'required_roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);