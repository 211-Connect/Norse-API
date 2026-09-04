import { Module } from '@nestjs/common';
import { SuggestionController } from './suggestion.controller';
import { SuggestionService } from './suggestion.service';
import { OrganizationModule } from 'src/organization/organization.module';
import { TaxonomyModule } from 'src/taxonomy/taxonomy.module';

@Module({
  controllers: [SuggestionController],
  providers: [SuggestionService],
  imports: [OrganizationModule, TaxonomyModule],
})
export class SuggestionModule {}
