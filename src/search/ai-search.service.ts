import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { AiSearchPredictRequestDto } from './dto/ai-search-predict-request.dto';
import { AiSearchReRankRequestDto } from './dto/ai-search-re-rank-request.dto';
import {
  AiSearchPredictResponseDto,
  AiSearchScenario,
  AiSearchOptionDto,
} from './dto/ai-search-predict-response.dto';
import { AiSearchReRankResponseDto } from './dto/ai-search-re-rank-response.dto';
import { HybridSearchService } from './hybrid-search.service';

const ML_BROKER_TIMEOUT_MS = 10_000;
const ML_BROKER_TOP_K = 150;
const PRESELECTED_THRESHOLD = 0.6;

enum MlBrokerTask {
  PREDICT = 'predict',
  RERANK = 're-rank',
}

type MlBrokerPredictResponse = {
  task: string;
  query: string;
  tenant_id: string;
  low_info: {
    is_low_info: boolean;
    reason: string;
    score?: number | null;
    matched_pattern?: string | null;
  };
  confidence: {
    level: 'high' | 'low';
    top_score: number;
    top_labels: string[];
    multiple_high_confidence: boolean;
    high_threshold: number;
  };
  needs: {
    code: string;
    name: string;
    description?: string | null;
    score: number;
  }[];
  hsis_taxonomies?: string[];
};

type MlBrokerReRankResponse = {
  hsis_taxonomies?: string[];
};

type MlBrokerResponseByTask = {
  [MlBrokerTask.PREDICT]: MlBrokerPredictResponse;
  [MlBrokerTask.RERANK]: MlBrokerReRankResponse;
};

@Injectable()
export class AiSearchService {
  private readonly logger = new Logger(AiSearchService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly hybridSearchService: HybridSearchService,
  ) {}

  async predict(
    headers: HeadersDto,
    body: AiSearchPredictRequestDto,
  ): Promise<AiSearchPredictResponseDto> {
    const topK = body.top_k ?? ML_BROKER_TOP_K;

    const brokerResponse = await this.callMlBroker({
      task: MlBrokerTask.PREDICT,
      headers,
      body: {
        query: body.query,
        tenant_id: headers['x-tenant-id'],
        top_k: topK,
        return_all_labels: true,
      },
    });

    this.logger.debug(
      `[predict] query="${body.query}" tenant=${headers['x-tenant-id']} | ` +
        `needs=[${(brokerResponse.needs || [])
          .map((n) => `${n.code}:${n.score}`)
          .join(', ')}] | ` +
        `hsis_taxonomies=[${(brokerResponse.hsis_taxonomies || []).join(', ')}]`,
    );

    return this.toAiSearchResponse(headers, brokerResponse, topK);
  }

  async reRank(
    headers: HeadersDto,
    body: AiSearchReRankRequestDto,
  ): Promise<AiSearchReRankResponseDto> {
    const response = await this.callMlBroker({
      task: MlBrokerTask.RERANK,
      headers,
      body: {
        tenant_id: headers['x-tenant-id'],
        need_weights: body.need_weights,
        top_k: body.top_k ?? ML_BROKER_TOP_K,
      },
    });

    this.logger.debug(
      `[re-rank] tenant=${headers['x-tenant-id']} | ` +
        `need_weights=${JSON.stringify(body.need_weights)} | ` +
        `hsis_taxonomies=[${(response.hsis_taxonomies || []).join(', ')}]`,
    );

    return {
      hsis_taxonomies: response.hsis_taxonomies || [],
    };
  }

  private async callMlBroker<TTask extends MlBrokerTask>({
    task,
    body,
  }: {
    task: TTask;
    headers: HeadersDto;
    body: Record<string, unknown>;
  }): Promise<MlBrokerResponseByTask[TTask]> {
    const baseUrl = this.configService.get<string>('ML_BROKER_BASE_URL');
    const apiKey = this.configService.get<string>('ML_BROKER_API_KEY');

    if (!baseUrl || !apiKey) {
      throw new ServiceUnavailableException(
        'AI classification is not configured',
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      ML_BROKER_TIMEOUT_MS,
    );

    try {
      const response = await fetch(
        `${baseUrl}/api/v1/tasks/needs-classification/${task}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const text = await response.text();
        this.logger.error(
          `ML broker ${task} failed: status=${response.status} body=${text}`,
        );
        throw new BadGatewayException(`AI ${task} failed`);
      }

      return (await response.json()) as MlBrokerResponseByTask[TTask];
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      if (error?.name === 'AbortError') {
        this.logger.error(
          `ML broker ${task} timed out after ${ML_BROKER_TIMEOUT_MS}ms`,
        );
        throw new ServiceUnavailableException(`AI ${task} timed out`);
      }

      this.logger.error(
        `ML broker ${task} request failed: ${error?.message}`,
        error?.stack,
      );
      throw new BadGatewayException(`AI ${task} failed`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async toAiSearchResponse(
    headers: HeadersDto,
    input: MlBrokerPredictResponse,
    topK: number,
  ): Promise<AiSearchPredictResponseDto> {
    const scenario = this.resolveScenario(input);
    const options = await this.buildOptions(headers, input, scenario, topK);
    const hsisTaxonomies = input.hsis_taxonomies || [];

    return {
      scenario,
      hsis_taxonomies: hsisTaxonomies,
      options,
    };
  }

  private resolveScenario(input: MlBrokerPredictResponse): AiSearchScenario {
    const { low_info, confidence } = input;

    if (low_info?.is_low_info) {
      if (confidence?.top_labels?.length > 1) {
        return 'clarify_low_info';
      }

      return 'search_and_notify_low_info';
    }

    if (confidence?.level === 'high') {
      if (confidence.multiple_high_confidence) {
        return 'clarify_multiple_labels';
      }

      return 'search';
    }

    return 'search_and_notify_low_confidence';
  }

  private async buildOptions(
    headers: HeadersDto,
    input: MlBrokerPredictResponse,
    scenario: AiSearchScenario,
    topK: number,
  ): Promise<AiSearchOptionDto[]> {
    const needs = input.needs || [];
    const isClarifyScenario =
      scenario === 'clarify_low_info' || scenario === 'clarify_multiple_labels';

    if (!isClarifyScenario || needs.length === 0) {
      return needs.map((need) => ({
        code: need.code,
        score: need.score,
        pre_selected: need.score > PRESELECTED_THRESHOLD,
        results_count: 0,
      }));
    }

    const options = await Promise.all(
      needs.map(async (need): Promise<AiSearchOptionDto> => {
        try {
          const need_weights = Object.fromEntries(
            needs.map((item) => [
              item.code,
              item.code === need.code ? item.score : 0.1,
            ]),
          );

          const reRankResponse = await this.callMlBroker({
            task: MlBrokerTask.RERANK,
            headers: {
              'x-tenant-id': input.tenant_id,
            },
            body: {
              tenant_id: input.tenant_id,
              need_weights,
              top_k: topK,
            },
          });

          const hsisTaxonomies = Array.from(
            new Set((reRankResponse.hsis_taxonomies || []).filter(Boolean)),
          );

          const resultsCount = await this.hybridSearchService.getDocumentsCount(
            headers,
            input.query,
            hsisTaxonomies,
          );

          this.logger.debug(
            `[predict/clarify] need=${need.code} | ` +
              `need_weights=${JSON.stringify(need_weights)} | ` +
              `hsis_taxonomies=[${hsisTaxonomies.join(', ')}] | ` +
              `results_count=${resultsCount}`,
          );

          return {
            code: need.code,
            score: need.score,
            pre_selected: need.score > PRESELECTED_THRESHOLD,
            results_count: resultsCount,
          };
        } catch (error) {
          this.logger.warn(
            `Failed to resolve results_count for need ${need.code}: ${error?.message}`,
          );

          return {
            code: need.code,
            score: need.score,
            pre_selected: need.score > PRESELECTED_THRESHOLD,
            results_count: 0,
          };
        }
      }),
    );

    return options;
  }
}
