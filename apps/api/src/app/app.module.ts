import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { GatewayModule } from './gateway/gateway.module';
import { KodiModule } from './kodi/kodi.module';
import { MetricsModule } from './metrics/metrics.module';
import { AbsModule } from './audiobookshelf/abs.module';
import { PsnModule } from './playstation/psn.module';
import { SideloadlyModule } from './sideloadly/sideloadly.module';
import { UrbackupModule } from './urbackup/urbackup.module';
import { VersionModule } from './version/version.module';
import { JellyfinModule } from './jellyfin/jellyfin.module';
import { ExpenseModule } from './expense/expense.module';
import { AdminModule } from './admin/admin.module';
import { BookloreModule } from './booklore/booklore.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    GatewayModule,
    KodiModule,
    MetricsModule,
    AbsModule,
    PsnModule,
    SideloadlyModule,
    UrbackupModule,
    VersionModule,
    JellyfinModule,
    ExpenseModule,
    AdminModule,
    BookloreModule,
  ],
})
export class AppModule {}
