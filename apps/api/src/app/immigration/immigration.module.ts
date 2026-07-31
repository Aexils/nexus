import { Module } from '@nestjs/common';
import { ImmigrationService } from './immigration.service';
import { ImmigrationController } from './immigration.controller';

@Module({
  controllers: [ImmigrationController],
  providers:   [ImmigrationService],
  exports:     [ImmigrationService],
})
export class ImmigrationModule {}
