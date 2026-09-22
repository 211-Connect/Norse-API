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

  async findById(
    id: string,
    options: { headers: HeadersDto },
  ): Promise<ServiceDetail> {
    const tenantId = options.headers['x-tenant-id'];
    const locale = options.headers['accept-language'];

    const pipeline: PipelineStage[] = [
      // No unscoped fallback: `serviceId` is unique per Resource Writer, not
      // across them. See ISS-1778 for what that fallback did elsewhere.
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
