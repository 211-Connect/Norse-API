import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import { ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
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
