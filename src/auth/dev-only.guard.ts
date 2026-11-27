import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Confines the development-only admin OTP sign-in to a developer's machine. A 404
// is answered rather than a 403 so the routes look like they were never deployed:
// there is nothing to probe for, and a client can keep calling the production API
// without special-casing a hidden endpoint. Production always refuses, whatever
// ADMIN_DEV_OTP_ENABLED says, so the flag can only ever be a convenience, never a
// back door.
@Injectable()
export class DevOnlyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(): boolean {
    const environment = this.configService.get<string>('environment');
    const enabled = this.configService.get<boolean>('adminAuth.devOtpEnabled', false);
    const isDevEnv = environment == 'development' || environment == 'test';
    if (!isDevEnv || !enabled) {
      throw new NotFoundException();
    }
    return true;
  }
}
