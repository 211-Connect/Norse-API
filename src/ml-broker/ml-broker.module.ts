import { Module } from '@nestjs/common';
import { MlBrokerHttpService } from './ml-broker-http.service';

/**
 * ml-broker transport. Imported by `/v2/search` only; v1's AiSearchService
 * keeps its own client.
 */
@Module({
  providers: [MlBrokerHttpService],
  exports: [MlBrokerHttpService],
})
export class MlBrokerModule {}
