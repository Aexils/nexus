import { Module } from '@nestjs/common';
import { NextcloudService } from './nextcloud.service';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [GatewayModule],
  providers: [NextcloudService],
})
export class NextcloudModule {}
