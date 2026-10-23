import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ example: 'up', enum: ['up'] })
  status: 'up';

  @ApiProperty({
    example: 'v1.3.0',
    description:
      'The Norse-API release serving this request: its git release tag, or ' +
      '`<branch>-<commit>` for a non-release build, or `unknown` when the ' +
      'build did not record one. Not the API contract version (`x-api-version`). ' +
      'Every response also carries it in the `x-norse-api-release` header.',
  })
  release: string;

  @ApiProperty({
    example: '30048b24e37b4c1f8a2e5d6b7c8d9e0f1a2b3c4d',
    description: 'The git commit the release was built from, or `unknown`.',
  })
  commit: string;
}
