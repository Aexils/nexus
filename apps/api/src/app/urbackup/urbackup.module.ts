import { Module } from '@nestjs/common';
import { UrbackupService } from './urbackup.service';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [GatewayModule],
  providers: [UrbackupService],
})
export class UrbackupModule {}
