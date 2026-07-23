import { ApiProperty } from '@nestjs/swagger';
import { RESOURCE_EXAMPLE } from 'src/resource/dto/resource-examples';
import { TransformedResourceOpenApiDto } from 'src/resource/dto/transformed-resource.openapi.dto';
import { TransformedResource } from 'src/resource/types/resource-response.types';

export class PrintableDirectoryPreviewSectionResourceDto {
  @ApiProperty()
  id: string;

  @ApiProperty({
    type: TransformedResourceOpenApiDto,
    description:
      'Resolved printable-ready resource object from live resource data at preview time',
    example: RESOURCE_EXAMPLE,
  })
  resource: TransformedResource;
}
