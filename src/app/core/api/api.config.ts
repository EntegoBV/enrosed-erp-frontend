/** Waar de Quarkus-backend draait. */
export const API_BASE = 'http://localhost:8080';

export const api = (path: string): string => API_BASE + path;
