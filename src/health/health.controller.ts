import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipMetrics } from 'src/metrics/skip-metrics.decorator';
import { Public } from 'src/auth/gateway/gateway-principal';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @SkipMetrics()
  @Public()
  @ApiResponse({
    status: 200,
    example: {
      status: 'up',
    },
  })
  getStatus() {
    return this.healthService.getServerHealth();
  }
}
