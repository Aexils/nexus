import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { SideloopService } from './sideloop.service';

@Module({
  imports:   [GatewayModule],
  providers: [SideloopService],
})
export class SideloopModule {}
