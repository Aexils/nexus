import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { MetricsService } from './metrics.service';

@Module({
  imports: [GatewayModule],
  providers: [MetricsService],
})
export class MetricsModule {}
