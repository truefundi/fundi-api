import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminConversationsController } from './admin-conversations.controller';
import { ConversationsService } from './conversations.service';

// Keeps the admin routes behind the ADMIN role and forwards to the service.
describe('AdminConversationsController', () => {
  const conversations = {
    listForAdmin: jest.fn(),
    getForAdmin: jest.fn(),
  };
  const controller = new AdminConversationsController(
    conversations as unknown as ConversationsService,
  );
  const reflector = new Reflector();

  beforeEach(() => jest.clearAllMocks());

  it('requires the JWT guard and the ADMIN role', () => {
    const guards =
      Reflect.getMetadata(GUARDS_METADATA, AdminConversationsController) ?? [];

    expect(guards).toEqual([AuthGuard('jwt'), RolesGuard]);
    expect(reflector.get(ROLES_KEY, AdminConversationsController)).toEqual([
      'ADMIN',
    ]);
  });

  it('forwards the list query', async () => {
    const query = { status: 'NEGOTIATING' as const, page: 1, limit: 20 };
    conversations.listForAdmin.mockResolvedValue({ data: [], pagination: {} });

    await controller.list(query);

    expect(conversations.listForAdmin).toHaveBeenCalledWith(query);
  });

  it('forwards the detail lookup', async () => {
    conversations.getForAdmin.mockResolvedValue({ id: 'conv1' });

    await expect(controller.get('conv1')).resolves.toEqual({ id: 'conv1' });
    expect(conversations.getForAdmin).toHaveBeenCalledWith('conv1');
  });
});
