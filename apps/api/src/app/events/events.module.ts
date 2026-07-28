import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [GatewayModule],
  providers: [EventsService],
})
export class EventsModule {}
