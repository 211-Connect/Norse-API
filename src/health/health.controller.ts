import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthService } from './health.service';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/auth/gateway/gateway-principal';

@ApiTags('Health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
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
