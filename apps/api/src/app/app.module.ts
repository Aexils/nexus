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
import { LinkModule } from './link/link.module';
import { EventsModule } from './events/events.module';
import { JobsModule } from './jobs/jobs.module';
import { VzdumpModule } from './vzdump/vzdump.module';
import { ImportModule } from './import/import.module';
import { TraktModule } from './trakt/trakt.module';
import { AuthModule } from './auth/auth.module';
import { AggregatorModule } from './aggregator/aggregator.module';

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
    LinkModule,
    EventsModule,
    JobsModule,
    VzdumpModule,
    ImportModule,
    TraktModule,
    AuthModule,
    AggregatorModule,
  ],
})
export class AppModule {}
