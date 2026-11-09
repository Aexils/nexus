import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { WriteGuard } from './write.guard';

@Module({
  controllers: [AuthController],
  providers:   [WriteGuard],
  exports:     [WriteGuard],
})
export class AuthModule {}
