import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { GatewayModule } from './gateway/gateway.module';
import { KodiModule } from './kodi/kodi.module';
import { MetricsModule } from './metrics/metrics.module';
import { AbsModule } from './audiobookshelf/abs.module';
import { PsnModule } from './playstation/psn.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    GatewayModule,
    KodiModule,
    MetricsModule,
    AbsModule,
    PsnModule,
  ],
})
export class AppModule {}
