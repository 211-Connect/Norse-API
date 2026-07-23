import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { User } from 'src/common/decorators/User';
import { KeycloakGuard } from 'src/auth/guards/keycloak.guard';
import {
  CreatePrintableDirectoryDto,
  CreatePrintableDirectorySectionDto,
  CreatePrintableDirectorySourceDto,
  PrintableDirectoriesListQueryDto,
  PrintableDirectoryPreviewQueryDto,
  ReorderPrintableDirectorySectionsDto,
  ReorderPrintableDirectorySourcesDto,
  UpdatePrintableDirectoryDto,
  UpdatePrintableDirectorySectionDto,
  UpdatePrintableDirectorySourceDto,
} from './dto';
import {
  PrintableDirectoryListResponseDto,
  PrintableDirectoryPreviewResponseDto,
  PrintableDirectoryResponseDto,
} from './dto';
import { PrintableDirectoryService } from './printable-directory.service';
import { CustomHeaders } from 'src/common/decorators/CustomHeaders';
import { HeadersDto, headersSchema } from 'src/common/dto/headers.dto';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation-pipe';
import { ApiTenantIdQuery, ApiLocaleQuery } from 'src/common/decorators';

@ApiTags('Printable Directories')
@ApiExtraModels(
  CreatePrintableDirectorySourceDto,
  UpdatePrintableDirectorySourceDto,
)
@UseGuards(KeycloakGuard)
@Controller({
  path: 'printable-directories',
  version: '1',
})
@ApiTenantIdQuery()
@ApiLocaleQuery()
export class PrintableDirectoryController {
  constructor(
    private readonly printableDirectoryService: PrintableDirectoryService,
  ) {}

  @Get()
  @ApiOkResponse({ type: PrintableDirectoryListResponseDto })
  @ApiOperation({
    summary: 'List printable directories',
    description:
      'Returns paginated printable directories for the authenticated user in the current tenant.',
  })
  list(
    @Query() query: PrintableDirectoriesListQueryDto,
    @Req() request: Request,
    @User() user: User,
  ): Promise<PrintableDirectoryListResponseDto> {
    return this.printableDirectoryService.list(query, {
      tenantId: request.tenantId,
      userId: user.id,
    });
  }

  @Post()
  @ApiCreatedResponse({ type: PrintableDirectoryResponseDto })
  create(
    @Body() payload: CreatePrintableDirectoryDto,
    @Req() request: Request,
    @User() user: User,
  ): Promise<PrintableDirectoryResponseDto> {
    return this.printableDirectoryService.create(payload, {
      tenantId: request.tenantId,
      userId: user.id,
    });
  }

  @Get(':id')
  @ApiOkResponse({ type: PrintableDirectoryResponseDto })
  @ApiOperation({
    summary: 'Get printable directory',
    description:
      'Access policy is enforced by directory configuration: private, shared-read, or shared-edit.',
  })
  getById(
    @Param('id') id: string,
    @Req() request: Request,
    @User() user: User,
  ): Promise<PrintableDirectoryResponseDto> {
    return this.printableDirectoryService.getById(id, {
      tenantId: request.tenantId,
      userId: user.id,
    });
  }

  @Patch(':id')
  @ApiOkResponse({ type: PrintableDirectoryResponseDto })
  update(
    @Param('id') id: string,
    @Body() payload: UpdatePrintableDirectoryDto,
    @Req() request: Request,
    @User() user: User,
  ): Promise<PrintableDirectoryResponseDto> {
    return this.printableDirectoryService.update(id, payload, {
      tenantId: request.tenantId,
      userId: user.id,
    });
  }

  @Delete(':id')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
      },
    },
  })
  async remove(
    @Param('id') id: string,
    @Req() request: Request,
    @User() user: User,
  ): Promise<{ success: true }> {
    await this.printableDirectoryService.remove(id, {
      tenantId: request.tenantId,
      userId: user.id,
    });
    return { success: true };
  }

  @Post(':id/sections')
  @ApiCreatedResponse({ type: PrintableDirectoryResponseDto })
  createSection(
    @Param('id') id: string,
    @Body() payload: CreatePrintableDirectorySectionDto,
    @Req() request: Request,
    @User() user: User,
  ): Promise<PrintableDirectoryResponseDto> {
    return this.printableDirectoryService.createSection(id, payload, {
      tenantId: request.tenantId,
      userId: user.id,
    });
  }

  @Patch(':id/sections/reorder')
  @ApiOkResponse({ type: PrintableDirectoryResponseDto })
  reorderSections(
    @Param('id') id: string,
    @Body() payload: ReorderPrintableDirectorySectionsDto,
    @Req() request: Request,
    @User() user: User,
  ): Promise<PrintableDirectoryResponseDto> {
    return this.printableDirectoryService.reorderSections(id, payload, {
      tenantId: request.tenantId,
      userId: user.id,
    });
  }

  @Patch(':id/sections/:sectionId')
  @ApiOkResponse({ type: PrintableDirectoryResponseDto })
  updateSection(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @Body() payload: UpdatePrintableDirectorySectionDto,
    @Req() request: Request,
    @User() user: User,
  ): Promise<PrintableDirectoryResponseDto> {
    return this.printableDirectoryService.updateSection(
      id,
      sectionId,
      payload,
      {
        tenantId: request.tenantId,
        userId: user.id,
      },
    );
  }

  @Delete(':id/sections/:sectionId')
  @ApiOkResponse({ type: PrintableDirectoryResponseDto })
  removeSection(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @Req() request: Request,
    @User() user: User,
  ): Promise<PrintableDirectoryResponseDto> {
    return this.printableDirectoryService.removeSection(id, sectionId, {
      tenantId: request.tenantId,
      userId: user.id,
    });
  }

  @Post(':id/sections/:sectionId/sources')
  @ApiBody({
    schema: {
      oneOf: [
        {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['query'], example: 'query' },
            query: {
              type: 'object',
              properties: {
                title: { type: 'string', example: 'Shelter search' },
                params: {
                  type: 'object',
                  example: {
                    query: 'shelter',
                    query_type: 'text',
                    page: 1,
                    limit: 25,
                  },
                },
              },
              required: ['params'],
            },
          },
          required: ['type', 'query'],
        },
        {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['favorites_list'],
              example: 'favorites_list',
            },
            favoritesListId: { type: 'string', example: 'favorite-list-id' },
          },
          required: ['type', 'favoritesListId'],
        },
        {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['resource_ids'],
              example: 'resource_ids',
            },
            resourceIds: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              example: ['resource-1', 'resource-2'],
            },
          },
          required: ['type', 'resourceIds'],
        },
      ],
    },
  })
  @ApiCreatedResponse({ type: PrintableDirectoryResponseDto })
  createSource(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @Body() payload: CreatePrintableDirectorySourceDto,
    @Req() request: Request,
    @User() user: User,
  ): Promise<PrintableDirectoryResponseDto> {
    return this.printableDirectoryService.createSource(id, sectionId, payload, {
      tenantId: request.tenantId,
      userId: user.id,
    });
  }

  @Patch(':id/sections/:sectionId/sources/reorder')
  @ApiOkResponse({ type: PrintableDirectoryResponseDto })
  reorderSources(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @Body() payload: ReorderPrintableDirectorySourcesDto,
    @Req() request: Request,
    @User() user: User,
  ): Promise<PrintableDirectoryResponseDto> {
    return this.printableDirectoryService.reorderSources(
      id,
      sectionId,
      payload,
      {
        tenantId: request.tenantId,
        userId: user.id,
      },
    );
  }

  @Patch(':id/sections/:sectionId/sources/:sourceId')
  @ApiOkResponse({ type: PrintableDirectoryResponseDto })
  updateSource(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @Param('sourceId') sourceId: string,
    @Body() payload: UpdatePrintableDirectorySourceDto,
    @Req() request: Request,
    @User() user: User,
  ): Promise<PrintableDirectoryResponseDto> {
    return this.printableDirectoryService.updateSource(
      id,
      sectionId,
      sourceId,
      payload,
      {
        tenantId: request.tenantId,
        userId: user.id,
      },
    );
  }

  @Delete(':id/sections/:sectionId/sources/:sourceId')
  @ApiOkResponse({ type: PrintableDirectoryResponseDto })
  removeSource(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @Param('sourceId') sourceId: string,
    @Req() request: Request,
    @User() user: User,
  ): Promise<PrintableDirectoryResponseDto> {
    return this.printableDirectoryService.removeSource(
      id,
      sectionId,
      sourceId,
      {
        tenantId: request.tenantId,
        userId: user.id,
      },
    );
  }

  @Get(':id/preview')
  @ApiOkResponse({ type: PrintableDirectoryPreviewResponseDto })
  @ApiOperation({
    summary: 'Build printable preview payload',
    description:
      'Resolves all section resources fresh at request time. No resource snapshots are persisted in directory documents.',
  })
  preview(
    @Param('id') id: string,
    @Query() query: PrintableDirectoryPreviewQueryDto,
    @Req() request: Request,
    @User() user: User,
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
  ): Promise<PrintableDirectoryPreviewResponseDto> {
    return this.printableDirectoryService.preview(id, query.locale, headers, {
      tenantId: request.tenantId,
      userId: user.id,
    });
  }
}
