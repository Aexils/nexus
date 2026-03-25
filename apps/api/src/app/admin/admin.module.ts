import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { ExpenseModule } from '../expense/expense.module';

@Module({
  imports:     [ExpenseModule],
  controllers: [AdminController],
  providers:   [AdminService],
})
export class AdminModule {}
