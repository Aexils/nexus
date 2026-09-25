import { Module } from '@nestjs/common';
import { TytoService } from './tyto.service';
import { TytoStoreService } from './tyto-store.service';
import { TytoController } from './tyto.controller';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [GatewayModule],
  controllers: [TytoController],
  providers: [TytoService, TytoStoreService],
})
export class TytoModule {}
