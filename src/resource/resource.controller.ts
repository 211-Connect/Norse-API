import { Controller, Get, Param } from '@nestjs/common';
import { ResourceService } from './resource.service';
import { ApiTags } from '@nestjs/swagger';
import { CustomHeaders } from 'src/common/decorators/CustomHeaders';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation-pipe';
import { HeadersDto, headersSchema } from 'src/common/dto/headers.dto';

@ApiTags('Resource')
@Controller('resource')
export class ResourceController {
  constructor(private readonly resourceService: ResourceService) {}

  @Get(':id')
  getResourceById(
    @Param('id') id,
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
  ) {
    return this.resourceService.findById(id, {
      headers,
    });
  }
}
