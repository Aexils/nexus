import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { BookloreService } from './booklore.service';
import { BookloreController } from './booklore.controller';

@Module({
  imports: [GatewayModule],
  providers: [BookloreService],
  controllers: [BookloreController],
})
export class BookloreModule {}
