import { Module } from '@nestjs/common';
import { ImportService } from './import.service';
import { ImportController } from './import.controller';
import { ExpenseModule } from '../expense/expense.module';

@Module({
  imports:     [ExpenseModule],
  controllers: [ImportController],
  providers:   [ImportService],
  exports:     [ImportService],
})
export class ImportModule {}
