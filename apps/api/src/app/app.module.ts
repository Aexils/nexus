import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { GatewayModule } from './gateway/gateway.module';
import { MetricsModule } from './metrics/metrics.module';
import { ClusterModule } from './cluster/cluster.module';
import { VersionModule } from './version/version.module';
import { ExpenseModule } from './expense/expense.module';
import { AdminModule } from './admin/admin.module';
import { SideloopModule } from './sideloop/sideloop.module';
import { NextcloudModule } from './nextcloud/nextcloud.module';
import { EventsModule } from './events/events.module';
import { JobsModule } from './jobs/jobs.module';
import { VzdumpModule } from './vzdump/vzdump.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    GatewayModule,
    MetricsModule,
    ClusterModule,
    VersionModule,
    ExpenseModule,
    AdminModule,
    SideloopModule,
    NextcloudModule,
    EventsModule,
    JobsModule,
    VzdumpModule,
  ],
})
export class AppModule {}
