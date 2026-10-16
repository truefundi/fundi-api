import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DevOnlyGuard } from './dev-only.guard';

// The dev-only admin OTP sign-in must be unreachable anywhere but a development
// machine. These cases pin the two independent reasons it is refused, so neither a
// stray flag nor a production build on its own can open it.
describe('DevOnlyGuard', () => {
  const createGuard = (environment: string, enabled: boolean) => {
    const config = {
      get: jest.fn((key: string, fallback: unknown) => {
        if (key === 'environment') return environment;
        if (key === 'adminAuth.devOtpEnabled') return enabled;
        return fallback;
      }),
    } as unknown as ConfigService;
    return new DevOnlyGuard(config);
  };

  it('allows a development server with the flag on', () => {
    expect(createGuard('development', true).canActivate()).toBe(true);
  });

  it('refuses in production even when the flag is on', () => {
    expect(() => createGuard('production', true).canActivate()).toThrow(NotFoundException);
  });

  it('refuses when the flag is off, whatever the environment', () => {
    expect(() => createGuard('development', false).canActivate()).toThrow(NotFoundException);
    expect(() => createGuard('test', false).canActivate()).toThrow(NotFoundException);
  });

  // A 404 is deliberate: the route should look like it does not exist rather than
  // reveal that a dev-only door is present but shut.
  it('answers 404 rather than 403', () => {
    try {
      createGuard('production', true).canActivate();
    } catch (error) {
      expect((error as NotFoundException).getStatus()).toBe(404);
    }
  });
});
