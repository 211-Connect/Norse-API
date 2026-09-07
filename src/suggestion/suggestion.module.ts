import { Module } from '@nestjs/common';
import { SuggestionController } from './suggestion.controller';
import { SuggestionService } from './suggestion.service';
import { OrganizationModule } from 'src/organization/organization.module';
import { TaxonomyModule } from 'src/taxonomy/taxonomy.module';
import { CmsConfigModule } from 'src/cms-config/cms-config.module';

@Module({
  controllers: [SuggestionController],
  providers: [SuggestionService],
  imports: [OrganizationModule, TaxonomyModule, CmsConfigModule],
})
export class SuggestionModule {}
