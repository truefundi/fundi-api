import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PhoneDto } from './phone.dto';

// Defines the identity and non-admin role fields accepted during registration.
export class RegisterDto extends PhoneDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.toUpperCase() : value)
  @IsIn(['CUSTOMER', 'TECHNICIAN'])
  role?: 'CUSTOMER' | 'TECHNICIAN';
}