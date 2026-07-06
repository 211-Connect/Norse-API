import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  TaxonomyScorecard,
  TaxonomyScorecardDocument,
  TaxonomySource,
} from 'src/common/schemas/taxonomy-scorecard.schema';
import { SearchScorecardTaxonomiesQueryDto } from './dto/search-scorecard-taxonomies-query.dto';
import { SearchScorecardTaxonomiesResponseDto } from './dto/search-scorecard-taxonomies-response.dto';
import { UpdateTaxonomyScorecardDto } from './dto/update-taxonomy-scorecard.dto';
import { EnableTaxonomyScorecardDto } from './dto/enable-taxonomy-scorecard.dto';
import { UpdateTaxonomyScorecardResponseDto } from './dto/update-taxonomy-scorecard-response.dto';
import { TaxonomyScorecardResponseDto } from './dto/taxonomy-scorecard-response.dto';
import {
  buildDocumentId,
  cloneScorecardPayload,
  cloneSource,
  createVersionEntry,
  DEFAULT_SCORECARD_OWNER,
  deriveNeedMetadata,
  getTaxonomyChildPrefix,
  getTaxonomyParentCode,
  getNextVersionId,
  isDirectTaxonomySibling,
  isTaxonomyDescendantOrSelf,
} from './taxonomy-scorecard.utils';

type TaxonomyHitSource = {
  code?: string;
  name?: string;
};

const HYBRID_TAXONOMIES_INDEX = 'hybrid_taxonomies';

@Injectable()
export class TaxonomyScorecardService {
  private readonly logger = new Logger(TaxonomyScorecardService.name);

  constructor(
    @InjectModel(TaxonomyScorecard.name)
    private readonly taxonomyScorecardModel: Model<TaxonomyScorecardDocument>,
    private readonly elasticsearchService: ElasticsearchService,
  ) {}

  async searchTaxonomies(
    query: SearchScorecardTaxonomiesQueryDto,
  ): Promise<SearchScorecardTaxonomiesResponseDto> {
    const normalizedQuery = query.query.trim();
    if (!normalizedQuery) {
      throw new BadRequestException('query must not be empty');
    }

    const from = (query.page - 1) * query.limit;

    const baseSearchRequest = {
      index: HYBRID_TAXONOMIES_INDEX,
      from,
      size: query.limit,
      _source: ['code', 'name'],
      sort: [{ code: { order: 'asc' } }],
      query: {
        bool: {
          filter: [{ term: { tenant_id: query.tenant_id } }],
          should: [
            {
              prefix: {
                code: { value: normalizedQuery, case_insensitive: true },
              },
            },
            { match_phrase_prefix: { name: { query: normalizedQuery } } },
          ],
          minimum_should_match: 1,
        },
      },
    };

    const esResponse =
      await this.elasticsearchService.search<TaxonomyHitSource>({
        ...baseSearchRequest,
      });

    const total =
      typeof esResponse.hits.total === 'number'
        ? esResponse.hits.total
        : (esResponse.hits.total?.value ?? 0);

    const items = (esResponse.hits.hits || [])
      .map((hit) => ({
        code: hit._source?.code,
        name: hit._source?.name,
      }))
      .filter(
        (item): item is { code: string; name: string } =>
          typeof item.code === 'string' && typeof item.name === 'string',
      );

    return {
      total,
      page: query.page,
      limit: query.limit,
      items,
    };
  }

  async getTaxonomyConfiguration(
    tenantId: string,
    hsisCode: string,
  ): Promise<TaxonomyScorecardResponseDto> {
    const { document } = await this.resolveEffectiveDocument(
      tenantId,
      hsisCode,
    );

    return this.toResponse(document);
  }

  async updateTaxonomyConfiguration(
    tenantId: string,
    hsisCode: string,
    payload: UpdateTaxonomyScorecardDto,
    draft = false,
  ): Promise<UpdateTaxonomyScorecardResponseDto> {
    const affectedCodes = await this.resolveAffectedCodes({
      tenantId,
      hsisCode,
      includeChildren: Boolean(payload.include_children),
      includeSiblings: Boolean(payload.include_siblings),
    });

    const uniqueCodes = Array.from(new Set(affectedCodes));
    const nowIso = new Date().toISOString();
    const versionCreatedByEmail = draft
      ? null
      : (payload.updated_by_email ?? null);

    for (const code of uniqueCodes) {
      const { document } = await this.resolveEffectiveDocument(tenantId, code);

      const tenantDocument = await this.ensureTenantDocument({
        tenantId,
        hsisCode: code,
        nowIso,
        seed: document,
      });

      const versions = { ...(tenantDocument.versions ?? {}) };
      const baseVersionId = getNextVersionId(
        versions,
        tenantDocument.version_metadata,
      );
      let nextVersionId = baseVersionId;

      const nextScorecard = {
        ...cloneScorecardPayload(tenantDocument.scorecard),
        need: deriveNeedMetadata(payload.weights),
      };
      const nextSource = this.patchSourceMetadata({
        source: tenantDocument.source,
        owner: tenantId,
        publishedAt: nowIso,
      });

      const hasAnyVersion = Object.keys(versions).length > 0;
      const hasActiveVersion =
        tenantDocument.version_metadata?.active_version !== null &&
        tenantDocument.version_metadata?.active_version !== undefined;

      if (!hasAnyVersion && !hasActiveVersion) {
        versions[String(nextVersionId)] = createVersionEntry({
          document: tenantDocument,
          nowIso,
          scorecard: tenantDocument.scorecard,
          source: tenantDocument.source,
          createdByEmail: versionCreatedByEmail,
        });
        nextVersionId += 1;
      }

      versions[String(nextVersionId)] = createVersionEntry({
        document: tenantDocument,
        nowIso,
        scorecard: nextScorecard,
        source: nextSource,
        createdByEmail: versionCreatedByEmail,
      });

      tenantDocument.versions = versions;
      tenantDocument.version_metadata = {
        next_version: nextVersionId + 1,
        active_version: draft
          ? (tenantDocument.version_metadata?.active_version ?? null)
          : nextVersionId,
        last_action: 'update',
      };

      if (!draft) {
        tenantDocument.scorecard = nextScorecard;
      }
      tenantDocument.components_available = Array.from(
        new Set([...(tenantDocument.components_available ?? []), 'need']),
      );
      if (!draft) {
        tenantDocument.source = nextSource;
        tenantDocument.updated_by_email = payload.updated_by_email ?? null;
      }
      tenantDocument.updated_at = nowIso;

      await tenantDocument.save();
    }

    return {
      tenant_id: tenantId,
      affected_codes: draft ? [] : uniqueCodes,
      potentially_affected_codes: draft ? uniqueCodes : undefined,
      new_version_count: uniqueCodes.length,
    };
  }

  async enableTaxonomyScorecardVersion(
    tenantId: string,
    hsisCode: string,
    payload: EnableTaxonomyScorecardDto,
  ): Promise<TaxonomyScorecardResponseDto> {
    const tenantDocument = await this.findScorecardByOwner(hsisCode, tenantId);

    if (!tenantDocument) {
      throw new NotFoundException(
        `Tenant scorecard configuration not found for ${hsisCode}`,
      );
    }

    const versionEntry = tenantDocument.versions?.[String(payload.version_id)];
    if (!versionEntry) {
      throw new NotFoundException(
        `Version ${payload.version_id} not found for ${hsisCode}`,
      );
    }

    const nowIso = new Date().toISOString();

    tenantDocument.scorecard = cloneScorecardPayload(versionEntry.scorecard);
    tenantDocument.source = this.patchSourceMetadata({
      source: tenantDocument.source,
      owner: tenantId,
      publishedAt: nowIso,
    });
    tenantDocument.version_metadata = {
      next_version: getNextVersionId(
        tenantDocument.versions,
        tenantDocument.version_metadata,
      ),
      active_version: payload.version_id,
      last_action: 'enable',
    };
    tenantDocument.updated_at = nowIso;

    await tenantDocument.save();

    return this.toResponse(tenantDocument);
  }

  private async resolveEffectiveDocument(
    tenantId: string,
    hsisCode: string,
  ): Promise<{
    document: TaxonomyScorecardDocument;
    resolvedFrom: 'default' | 'tenant';
  }> {
    const tenantDocument = await this.findScorecardByOwner(hsisCode, tenantId);

    if (tenantDocument) {
      return { document: tenantDocument, resolvedFrom: 'tenant' };
    }

    const defaultDocument = await this.findScorecardByOwner(
      hsisCode,
      DEFAULT_SCORECARD_OWNER,
    );

    if (!defaultDocument) {
      throw new NotFoundException(
        `Scorecard configuration for ${hsisCode} not found`,
      );
    }

    return { document: defaultDocument, resolvedFrom: 'default' };
  }

  private async ensureTenantDocument(args: {
    tenantId: string;
    hsisCode: string;
    nowIso: string;
    seed: TaxonomyScorecardDocument;
  }): Promise<TaxonomyScorecardDocument> {
    const tenantDocumentId = buildDocumentId(args.hsisCode, args.tenantId);
    const existingTenantDocument = await this.findScorecardByOwner(
      args.hsisCode,
      args.tenantId,
    );

    if (existingTenantDocument) {
      return existingTenantDocument;
    }

    const clonedPayload = cloneScorecardPayload(args.seed.scorecard);
    const clonedSource = cloneSource(args.seed.source);

    const created = new this.taxonomyScorecardModel({
      _id: tenantDocumentId,
      hsis_code: args.hsisCode,
      hsis_name: args.seed.hsis_name,
      scorecard_version: args.seed.scorecard_version ?? null,
      taxonomy_version: args.seed.taxonomy_version ?? null,
      scorecard: clonedPayload,
      components_available: [...(args.seed.components_available ?? ['need'])],
      source: {
        ...clonedSource,
        owner: args.tenantId,
        published_at: args.nowIso,
      },
      versions: {},
      version_metadata: {
        next_version: 0,
        active_version: null,
        last_action: 'update',
      },
      updated_by_email: args.seed.updated_by_email ?? null,
      updated_at: args.nowIso,
    });

    return created;
  }

  private async findAffectedCodesByPrefix(
    tenantId: string,
    prefixCode: string,
  ): Promise<string[]> {
    const response = await this.elasticsearchService.search<TaxonomyHitSource>({
      index: HYBRID_TAXONOMIES_INDEX,
      size: 1000,
      _source: ['code'],
      query: {
        bool: {
          filter: [{ term: { tenant_id: { value: tenantId } } }],
          must: [{ prefix: { code: prefixCode } }],
        },
      },
    });

    const hits = response.hits.hits || [];
    return hits
      .map((hit) => hit._source?.code)
      .filter((code): code is string => typeof code === 'string');
  }

  private async findScorecardByOwner(
    hsisCode: string,
    owner: string,
  ): Promise<TaxonomyScorecardDocument | null> {
    return this.taxonomyScorecardModel.findOne({
      _id: buildDocumentId(hsisCode, owner),
    });
  }

  private patchSourceMetadata(args: {
    source?: TaxonomySource | null;
    owner: string;
    publishedAt: string;
  }): TaxonomySource {
    return {
      ...cloneSource(args.source),
      owner: args.owner,
      published_at: args.publishedAt,
    };
  }

  private async findStructuralDescendants(
    tenantId: string,
    code: string,
  ): Promise<string[]> {
    const candidates = await this.findAffectedCodesByPrefix(
      tenantId,
      getTaxonomyChildPrefix(code),
    );

    return candidates.filter((candidateCode) =>
      isTaxonomyDescendantOrSelf(code, candidateCode),
    );
  }

  private async findDirectSiblings(
    tenantId: string,
    code: string,
  ): Promise<string[]> {
    const parentCode = getTaxonomyParentCode(code);

    if (!parentCode) {
      return [];
    }

    const siblingCandidates = await this.findAffectedCodesByPrefix(
      tenantId,
      getTaxonomyChildPrefix(parentCode),
    );

    return siblingCandidates.filter((candidateCode) =>
      isDirectTaxonomySibling(code, candidateCode),
    );
  }

  private async resolveAffectedCodes(args: {
    tenantId: string;
    hsisCode: string;
    includeChildren: boolean;
    includeSiblings: boolean;
  }): Promise<string[]> {
    const affectedCodes = new Set<string>([args.hsisCode]);

    if (args.includeChildren) {
      const childCodes = await this.findStructuralDescendants(
        args.tenantId,
        args.hsisCode,
      );
      childCodes.forEach((code) => affectedCodes.add(code));
    }

    if (args.includeSiblings) {
      const siblings = await this.findDirectSiblings(
        args.tenantId,
        args.hsisCode,
      );
      siblings.forEach((code) => affectedCodes.add(code));

      if (args.includeChildren) {
        const siblingChildren = await Promise.all(
          siblings.map((siblingCode) =>
            this.findStructuralDescendants(args.tenantId, siblingCode),
          ),
        );

        siblingChildren.flat().forEach((code) => affectedCodes.add(code));
      }
    }

    const codes = Array.from(affectedCodes);

    if (codes.length === 0) {
      throw new BadRequestException(
        `No taxonomy codes found for update of ${args.hsisCode}`,
      );
    }

    return codes;
  }

  private toResponse(
    document: TaxonomyScorecardDocument,
  ): TaxonomyScorecardResponseDto {
    const scorecard = cloneScorecardPayload(document.scorecard);

    return {
      _id: document._id,
      hsis_code: document.hsis_code,
      hsis_name: document.hsis_name,
      scorecard_version: document.scorecard_version ?? null,
      taxonomy_version: document.taxonomy_version ?? null,
      scorecard,
      components_available: [...(document.components_available ?? [])],
      source: cloneSource(document.source),
      versions: Object.fromEntries(
        Object.entries(document.versions ?? {}).map(([versionId, entry]) => [
          versionId,
          {
            version_id: versionId,
            ...entry,
            created_by_email: entry.created_by_email ?? null,
          },
        ]),
      ),
      version_metadata: {
        next_version: getNextVersionId(
          document.versions,
          document.version_metadata,
        ),
        active_version: document.version_metadata?.active_version ?? null,
        last_action: document.version_metadata?.last_action ?? 'update',
      },
      updated_by_email: document.updated_by_email ?? null,
      updated_at: document.updated_at,
    };
  }
}
