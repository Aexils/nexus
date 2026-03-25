import { Module } from '@nestjs/common';
import { BodyController } from './body.controller';
import { BodyService } from './body.service';

@Module({
  controllers: [BodyController],
  providers: [BodyService],
})
export class BodyModule {}
