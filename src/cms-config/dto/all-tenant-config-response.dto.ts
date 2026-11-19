import { ApiProperty } from '@nestjs/swagger';
import {
  FacetConfig,
  OrchestrationConfigCache,
  SearchConfigCache,
} from '../types';
import { PublicAppConfigResponseDto } from './public-app-config-response.dto';
import { SuggestionsConfigResponseDto } from './suggestions-config-response.dto';
import { TopicsConfigResponseDto } from './topics-config-response.dto';

export class AllTenantConfigResponseDto {
  @ApiProperty({ type: [String], example: ['en', 'es'] })
  locales: string[];

  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        facet: { type: 'string', example: 'age_groups' },
        name: { type: 'string', example: 'Age Groups' },
      },
      additionalProperties: { type: 'string' },
    },
    description: 'Facets configuration with localized names keyed by locale',
  })
  facets: FacetConfig[];

  @ApiProperty({ type: TopicsConfigResponseDto })
  topics: TopicsConfigResponseDto;

  @ApiProperty({ type: SuggestionsConfigResponseDto })
  suggestions: SuggestionsConfigResponseDto;

  @ApiProperty({
    type: 'object',
    required: false,
    nullable: true,
    description: 'Hybrid search configuration',
  })
  hybridSearchConfig?: SearchConfigCache | null;

  @ApiProperty({
    type: 'object',
    required: false,
    nullable: true,
    description: 'Orchestration configuration',
  })
  orchestrationConfig?: OrchestrationConfigCache | null;

  @ApiProperty({
    type: PublicAppConfigResponseDto,
    required: false,
    nullable: true,
    description:
      'Branding, menus, legal page switches, alerts, i18n and map view, as PayloadCMS publishes them for the requested locale (`?locale=`, default en, falling back to en). Null when the tenant has none, e.g. its resource directory is off',
  })
  appConfig?: PublicAppConfigResponseDto | null;
}
