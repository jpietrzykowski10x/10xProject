import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../environments/environment';

export const credentialsInterceptor: HttpInterceptorFn = (request, next) => {
  // The trailing slash matters: a bare prefix would also match a host like <api-host>.example.com.
  const isApiRequest =
    request.url === environment.apiUrl || request.url.startsWith(`${environment.apiUrl}/`);

  return next(isApiRequest ? request.clone({ withCredentials: true }) : request);
};
