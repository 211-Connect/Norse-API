import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PrintableDirectoryPreviewQueryDto } from './dto';
import { PrintableDirectoryPreviewResponseDto } from './dto';
import { PrintableDirectoryService } from './printable-directory.service';
import { CustomHeaders } from 'src/common/decorators/CustomHeaders';
import { HeadersDto, headersSchema } from 'src/common/dto/headers.dto';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation-pipe';
import { ApiTenantIdQuery, ApiLocaleQuery } from 'src/common/decorators';

/**
 * Fully public, unauthenticated preview access for sharing a printable
 * directory PDF via URL. Deliberately kept separate from
 * `PrintableDirectoryController` (which is guarded by `KeycloakGuard`) so
 * that no auth bypass logic is needed on the authenticated routes.
 */
@ApiTags('Printable Directories (Public)')
@Controller({
  path: 'printable-directories/public',
  version: '1',
})
@ApiTenantIdQuery()
@ApiLocaleQuery()
export class PrintableDirectoryPublicController {
  constructor(
    private readonly printableDirectoryService: PrintableDirectoryService,
  ) {}

  @Get(':slug/preview')
  @ApiOkResponse({ type: PrintableDirectoryPreviewResponseDto })
  @ApiOperation({
    summary: 'Build printable preview payload by public slug',
    description:
      'Fully public, unauthenticated endpoint intended for sharing a printable ' +
      'directory PDF via URL. The slug acts as a capability token: resolution ' +
      'ignores accessPolicy and is not restricted to the owner or tenant ' +
      'members, so it works even for private directories. Choose a ' +
      'non-guessable slug for directories that should not be discoverable.',
  })
  preview(
    @Param('slug') slug: string,
    @Query() query: PrintableDirectoryPreviewQueryDto,
    @Req() request: Request,
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
  ): Promise<PrintableDirectoryPreviewResponseDto> {
    return this.printableDirectoryService.previewBySlug(
      slug,
      request.tenantId,
      query.locale,
      headers,
    );
  }
}
