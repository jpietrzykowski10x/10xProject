// Production build. Two builds swap in environment.development.ts (angular.json): `development`
// (ng serve) and `e2e` (npm run build:e2e: a production build against the local API).
export const environment = {
  apiUrl: 'https://apisubtracker.jakubpietrzykowski.pl',
};
