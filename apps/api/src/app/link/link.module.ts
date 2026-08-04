import { Module } from '@nestjs/common';
import { LinkService } from './link.service';
import { LinkStoreService } from './link-store.service';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [GatewayModule],
  providers: [LinkService, LinkStoreService],
})
export class LinkModule {}
