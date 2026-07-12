import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { GatewayModule } from './gateway/gateway.module';
import { MetricsModule } from './metrics/metrics.module';
import { VersionModule } from './version/version.module';
import { ExpenseModule } from './expense/expense.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    GatewayModule,
    MetricsModule,
    VersionModule,
    ExpenseModule,
    AdminModule,
  ],
})
export class AppModule {}
