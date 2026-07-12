import { Module } from '@nestjs/common';
import { ClusterService } from './cluster.service';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [GatewayModule],
  providers: [ClusterService],
})
export class ClusterModule {}
