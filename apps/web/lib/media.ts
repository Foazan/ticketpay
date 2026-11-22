import { API_URL } from './api';

/**
 * Seeded posters are served by this app (/posters/...); uploaded and generated ones by the API
 * (/media/posters/...). Both are stored as paths, so the API prefix is added here.
 */
export function posterSrc(path: string): string {
  return path.startsWith('/media/') ? `${API_URL}${path}` : path;
}
