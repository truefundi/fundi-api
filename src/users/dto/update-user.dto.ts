import { PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

// Makes all administrator-managed creation fields optional for updates.
export class UpdateUserDto extends PartialType(CreateUserDto) {}