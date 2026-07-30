import { Module } from '@nestjs/common';
import { SuggestionController } from './suggestion.controller';
import { SuggestionService } from './suggestion.service';
import { SharedElasticsearchModule } from 'src/common/providers/elasticsearch.module';

@Module({
  controllers: [SuggestionController],
  providers: [SuggestionService],
  imports: [SharedElasticsearchModule],
})
export class SuggestionModule {}
