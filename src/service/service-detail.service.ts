import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { Service } from 'src/common/schemas/service.schema';
import { filterTranslationsByLocale } from 'src/organization/organization-detail.transform';
import { ServiceDetail } from './types/service-response.types';
import { narrowTranslationsStage } from './service-detail.transform';

@Injectable()
export class ServiceDetailService {
  private readonly logger = new Logger(ServiceDetailService.name);

  constructor(
    @InjectModel(Service.name)
    private readonly serviceModel: Model<Service>,
  ) {}

  /**
   * One service document, narrowed to the requested locale in the database.
   *
   * Two filters, and the order is the point. The aggregation drops the locales
   * nobody asked for before the driver transfers anything; the JavaScript
   * transform then makes the final requested -> English -> canonical selection
   * from what survives. See `service-detail.transform.ts` for why the split.
   */
  async findById(
    id: string,
    options: { headers: HeadersDto },
  ): Promise<ServiceDetail> {
    const tenantId = options.headers['x-tenant-id'];
    const locale = options.headers['accept-language'];

    const pipeline: PipelineStage[] = [
      // Tenant-scoped, ALWAYS. `serviceId` is unique per writer and not across
      // them, so an unscoped match can return another tenant's document for a
      // shared id. There is no no-tenant fallback here, deliberately: the
      // organization endpoint has one and it will answer from any tenant when
      // the scoped lookup misses, which is a cross-tenant read.
      { $match: { tenant_id: tenantId, serviceId: id } },
      { $limit: 1 },
      narrowTranslationsStage(locale),
      { $project: { _id: 0 } },
    ];

    const [service] = await this.serviceModel
      .aggregate<ServiceDetail>(pipeline)
      .exec();

    if (!service) {
      this.logger.warn(
        `Service not found: ${JSON.stringify({ tenantId, serviceId: id })}`,
      );
      throw new NotFoundException();
    }

    return filterTranslationsByLocale(service, locale);
  }
}
