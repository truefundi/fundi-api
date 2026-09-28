import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('dummy-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate development JWT tokens foundation' })
  @ApiResponse({ status: 200, description: 'Tokens issued successfully' })
  async generateDummyToken(@Body() body: { userId?: string; email?: string; role?: string }) {
    const userId = body.userId || 'dev-user-id';
    const email = body.email || 'dev@fundi.com';
    const role = body.role || 'CUSTOMER';

    return this.authService.generateTokens(userId, email, role);
  }
}
