import { ApplicationConfig, importProvidersFrom, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { SocketIoModule, SocketIoConfig } from 'ngx-socket-io';
import { appRoutes } from './app.routes';

const socketConfig: SocketIoConfig = {
  // Same origin works for both dev (port 4200 via proxy) and Docker (nginx)
  url: window.location.origin,
  options: { transports: ['websocket', 'polling'] },
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    provideHttpClient(),
    importProvidersFrom(SocketIoModule.forRoot(socketConfig)),
  ],
};
