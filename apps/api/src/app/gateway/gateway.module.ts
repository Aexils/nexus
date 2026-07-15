import { Module } from '@nestjs/common';
import { NexusGateway } from './nexus.gateway';
import { NotifierService } from '../notifier/notifier.service';

@Module({
  providers: [NexusGateway, NotifierService],
  exports: [NexusGateway],
})
export class GatewayModule {}
