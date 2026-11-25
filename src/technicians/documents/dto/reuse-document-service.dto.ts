import { IsUUID } from 'class-validator';

export class ReuseDocumentServiceDto {
  @IsUUID('4')
  categoryId!: string;
}
