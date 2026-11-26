import 'reflect-metadata';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ROLES_KEY } from '../auth/roles.decorator';
import { PERMISSIONS_KEY } from './permissions.guard';
import { isStaffRole } from './staff-roles';
import { PERMISSION_KEYS } from './permission-catalog';

function controllerFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? controllerFiles(path)
      : entry.name.endsWith('.controller.ts')
        ? [path]
        : [];
  });
}

describe('Administrative route permission coverage', () => {
  const routes = controllerFiles(join(__dirname, '..')).flatMap((file) => {
    const exports = require(file) as Record<
      string,
      (new (...args: never[]) => unknown) & {
        name: string;
        prototype: Record<string, unknown>;
      }
    >;
    return Object.values(exports)
      .filter(
        (value) =>
          typeof value === 'function' &&
          Reflect.hasMetadata(PATH_METADATA, value),
      )
      .flatMap((controller) => {
        return Object.getOwnPropertyNames(controller.prototype)
          .filter((name) => name !== 'constructor')
          .flatMap((name) => {
            const handler = controller.prototype[name];
            if (
              typeof handler !== 'function' ||
              !Reflect.hasMetadata(METHOD_METADATA, handler)
            )
              return [];
            const roles: string[] =
              Reflect.getMetadata(ROLES_KEY, handler) ??
              Reflect.getMetadata(ROLES_KEY, controller) ??
              [];
            if (!roles.some(isStaffRole)) return [];
            return [
              {
                label: `${controller.name}.${name}`,
                permissions:
                  Reflect.getMetadata(PERMISSIONS_KEY, handler) ??
                  Reflect.getMetadata(PERMISSIONS_KEY, controller),
                method: Reflect.getMetadata(METHOD_METADATA, handler),
              },
            ];
          });
      });
  });

  it('covers the complete staff API surface', () =>
    expect(routes.length).toBeGreaterThan(90));
  it.each(routes)(
    '$label has explicit known permissions',
    ({ permissions }) => {
      expect(Array.isArray(permissions)).toBe(true);
      for (const key of permissions) expect(PERMISSION_KEYS).toContain(key);
    },
  );
  it.each(
    routes.filter(
      (route) =>
        route.method !== RequestMethod.GET &&
        ![
          'AdminBroadcastsController.preview',
          'AdminAuthController.changePassword',
          'NotificationsController.markRead',
          'NotificationsController.markAllRead',
        ].includes(route.label),
    ),
  )('$label cannot mutate with only a view grant', ({ permissions }) => {
    expect(permissions.some((key: string) => !key.endsWith('.view'))).toBe(
      true,
    );
  });
});
