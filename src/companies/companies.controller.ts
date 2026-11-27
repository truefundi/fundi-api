import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Auth, AuthUser, CurrentUser } from '../common/decorators/auth.decorator';
import {
  CreateAdminCompanyDto,
  UpdateCompanyDto,
  UpdateCompanyVerificationDto,
} from './dto/company.dto';
import { ListCompaniesDto } from './dto/list-companies.dto';
import { CompaniesService } from './companies.service';

@Controller('api/v1')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get('companies/mine')
  @Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN)
  getMine(@CurrentUser() user: AuthUser) {
    return this.companies.getMine(user.id);
  }

  @Patch('companies/mine')
  @Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN)
  updateMine(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companies.updateMine(user.id, dto);
  }

  @Get('admin/companies')
  @Auth(UserRole.ADMIN)
  listForAdmin(@Query() query: ListCompaniesDto) {
    return this.companies.listForAdmin(query);
  }

  @Post('admin/companies')
  @Auth(UserRole.ADMIN)
  createByAdmin(
    @Body() dto: CreateAdminCompanyDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.companies.createByAdmin(dto, user.id);
  }

  @Get('admin/companies/:id')
  @Auth(UserRole.ADMIN)
  getForAdmin(@Param('id', ParseUUIDPipe) id: string) {
    return this.companies.getForAdmin(id);
  }

  @Patch('admin/companies/:id')
  @Auth(UserRole.ADMIN)
  updateByAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.companies.updateByAdmin(id, dto, user.id);
  }

  @Patch('admin/companies/:id/verification-status')
  @Auth(UserRole.ADMIN)
  updateVerification(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyVerificationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.companies.updateVerification(id, dto, user.id);
  }

  @Delete('admin/companies/:id')
  @Auth(UserRole.ADMIN)
  deleteByAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.companies.deleteByAdmin(id, user.id);
  }
}
