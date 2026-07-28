import { Module } from '@nestjs/common';
import { VzdumpService } from './vzdump.service';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [GatewayModule],
  providers: [VzdumpService],
})
export class VzdumpModule {}
