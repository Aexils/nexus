import { ApplicationConfig, importProvidersFrom, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withViewTransitions } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { SocketIoModule, SocketIoConfig } from 'ngx-socket-io';
import { appRoutes } from './app.routes';
import { bingieWriteInterceptor } from './features/bingie/bingie-session';

const socketConfig: SocketIoConfig = {
  // Same origin works for both dev (port 4200 via proxy) and Docker (nginx)
  url: window.location.origin,
  options: { transports: ['websocket', 'polling'] },
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Transitions de page natives (API View Transitions du navigateur) : aucun
    // kilo-octet ajouté, et les navigateurs qui ne la gèrent pas naviguent
    // normalement. Le rendu est défini dans styles.scss (::view-transition-*).
    provideRouter(appRoutes, withViewTransitions()),
    // Écritures Bingie : jeton anti-CSRF de la session commune ; les autres requêtes ne changent pas.
    provideHttpClient(withInterceptors([bingieWriteInterceptor])),
    importProvidersFrom(SocketIoModule.forRoot(socketConfig)),
  ],
};
