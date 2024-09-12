import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  getServerHealth() {
    return {
      status: 'up',
    };
  }
}
