import { Module } from '@nestjs/common';
import { NexusGateway } from './nexus.gateway';
import { NotifierService } from '../notifier/notifier.service';
import { LogStoreService } from './log-store.service';

@Module({
  providers: [NexusGateway, NotifierService, LogStoreService],
  exports: [NexusGateway],
})
export class GatewayModule {}
