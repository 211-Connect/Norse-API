import { Injectable, Logger } from '@nestjs/common';
import { MlBrokerHttpService } from 'src/ml-broker/ml-broker-http.service';
import { MlBrokerError } from 'src/ml-broker/ml-broker.errors';
import { ClassifyResult, toRulesSignals } from './to-rules-signals';

export type { ClassifyResult } from './to-rules-signals';

const failed = (): ClassifyResult => ({
  signals: { needs: { status: 'error' }, emergency: { status: 'error' } },
  scores: {},
  modelVersion: null,
});

/**
 * `/v2/search`'s failure policy over ml-broker `search-classification`. It
 * never throws: every failure becomes `status: 'error'` signals, so search
 * results still return. Transport lives in MlBrokerHttpService. Warnings never
 * carry the query text, which can hold personal data.
 */
@Injectable()
export class SearchClassificationClient {
  private readonly logger = new Logger(SearchClassificationClient.name);

  constructor(private readonly mlBroker: MlBrokerHttpService) {}

  async classify(query: string, tenantId: string): Promise<ClassifyResult> {
    try {
      const body = await this.mlBroker.classifySearch({
        query,
        tenant_id: tenantId,
      });
      return toRulesSignals(body);
    } catch (error) {
      // MlBrokerError messages hold no request or response body.
      const reason =
        error instanceof MlBrokerError
          ? `kind=${error.kind}: ${error.message}`
          : `kind=unexpected: ${error instanceof Error ? error.name : 'Error'}`;
      this.logger.warn(`search classification failed, ${reason}`);
      return failed();
    }
  }
}
