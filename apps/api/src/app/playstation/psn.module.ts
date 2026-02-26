import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { PsnService } from './psn.service';

@Module({
  imports:   [GatewayModule],
  providers: [PsnService],
})
export class PsnModule {}
