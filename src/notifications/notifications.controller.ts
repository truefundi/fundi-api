import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { ListNotificationsQueryDto } from './dto/list-notifications.query.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@Controller('api/v1/notifications')
@Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN, UserRole.ADMIN)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListNotificationsQueryDto) {
    return this.notifications.list(user.id, {
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
      unreadOnly: query.unreadOnly,
    });
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user.id);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Patch(':notificationId/read')
  markRead(
    @CurrentUser() user: AuthUser,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
  ) {
    return this.notifications.markRead(user.id, notificationId);
  }
}
