import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { JellyfinService } from './jellyfin.service';
import { JellyfinController } from './jellyfin.controller';

@Module({
  imports:     [GatewayModule],
  controllers: [JellyfinController],
  providers:   [JellyfinService],
})
export class JellyfinModule {}
