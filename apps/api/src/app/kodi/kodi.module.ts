import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { KodiService } from './kodi.service';
import { KodiController } from './kodi.controller';

@Module({
  imports: [GatewayModule],
  controllers: [KodiController],
  providers: [KodiService],
})
export class KodiModule {}
