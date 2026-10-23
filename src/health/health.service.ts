import { Injectable } from '@nestjs/common';
import { releaseInfo } from 'src/common/release/release-info';
import { HealthResponseDto } from './dto/health-response.dto';

@Injectable()
export class HealthService {
  getServerHealth(): HealthResponseDto {
    return { status: 'up', ...releaseInfo() };
  }
}
