import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

// Keeps the participant routes behind the JWT guard and both app roles, and
// confirms each handler forwards to the service with the caller's id.
describe('ConversationsController', () => {
  const conversations = {
    open: jest.fn(),
    get: jest.fn(),
    postMessage: jest.fn(),
    createOffer: jest.fn(),
    acceptOffer: jest.fn(),
    declineOffer: jest.fn(),
  };
  const controller = new ConversationsController(
    conversations as unknown as ConversationsService,
  );
  const reflector = new Reflector();
  const user = { id: 'user1', role: 'CUSTOMER' } as never;

  beforeEach(() => jest.clearAllMocks());

  it('requires the JWT guard and allows customers and technicians', () => {
    const guards =
      Reflect.getMetadata(GUARDS_METADATA, ConversationsController) ?? [];

    expect(guards).toEqual([AuthGuard('jwt'), RolesGuard]);
    expect(reflector.get(ROLES_KEY, ConversationsController)).toEqual([
      'CUSTOMER',
      'TECHNICIAN',
    ]);
  });

  it('forwards the open request with the caller and job id', async () => {
    conversations.open.mockResolvedValue({ id: 'conv1' });

    await expect(controller.open(user, { jobId: 'job1' })).resolves.toEqual({
      id: 'conv1',
    });
    expect(conversations.open).toHaveBeenCalledWith('user1', 'job1');
  });

  it('forwards an offer acceptance', async () => {
    conversations.acceptOffer.mockResolvedValue({ status: 'AGREED' });

    await controller.acceptOffer(user, 'conv1', 'offer1');

    expect(conversations.acceptOffer).toHaveBeenCalledWith(
      'user1',
      'conv1',
      'offer1',
    );
  });

  it('forwards a decline with the optional reason', async () => {
    conversations.declineOffer.mockResolvedValue({ status: 'DECLINED' });

    await controller.declineOffer(user, 'conv1', 'offer1', { reason: 'Too high' });

    expect(conversations.declineOffer).toHaveBeenCalledWith(
      'user1',
      'conv1',
      'offer1',
      { reason: 'Too high' },
    );
  });
});
