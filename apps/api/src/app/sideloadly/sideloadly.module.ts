import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { SideloadlyService } from './sideloadly.service';

@Module({
  imports:   [GatewayModule],
  providers: [SideloadlyService],
})
export class SideloadlyModule {}
