import 'dotenv/config'; // loads .env from CWD (workspace root when using Nx)
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useWebSocketAdapter(new IoAdapter(app));
  const corsOrigin = process.env['CORS_ORIGIN'] ?? 'http://localhost:4200';
  app.enableCors({ origin: corsOrigin === '*' ? true : corsOrigin.split(',') });
  app.setGlobalPrefix('api');

  const port = process.env['PORT'] || 3000;
  await app.listen(port);
  Logger.log(`🚀 API running on: http://localhost:${port}/api`);
  Logger.log(`⚡ WebSocket on:   ws://localhost:${port}`);
}

bootstrap();
