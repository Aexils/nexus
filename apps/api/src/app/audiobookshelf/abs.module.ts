import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { AbsService } from './abs.service';
import { AbsController } from './abs.controller';

@Module({
  imports: [GatewayModule],
  providers: [AbsService],
  controllers: [AbsController],
})
export class AbsModule {}
