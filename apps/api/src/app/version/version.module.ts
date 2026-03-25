import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { VersionService } from './version.service';

@Module({
  imports:   [GatewayModule],
  providers: [VersionService],
})
export class VersionModule {}
