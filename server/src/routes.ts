import { ROUTES } from './routes.gen.ts';
import type { RouteName } from './routes.gen.ts';

export { ROUTES };
export type { RouteName };

// The method and path of a route, by its name in the table. A route list adds the handler.
export function at(name: RouteName): { method: string; path: string } {
  const { method, path } = ROUTES[name];
  return { method, path };
}
