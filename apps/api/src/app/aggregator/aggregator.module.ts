import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AggregatorController } from './aggregator.controller';
import { AggregatorService } from './aggregator.service';

@Module({
  imports:     [AuthModule],
  controllers: [AggregatorController],
  providers:   [{ provide: AggregatorService, useFactory: () => new AggregatorService() }],
})
export class AggregatorModule {}
