// The `e2e` build (npm run build:e2e, angular.json): a production build against the local API, plus
// routes that exist only for the e2e tests (e2e-routes.ts).
export const environment = {
  apiUrl: 'http://localhost:3000',
  e2eRoutes: true,
};
