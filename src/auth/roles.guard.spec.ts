import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

// Exercises the role gate every admin users route relies on: CUSTOMER and
// TECHNICIAN callers must receive a 403 before any controller code runs.
describe('RolesGuard', () => {
  const createGuard = (requiredRoles: string[]) => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
    } as unknown as Reflector;
    return new RolesGuard(reflector);
  };

  // Minimal execution context whose request carries an optional authenticated user.
  const createContext = (role?: string): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => (role ? { user: { role } } : {}),
      }),
      getHandler: () => undefined,
      getClass: () => class {},
    }) as unknown as ExecutionContext;

  it('allows any caller when the route requires no role', () => {
    expect(createGuard([]).canActivate(createContext())).toBe(true);
  });

  it('allows an ADMIN user', () => {
    expect(createGuard(['ADMIN']).canActivate(createContext('ADMIN'))).toBe(true);
  });

  it('rejects a CUSTOMER user with 403', () => {
    expect(() => createGuard(['ADMIN']).canActivate(createContext('CUSTOMER'))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a TECHNICIAN user with 403', () => {
    expect(() => createGuard(['ADMIN']).canActivate(createContext('TECHNICIAN'))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects an unauthenticated request', () => {
    expect(() => createGuard(['ADMIN']).canActivate(createContext())).toThrow(
      ForbiddenException,
    );
  });
});
