import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import { HealthResponseDto } from './dto/health-response.dto';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipMetrics } from 'src/metrics/skip-metrics.decorator';
import { Public } from 'src/auth/gateway/gateway-principal';
import { V1_AND_LEGACY } from '../common/versioning/api-version';

@ApiTags('Health')
@Controller({ path: 'health', version: V1_AND_LEGACY })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @SkipMetrics()
  @Public()
  @ApiResponse({ status: 200, type: HealthResponseDto })
  getStatus(): HealthResponseDto {
    return this.healthService.getServerHealth();
  }
}
