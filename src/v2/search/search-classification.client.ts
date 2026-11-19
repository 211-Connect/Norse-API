import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiClassificationSetting } from '../rules/types';
import { MlBrokerHttpService } from 'src/ml-broker/ml-broker-http.service';
import { MlBrokerError } from 'src/ml-broker/ml-broker.errors';
import {
  classifyOutcomeOf,
  failedClassifyResult,
  failureKindOf,
} from './classify-outcome';
import { ClassifyResult, toRulesSignals } from './to-rules-signals';

export type { ClassifyResult } from './to-rules-signals';

/**
 * `/v2/search`'s failure policy (states: classify-outcome.ts) over ml-broker `search-classification`. It
 * never throws: every failure becomes `status: 'error'` signals, so search
 * results still return. Transport lives in MlBrokerHttpService. Warnings never
 * carry the query text, which can hold personal data.
 */
@Injectable()
export class SearchClassificationClient {
  private readonly logger = new Logger(SearchClassificationClient.name);

  constructor(
    private readonly mlBroker: MlBrokerHttpService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Always calls ml-broker (Lucas 2026-11-13). With AI classification off and
   * ML_BROKER_EMERGENCY_ONLY_SUPPORTED exactly `true`, the request carries
   * `emergency_only: true` so ml-broker skips the needs model. An older
   * ml-broker may reject the unknown field, hence the flag (default off).
   */
  async classify(
    query: string,
    tenantId: string,
    aiClassification: AiClassificationSetting = 'on',
  ): Promise<ClassifyResult> {
    const emergencyOnly =
      aiClassification === 'off' &&
      this.config.get('ML_BROKER_EMERGENCY_ONLY_SUPPORTED') === 'true';
    try {
      const body = await this.mlBroker.classifySearch({
        query,
        tenant_id: tenantId,
        ...(emergencyOnly && { emergency_only: true }),
      });
      const result = toRulesSignals(body);
      const outcome = classifyOutcomeOf(result.signals);
      if (outcome !== 'ok') {
        this.logger.warn(`search classification partial, outcome=${outcome}`);
      }
      return result;
    } catch (error) {
      // MlBrokerError messages hold no request or response body.
      const detail =
        error instanceof MlBrokerError
          ? error.message
          : error instanceof Error
            ? error.name
            : 'Error';
      this.logger.warn(
        `search classification failed, outcome=failed kind=${failureKindOf(error)}: ${detail}`,
      );
      return failedClassifyResult();
    }
  }
}
