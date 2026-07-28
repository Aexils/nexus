import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [GatewayModule],
  providers: [JobsService],
})
export class JobsModule {}
