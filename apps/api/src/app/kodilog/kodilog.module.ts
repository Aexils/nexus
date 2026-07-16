import { Module } from '@nestjs/common';
import { KodiLogService } from './kodilog.service';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [GatewayModule],
  providers: [KodiLogService],
})
export class KodiLogModule {}
