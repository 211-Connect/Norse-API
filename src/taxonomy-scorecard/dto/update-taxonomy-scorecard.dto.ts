import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsObject, IsOptional } from 'class-validator';
import { IsStringNumberRecord } from 'src/common/dto/is-string-number-record';

export class UpdateTaxonomyScorecardDto {
  @ApiProperty({
    description: 'Need score weights to set as active configuration',
    type: 'object',
    additionalProperties: { type: 'number' },
    example: {
      'FO-200': 0.9,
      'EM-100': 0.1,
    },
  })
  @IsObject()
  @IsStringNumberRecord()
  weights: Record<string, number>;

  @ApiProperty({
    required: false,
    default: false,
    description:
      'When true, apply the same weights to selected taxonomy and all structural descendants based on taxonomy hierarchy levels',
  })
  @IsOptional()
  @IsBoolean()
  include_children?: boolean;

  @ApiProperty({
    required: false,
    default: false,
    description:
      'When true, apply the same weights to direct siblings that share the same structural parent and level',
  })
  @IsOptional()
  @IsBoolean()
  include_siblings?: boolean;

  @ApiProperty({
    required: false,
    nullable: true,
    example: 'admin@payload.local',
    description: 'Updater email for published saves. Ignored for draft saves.',
  })
  @IsOptional()
  @IsEmail()
  updated_by_email?: string;
}
