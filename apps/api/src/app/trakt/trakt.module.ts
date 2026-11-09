import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GatewayModule } from '../gateway/gateway.module';
import { TraktController } from './trakt.controller';
import { TraktService } from './trakt.service';

@Module({
  imports:     [GatewayModule, AuthModule],
  controllers: [TraktController],
  providers:   [TraktService],
})
export class TraktModule {}
